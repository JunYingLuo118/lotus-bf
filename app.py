#!/usr/bin/env python3
"""LoTUS-BF backend: Location-or-Term Unified Search for Brain Functions (HW9 version).

One Flask app that
  1. builds a SQLite database from the three Neurosynth Parquet files     python app.py build-db
  2. answers the LoTUS-BF API (same routes as Tren's version)             /terms, /query/<q>/studies, ...
  3. serves the built React frontend (dist/) from the same origin         python app.py  ->  http://127.0.0.1:5000

API
  GET /terms                       vocabulary terms, with how many studies use each one
  GET /terms/<term>                related terms (co-occurrence across abstracts, Jaccard)
  GET /query/<q>/studies           studies that match a mixed query, plus how the query was read
  GET /query/<q>/locations         peak coordinates of those studies
  GET /query/<q>/nii               smoothed peak-density map of those studies (NIfTI, MNI152 2 mm)
  GET /studies/<study_id>          one study: metadata, its strongest terms, its peaks
  GET /help, GET /health

Query language (the whole expression is evaluated as one boolean formula over studies)
  amygdala               a vocabulary term: the study's abstract has tf-idf > 0 for it (Neurosynth's rule)
  default mode           neighbouring words are joined into the longest vocabulary phrase
  "theory of mind"       quotes keep words together; stop words such as "of" are ignored
  emotion*               any vocabulary term that starts with "emotion"
  [-22,0,-20]            studies with at least one peak within r mm (?r=6 by default, at most 30)
  AND  OR  NOT  ( )      NOT binds tightest, then AND, then OR; writing two items side by side means AND
  A word that is not in the vocabulary is looked up in study titles instead, and the reply says so.

Data: coordinates.parquet, metadata.parquet, annotations.parquet from https://github.com/spiketren/ns-nano
(14,371 studies, 507,891 peaks, 3,228 abstract terms).
"""
from __future__ import annotations

import argparse
import bisect
import gzip
import io
import math
import os
import re
import sqlite3
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np
from flask import Flask, Response, abort, g, jsonify, request, send_from_directory

HERE = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("LOTUS_DB", str(HERE / "lotus.sqlite"))).resolve()
DIST_DIR = Path(os.getenv("LOTUS_DIST", str(HERE / "dist"))).resolve()
DATA_DIRS = (HERE / "data", HERE)
PARQUET_FILES = ("coordinates.parquet", "metadata.parquet", "annotations.parquet")
TERM_COLUMN_RE = re.compile(r"^terms_.*?__")      # terms_abstract_tfidf__amygdala -> amygdala

DEFAULT_R, MAX_R = 6.0, 30.0                      # mm; 6 is what neurosynth.org uses for locations
DEFAULT_FWHM, MAX_FWHM = 10.0, 30.0               # mm; 10 is Tren's default
MAX_QUERY_CHARS, MAX_ATOMS, MAX_POINTS = 500, 25, 10
MAX_ABS_MM = 150.0
MNI_SHAPE = (91, 109, 91)                         # FSL MNI152 2 mm grid, same as the frontend template
MNI_AFFINE = np.array([[-2.0, 0.0, 0.0, 90.0],
                       [0.0, 2.0, 0.0, -126.0],
                       [0.0, 0.0, 2.0, -72.0],
                       [0.0, 0.0, 0.0, 1.0]])
STOPWORDS = frozenset("a an the of in on at to for with by from as into via".split())   # none is a term

# ---------------------------------------------------------------------------
# 1. Parquet -> SQLite
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE studies (
    study_id TEXT PRIMARY KEY,          -- PubMed ID
    title    TEXT,
    authors  TEXT,
    journal  TEXT,
    year     INTEGER,
    n_peaks  INTEGER NOT NULL,
    n_terms  INTEGER NOT NULL
);
CREATE TABLE terms (
    term_id   INTEGER PRIMARY KEY,
    term      TEXT NOT NULL UNIQUE,
    n_studies INTEGER NOT NULL
);
CREATE TABLE study_terms (              -- one row per (term, study) with abstract tf-idf > 0
    term_id  INTEGER NOT NULL,
    study_id TEXT NOT NULL,
    weight   REAL NOT NULL,
    PRIMARY KEY (term_id, study_id)
) WITHOUT ROWID;
CREATE TABLE coordinates (
    study_id TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    suspect INTEGER NOT NULL      -- 1 = probably not a coordinate (see suspect_peaks); kept, but not searched or drawn
);
CREATE TABLE build_info (key TEXT PRIMARY KEY, value TEXT);
"""
INDEXES = """
CREATE INDEX ix_study_terms_study ON study_terms (study_id, term_id);
CREATE INDEX ix_coordinates_xyz ON coordinates (x, y, z);
CREATE INDEX ix_coordinates_study ON coordinates (study_id);
ANALYZE;
"""


def find_data_dir(explicit: str | None = None) -> Path:
    candidates = [Path(explicit)] if explicit else []
    if os.getenv("LOTUS_DATA"):
        candidates.append(Path(os.environ["LOTUS_DATA"]))
    candidates.extend(DATA_DIRS)
    for d in candidates:
        if all((d / f).exists() for f in PARQUET_FILES):
            return d
    raise FileNotFoundError("coordinates/metadata/annotations .parquet not found; put them in ./data "
                            "(from https://github.com/spiketren/ns-nano) or pass --data-dir")


def suspect_peaks(xyz: np.ndarray) -> np.ndarray:
    """Rows that are almost certainly not brain coordinates but numbers the automatic extraction misread:
    - the three values are consecutive integers in some order (1,2,3 / 3,2,1 / 17,18,19): table row or column numbers
    - all three values are within 1 mm of zero (0.001, 0.005, 0.252): p-values or correlations
    They are 0.23% of the peaks, but they pile up near [0,0,0] and used to become the top of big maps."""
    s = np.sort(xyz, axis=1)
    consecutive = np.all(s == np.round(s), axis=1) & (s[:, 1] == s[:, 0] + 1) & (s[:, 2] == s[:, 1] + 1)
    tiny = np.all(np.abs(xyz) < 1, axis=1)
    return consecutive | tiny


def build_database(db_path: Path, data_dir: Path, log=print) -> dict:
    """Write the database to a temporary file first, so a failed build never leaves half a database."""
    import pyarrow.parquet as pq

    t0 = time.time()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = db_path.with_name(db_path.name + ".building")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + SCHEMA)
    log(f"Building {db_path} from {data_dir}")

    meta = pq.read_table(data_dir / "metadata.parquet").to_pydict()
    study_ids = [str(s) for s in meta["study_id"]]
    if len(set(study_ids)) != len(study_ids):
        raise ValueError("metadata.parquet: study_id is not unique")
    row_of = {s: i for i, s in enumerate(study_ids)}
    n_studies = len(study_ids)
    n_peaks = np.zeros(n_studies, np.int64)
    n_terms = np.zeros(n_studies, np.int64)

    tbl = pq.read_table(data_dir / "coordinates.parquet", columns=["study_id", "x", "y", "z"])
    sid = [str(s) for s in tbl.column("study_id").to_pylist()]
    xyz = np.column_stack([tbl.column(c).to_numpy(zero_copy_only=False).astype(float) for c in "xyz"])
    rows = np.array([row_of.get(s, -1) for s in sid])
    keep = np.isfinite(xyz).all(axis=1) & (rows >= 0)
    if (~keep).any():
        log(f"  dropping {int((~keep).sum()):,} peaks (non-finite or unknown study)")
    suspect = suspect_peaks(np.nan_to_num(xyz))
    con.executemany("INSERT INTO coordinates VALUES (?, ?, ?, ?, ?)",
                    ((sid[i], float(xyz[i, 0]), float(xyz[i, 1]), float(xyz[i, 2]), int(suspect[i]))
                     for i in np.flatnonzero(keep)))
    np.add.at(n_peaks, rows[keep], 1)
    n_suspect = int((suspect & keep).sum())
    log(f"  coordinates: {int(keep.sum()):,} peaks, {n_suspect:,} flagged as suspect ({time.time() - t0:.0f}s)")

    pf = pq.ParquetFile(data_dir / "annotations.parquet")
    term_cols = [c for c in pf.schema_arrow.names if c.startswith("terms_")]
    ann_ids = [str(s) for s in pf.read(columns=["study_id"]).column(0).to_pylist()]
    if set(ann_ids) != set(study_ids):
        raise ValueError("annotations.parquet and metadata.parquet list different studies")
    ann_rows = np.array([row_of[s] for s in ann_ids])
    term_rows, n_pairs = [], 0
    for start in range(0, len(term_cols), 200):            # 200 columns at a time keeps memory low
        cols = term_cols[start:start + 200]
        batch = pf.read(columns=cols)
        for j, col in enumerate(cols):
            values = batch.column(j).to_numpy(zero_copy_only=False).astype(float)
            idx = np.flatnonzero(np.isfinite(values) & (values > 0))
            term_id = start + j
            term_rows.append((term_id, TERM_COLUMN_RE.sub("", col).strip().lower(), int(len(idx))))
            n_terms[ann_rows[idx]] += 1
            con.executemany("INSERT INTO study_terms VALUES (?, ?, ?)",
                            ((term_id, ann_ids[i], float(values[i])) for i in idx))
            n_pairs += len(idx)
    if len({t for _, t, _ in term_rows}) != len(term_rows):
        raise ValueError("duplicate term names after removing the column prefix")
    con.executemany("INSERT INTO terms VALUES (?, ?, ?)", term_rows)
    log(f"  terms: {len(term_rows):,} terms, {n_pairs:,} (term, study) pairs ({time.time() - t0:.0f}s)")

    def year(v):
        try:
            return None if v is None or (isinstance(v, float) and math.isnan(v)) else int(v)
        except (TypeError, ValueError):
            return None

    col = lambda name: meta.get(name, [None] * n_studies)        # noqa: E731
    con.executemany("INSERT INTO studies VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [(study_ids[i], col("title")[i], col("authors")[i], col("journal")[i], year(col("year")[i]),
                      int(n_peaks[i]), int(n_terms[i])) for i in range(n_studies)])
    con.executescript(INDEXES)
    summary = {"studies": n_studies, "coordinates": int(keep.sum()), "suspect_peaks": n_suspect,
               "suspect_studies": len({sid[i] for i in np.flatnonzero(suspect & keep)}),
               "terms": len(term_rows), "study_terms": n_pairs,
               "studies_without_peaks": int((n_peaks == 0).sum()), "studies_without_terms": int((n_terms == 0).sum()),
               "built_at": time.strftime("%Y-%m-%d %H:%M:%S"), "seconds": round(time.time() - t0, 1)}
    con.executemany("INSERT INTO build_info VALUES (?, ?)", [(k, str(v)) for k, v in summary.items()])
    con.commit()
    con.close()
    os.replace(tmp, db_path)
    log(f"Done: {summary}")
    return summary


def database_ready(path: Path = DB_PATH) -> bool:
    if not path.exists():
        return False
    try:
        with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as con:
            return con.execute("SELECT COUNT(*) FROM build_info").fetchone()[0] > 0
    except sqlite3.Error:
        return False


# ---------------------------------------------------------------------------
# 2. Read-only access: one SQLite connection per request, plus an in-memory store
# ---------------------------------------------------------------------------
_regex_cache: dict[str, re.Pattern] = {}


def _regexp(pattern: str, value) -> bool:
    """SQLite calls this for `value REGEXP pattern`; used for title searches."""
    if value is None:
        return False
    rx = _regex_cache.get(pattern)
    if rx is None:
        rx = _regex_cache.setdefault(pattern, re.compile(pattern, re.IGNORECASE))
    return rx.search(value) is not None


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, check_same_thread=False)
    con.create_function("REGEXP", 2, _regexp, deterministic=True)
    return con


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect()
    return g.db


class Store:
    """Things every request needs, read once per process: the vocabulary, study metadata and all peaks.

    Sets of studies are boolean masks over `row_ids` (14,371 bytes each), so caching hundreds of them is
    cheap and AND/OR/NOT are numpy operations. Peaks are kept in memory only to draw maps; which studies
    match a term, a title word or a location is still answered by SQL."""

    def __init__(self, path: Path):
        con = connect(path)
        self.term_id, self.term_n = {}, {}
        for tid, term, n in con.execute("SELECT term_id, term, n_studies FROM terms"):
            self.term_id[term], self.term_n[term] = tid, n
        self.sorted_terms = sorted(self.term_id)
        self.max_words = max(len(t.split()) for t in self.sorted_terms)
        self.studies = {}
        for sid, title, authors, journal, year, npk in con.execute(
                "SELECT study_id, title, authors, journal, year, n_peaks FROM studies"):
            self.studies[sid] = {"study_id": sid, "year": year, "journal": journal, "title": title,
                                 "authors": authors, "n_peaks": npk}
        self.row_ids = sorted(self.studies)
        self.row_of = {sid: i for i, sid in enumerate(self.row_ids)}
        self.n = len(self.row_ids)
        # display order for results: newest first, then by PubMed ID
        self.year_order = np.array(sorted(range(self.n), key=lambda i: (-(self.studies[self.row_ids[i]]["year"] or 0),
                                                                        self.row_ids[i])), np.int64)
        n_peaks = con.execute("SELECT COUNT(*) FROM coordinates WHERE suspect = 0").fetchone()[0]
        self.peak_row = np.empty(n_peaks, np.int32)
        self.peak_xyz = np.empty((n_peaks, 3), np.float32)
        cur, i = con.execute("SELECT study_id, x, y, z FROM coordinates WHERE suspect = 0 ORDER BY rowid"), 0
        while chunk := cur.fetchmany(50_000):          # chunks keep the start-up memory peak small
            self.peak_row[i:i + len(chunk)] = [self.row_of[c[0]] for c in chunk]
            self.peak_xyz[i:i + len(chunk)] = [c[1:] for c in chunk]
            i += len(chunk)
        self.info = dict(con.execute("SELECT key, value FROM build_info").fetchall())
        con.close()
        self.brain_mask = _load_brain_mask()
        import nibabel, scipy.ndimage  # noqa: E401,F401  (imported now so the first map request is not slow)

    def mask(self, study_ids) -> np.ndarray:
        m = np.zeros(self.n, bool)
        m[[self.row_of[s] for s in study_ids]] = True
        m.setflags(write=False)                       # cached masks must never be modified in place
        return m

    def all(self) -> np.ndarray:
        return np.ones(self.n, bool)


def _load_brain_mask():
    """Voxels inside the MNI template that the frontend shows; maps are cut to it (None if not found)."""
    for p in (DIST_DIR / "static" / "mni_2mm.nii.gz", HERE / "public" / "static" / "mni_2mm.nii.gz"):
        if p.exists():
            try:
                import nibabel as nib
                img = nib.load(str(p))
                if img.shape == MNI_SHAPE and np.allclose(img.affine, MNI_AFFINE):
                    return np.asarray(img.dataobj) > 0
            except Exception:                      # pragma: no cover - a broken template only loses the mask
                return None
    return None


_store: Store | None = None
_store_lock = threading.Lock()


def store() -> Store:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = Store(DB_PATH)
    return _store


class LRU:
    """Tiny thread-safe least-recently-used cache."""

    def __init__(self, size: int):
        self.size, self.data, self.lock = size, OrderedDict(), threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]
        return None

    def put(self, key, value):
        with self.lock:
            self.data[key] = value
            self.data.move_to_end(key)
            while len(self.data) > self.size:
                self.data.popitem(last=False)
        return value


ATOM_CACHE, QUERY_CACHE, MAP_CACHE, RELATED_CACHE = LRU(1024), LRU(256), LRU(24), LRU(256)

# ---------------------------------------------------------------------------
# 3. The query language
# ---------------------------------------------------------------------------
# A parsed query is a small tree of tuples:
#   ("term", "default mode")          ("prefix", "emotion", ("emotion", "emotional", ...))
#   ("title", "visual word", regex)   ("point", (x, y, z))
#   ("and", [children])  ("or", [children])  ("not", child)


class QueryError(ValueError):
    def __init__(self, message: str, position: int | None = None):
        super().__init__(message)
        self.position = position


TOKEN_RE = re.compile(r"""
      (?P<ws>\s+)
    | (?P<point>\[[^\]]*\]?)
    | (?P<lp>\()
    | (?P<rp>\))
    | (?P<phrase>"[^"]*"?|'[^']*'?)
    | (?P<word>[^\s()\[\]"]+)
""", re.VERBOSE)
OPERATORS = {"AND", "OR", "NOT"}
NUMBER_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")


def tokenize(text: str) -> list[tuple[str, str, int]]:
    tokens = []
    for m in TOKEN_RE.finditer(text):
        kind, value, pos = m.lastgroup, m.group(), m.start()
        if kind == "ws":
            continue
        if kind == "word" and value.upper() in OPERATORS:
            kind = value.upper()
        elif kind == "point" and not value.endswith("]"):
            raise QueryError("A location is missing its closing ']'", pos)
        elif kind == "phrase" and (len(value) < 2 or value[-1] != value[0]):
            raise QueryError("A quoted phrase is missing its closing quote", pos)
        tokens.append((kind, value, pos))
    return tokens


def parse_point(text: str, pos: int) -> tuple[float, float, float]:
    parts = [p for p in re.split(r"[,\s]+", text[1:-1].strip()) if p]
    if len(parts) != 3 or not all(NUMBER_RE.match(p) for p in parts):
        raise QueryError(f"{text} is not a location; write MNI coordinates as [x,y,z], e.g. [-22,0,-20]", pos)
    x, y, z = (float(p) for p in parts)
    if max(abs(x), abs(y), abs(z)) > MAX_ABS_MM:
        raise QueryError(f"{text} is outside MNI space (each coordinate must be within ±{MAX_ABS_MM:g} mm)", pos)
    return (x, y, z)


def title_regex(words: list[str], prefix: bool = False) -> str:
    body = r"\W+".join(re.escape(w) for w in words)
    return r"\b" + body + (r"\w*" if prefix else r"\b")


class Parser:
    """Recursive descent: or_expr := and_expr (OR and_expr)*;  and_expr := not_expr ([AND] not_expr)*;
    not_expr := NOT not_expr | primary;  primary := ( or_expr ) | [x,y,z] | "phrase" | word+"""

    def __init__(self, text: str, st: Store):
        self.text, self.st = text, st
        self.tokens = tokenize(text)
        self.i = 0
        self.warnings: list[str] = []

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def take(self):
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def parse(self):
        if not self.tokens:
            raise QueryError("The query is empty; type a term such as amygdala or a location such as [-22,0,-20]")
        node = self.or_expr()
        if self.peek() is not None:
            kind, value, pos = self.peek()
            raise QueryError("There is a ')' without a matching '('" if kind == "rp" else f"Unexpected '{value}'", pos)
        return node

    def or_expr(self):
        parts = [self.and_expr()]
        while self.peek() and self.peek()[0] == "OR":
            self.take()
            parts.append(self.and_expr())
        return _join("or", parts)

    def and_expr(self):
        parts = [self.not_expr()]
        while self.peek():
            kind = self.peek()[0]
            if kind == "AND":
                self.take()
            elif kind not in ("word", "phrase", "point", "lp", "NOT"):
                break
            parts.append(self.not_expr())
        return _join("and", parts)

    def not_expr(self):
        if self.peek() and self.peek()[0] == "NOT":
            self.take()
            return ("not", self.not_expr())
        return self.primary()

    def primary(self):
        tok = self.peek()
        if tok is None:
            raise QueryError("The query ends with an operator; add a term or [x,y,z] after it", len(self.text))
        kind, value, pos = tok
        if kind == "lp":
            self.take()
            node = self.or_expr()
            if not self.peek() or self.peek()[0] != "rp":
                raise QueryError("A '(' is never closed; add a ')'", pos)
            self.take()
            return node
        if kind == "point":
            self.take()
            return ("point", parse_point(value, pos))
        if kind == "phrase":
            self.take()
            return self.phrase(value[1:-1], pos)
        if kind == "word":
            words = []
            while self.peek() and self.peek()[0] == "word":
                words.append(self.take())
            return self.word_run(words)
        raise QueryError(f"Expected a term or [x,y,z] but found '{value}'", pos)

    # -- leaves --------------------------------------------------------------
    def prefix(self, stem: str, pos: int):
        stem = stem.lower()
        if len(stem) < 2:
            raise QueryError("Use at least two letters before '*'", pos)
        terms = self.st.sorted_terms
        lo = bisect.bisect_left(terms, stem)
        hits = []
        while lo < len(terms) and terms[lo].startswith(stem):
            hits.append(terms[lo])
            lo += 1
        if hits:
            return ("prefix", stem, tuple(hits))
        self.warnings.append(f"No term starts with '{stem}'; searched titles for words starting with it")
        return ("title", stem + "*", title_regex([stem], prefix=True))

    def phrase(self, inner: str, pos: int):
        words = [w for w in re.split(r"\s+", inner.strip().lower()) if w]
        if not words:
            raise QueryError("An empty pair of quotes", pos)
        if len(words) == 1 and words[0].endswith("*"):
            return self.prefix(words[0][:-1], pos)
        key = " ".join(w for w in words if w not in STOPWORDS) or " ".join(words)
        if key in self.st.term_id:
            return ("term", key)
        self.warnings.append(f"\"{inner.strip()}\" is not a LoTUS term; searched titles for the phrase")
        return ("title", " ".join(words), title_regex(words))

    def word_run(self, toks):
        """Group neighbouring words into the longest vocabulary phrase, left to right."""
        words = [t[1].lower() for t in toks]
        nodes, i = [], 0
        while i < len(words):
            w, pos = words[i], toks[i][2]
            if w.endswith("*"):
                nodes.append(self.prefix(w[:-1], pos))
                i += 1
                continue
            found = None
            for j in range(min(len(words), i + self.st.max_words + 2), i + 1, -1):
                window = words[i:j]
                if any(x.endswith("*") for x in window) or window[0] in STOPWORDS or window[-1] in STOPWORDS:
                    continue
                key = " ".join(x for x in window if x not in STOPWORDS)
                if key in self.st.term_id:
                    found = (j, key)
                    break
            if found:
                nodes.append(("term", found[1]))
                i = found[0]
            elif w in self.st.term_id:
                nodes.append(("term", w))
                i += 1
            elif w in STOPWORDS:
                self.warnings.append(f"Ignored the word '{toks[i][1]}'")
                i += 1
            else:
                self.warnings.append(f"'{toks[i][1]}' is not a LoTUS term; searched titles for it")
                nodes.append(("title", w, title_regex([w])))
                i += 1
        if not nodes:
            raise QueryError("Only common words were given; add a term or [x,y,z]", toks[0][2])
        return _join("and", nodes)


def _join(kind: str, parts: list):
    flat = []
    for p in parts:
        flat.extend(p[1] if p[0] == kind else [p])
    return flat[0] if len(flat) == 1 else (kind, flat)


def leaves(node) -> list:
    if node[0] in ("and", "or"):
        return [x for c in node[1] for x in leaves(c)]
    if node[0] == "not":
        return leaves(node[1])
    return [node]


def fmt_mm(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def to_text(node, parent: str | None = None) -> str:
    """Canonical text of a parsed query: every operator written out, parentheses only where needed."""
    kind = node[0]
    if kind == "term":
        return f'"{node[1]}"' if " " in node[1] else node[1]
    if kind == "prefix":
        return node[1] + "*"
    if kind == "title":
        return f'title:"{node[1]}"'
    if kind == "point":
        return "[" + ",".join(fmt_mm(v) for v in node[1]) + "]"
    if kind == "not":
        return "NOT " + to_text(node[1], "not")
    joined = f" {kind.upper()} ".join(to_text(c, kind) for c in node[1])
    needs = parent == "not" or (kind == "or" and parent == "and")
    return f"({joined})" if needs else joined


FULLWIDTH = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "，": ",", "（": "(", "）": ")",
                           "［": "[", "］": "]", "－": "-", "　": " "})


def compile_query(text: str):
    text = (text or "").translate(FULLWIDTH).strip()     # smart quotes and Chinese-IME punctuation
    if len(text) > MAX_QUERY_CHARS:
        raise QueryError(f"The query is longer than {MAX_QUERY_CHARS} characters")
    parser = Parser(text, store())
    node = parser.parse()
    atoms = leaves(node)
    if len(atoms) > MAX_ATOMS:
        raise QueryError(f"The query has {len(atoms)} terms/locations; the limit is {MAX_ATOMS}")
    if sum(a[0] == "point" for a in atoms) > MAX_POINTS:
        raise QueryError(f"At most {MAX_POINTS} locations per query")
    return node, list(dict.fromkeys(parser.warnings))


SQL_POINT = """SELECT DISTINCT study_id FROM coordinates
WHERE x BETWEEN :x0 AND :x1 AND y BETWEEN :y0 AND :y1 AND z BETWEEN :z0 AND :z1
  AND (x - :x) * (x - :x) + (y - :y) * (y - :y) + (z - :z) * (z - :z) <= :r2
  AND suspect = 0"""


def atom_mask(node, r: float) -> np.ndarray:
    """Which studies one leaf matches, answered by SQL and cached as a boolean mask."""
    key = (to_text(node), r if node[0] == "point" else None)
    hit = ATOM_CACHE.get(key)
    if hit is not None:
        return hit
    st, kind = store(), node[0]
    if kind == "term":
        rows = db().execute("SELECT study_id FROM study_terms WHERE term_id = ?", (st.term_id[node[1]],))
    elif kind == "prefix":
        ids = [st.term_id[t] for t in node[2]]
        rows = db().execute(f"SELECT DISTINCT study_id FROM study_terms WHERE term_id IN ({','.join('?' * len(ids))})", ids)
    elif kind == "title":
        rows = db().execute("SELECT study_id FROM studies WHERE title REGEXP ?", (node[2],))
    elif kind == "point":
        x, y, z = node[1]
        rows = db().execute(SQL_POINT, {"x": x, "y": y, "z": z, "r2": r * r, "x0": x - r, "x1": x + r,
                                        "y0": y - r, "y1": y + r, "z0": z - r, "z1": z + r})
    else:                                           # pragma: no cover - the parser never makes other leaves
        raise ValueError(kind)
    return ATOM_CACHE.put(key, st.mask(row[0] for row in rows))


def evaluate(node, r: float) -> np.ndarray:
    """The whole formula at once, so OR and NOT work across terms and locations."""
    kind = node[0]
    if kind == "or":
        out = np.zeros(store().n, bool)
        for c in node[1]:
            out |= evaluate(c, r)
        return out
    if kind == "not":
        return ~evaluate(node[1], r)
    if kind == "and":
        out = store().all()
        for c in node[1]:                            # A AND NOT B is A minus B
            out &= ~evaluate(c[1], r) if c[0] == "not" else evaluate(c, r)
        return out
    return atom_mask(node, r)


def run_query(text: str, r: float) -> dict:
    """Parse + evaluate, cached by the canonical form of the query (and r)."""
    node, warnings = compile_query(text)
    canonical = to_text(node)
    cached = QUERY_CACHE.get((canonical, r))
    if cached is None:
        mask = evaluate(node, r)
        mask.setflags(write=False)
        atoms = []
        for leaf in dict.fromkeys(leaves(node)):
            entry = {"kind": "location" if leaf[0] == "point" else leaf[0], "text": to_text(leaf),
                     "n": int(atom_mask(leaf, r).sum())}
            if leaf[0] == "point":
                entry["xyz"], entry["r"] = list(leaf[1]), r
            if leaf[0] == "prefix":
                entry["expands_to"] = list(leaf[2][:12]) + (["…"] if len(leaf[2]) > 12 else [])
                entry["n_terms"] = len(leaf[2])
            atoms.append(entry)
        has_loc = any(a["kind"] == "location" for a in atoms)
        cached = QUERY_CACHE.put((canonical, r), {
            "mask": mask, "count": int(mask.sum()), "parsed": canonical, "atoms": atoms,
            "applied": {"locations": has_loc, "terms": any(a["kind"] != "location" for a in atoms),
                        "r": r if has_loc else None}})
    return {**cached, "warnings": warnings}


# ---------------------------------------------------------------------------
# 4. Maps
# ---------------------------------------------------------------------------
def density_map(studies: np.ndarray, fwhm: float, kernel: str, mask: bool):
    """Peaks of the matched studies counted on the 2 mm MNI grid, then smoothed (Tren's definition)."""
    st = store()
    pts = st.peak_xyz[studies[st.peak_row]].astype(np.float64)
    ijk = np.rint((pts - MNI_AFFINE[:3, 3]) / np.diag(MNI_AFFINE)[:3]).astype(np.int64)
    inside = np.all((ijk >= 0) & (ijk < np.array(MNI_SHAPE)), axis=1)
    vol = np.zeros(MNI_SHAPE, np.float64)
    np.add.at(vol, tuple(ijk[inside].T), 1.0)
    if fwhm > 0 and kernel == "gauss":
        from scipy.ndimage import gaussian_filter
        vol = gaussian_filter(vol, sigma=fwhm / (2 * math.sqrt(2 * math.log(2))) / 2.0, mode="constant", truncate=3.0)
    elif fwhm > 0 and kernel == "uniform":           # a ball of diameter = fwhm, each peak spread evenly over it
        vol = ball_smooth(vol, radius_vox=fwhm / 2.0 / 2.0)
    if mask and st.brain_mask is not None:
        vol = vol * st.brain_mask
    return vol.astype(np.float32), int(inside.sum())


def ball_smooth(vol: np.ndarray, radius_vox: float) -> np.ndarray:
    """Convolve with a normalised ball using numpy's FFT (zero padding, so nothing wraps around)."""
    n = int(math.ceil(radius_vox))
    gx, gy, gz = np.mgrid[-n:n + 1, -n:n + 1, -n:n + 1]
    ball = ((gx ** 2 + gy ** 2 + gz ** 2) <= radius_vox ** 2).astype(np.float64)
    ball /= ball.sum()
    shape = [s + 2 * n for s in vol.shape]
    out = np.fft.irfftn(np.fft.rfftn(vol, shape) * np.fft.rfftn(ball, shape), shape)
    return np.clip(out[n:n + vol.shape[0], n:n + vol.shape[1], n:n + vol.shape[2]], 0, None)


def nifti_gz(vol: np.ndarray) -> bytes:
    """Smoothed values are kept to 1/4096 of the map's maximum and anything under 0.1% of it becomes 0.
    No voxel moves by more than 0.1% of the maximum, and the .nii.gz is about half the size.
    Unsmoothed maps are whole peak counts and are stored exactly."""
    import nibabel as nib
    vmax = float(vol.max())
    if vmax > 0 and not np.array_equal(vol, np.round(vol)):
        step = vmax / 4096
        vol = np.where(vol < vmax * 1e-3, 0, np.round(vol / step) * step).astype(np.float32)
    img = nib.Nifti1Image(vol, MNI_AFFINE)
    img.set_sform(MNI_AFFINE, code=4)
    img.set_qform(MNI_AFFINE, code=4)
    hdr = img.header
    hdr.set_xyzt_units("mm", "sec")
    hdr["cal_min"], hdr["cal_max"] = 0.0, float(vol.max())
    hdr["descrip"] = b"LoTUS-BF smoothed peak density"
    return gzip.compress(img.to_bytes(), compresslevel=6, mtime=0)


# ---------------------------------------------------------------------------
# 5. Flask
# ---------------------------------------------------------------------------
def number_arg(name: str, default: float, lo: float, hi: float) -> float:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        v = float(raw)
    except ValueError:
        abort(400, description=f"{name} must be a number")
    if not (lo <= v <= hi) or not math.isfinite(v):
        abort(400, description=f"{name} must be between {lo:g} and {hi:g}")
    return v


def paging():
    def as_int(name):
        raw = request.args.get(name)
        if raw in (None, ""):
            return None
        if not raw.isdigit():
            abort(400, description=f"{name} must be a non-negative integer")
        return int(raw)
    return as_int("limit"), as_int("offset") or 0


def page(items: list, limit, offset) -> list:
    return items[offset:] if limit is None else items[offset:offset + limit]


def query_or_400(text: str, r: float) -> dict:
    try:
        return run_query(text, r)
    except QueryError as e:
        abort(400, description={"error": str(e), "position": e.position, "query": text})


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.json.sort_keys = False
    app.json.ensure_ascii = False
    app.url_map.strict_slashes = False

    @app.teardown_appcontext
    def close_db(_exc):
        con = g.pop("db", None)
        if con is not None:
            con.close()

    @app.errorhandler(400)
    @app.errorhandler(404)
    @app.errorhandler(405)
    @app.errorhandler(500)
    @app.errorhandler(503)
    def json_error(e):
        code = getattr(e, "code", 500) or 500
        desc = getattr(e, "description", None) or str(e)
        body = desc if isinstance(desc, dict) else {"error": desc}
        return jsonify({**body, "status": code}), code

    ready = {"ok": False}

    @app.before_request
    def need_database():
        if request.path.startswith(("/terms", "/query", "/studies")) and not ready["ok"]:
            if not database_ready():
                abort(503, description="The database is not built yet: run `python app.py build-db`")
            ready["ok"] = True

    @app.after_request
    def finish(resp: Response):
        resp.headers.setdefault("Access-Control-Allow-Origin", "*")
        resp.headers["Access-Control-Expose-Headers"] = ("X-Lotus-Studies, X-Lotus-Peaks, X-Lotus-Max, X-Lotus-Top, "
                                                         "Content-Disposition")
        if request.path.startswith(("/terms", "/query", "/studies")) and resp.status_code == 200:
            resp.headers.setdefault("Cache-Control", "public, max-age=300")
        if (resp.mimetype == "application/json" and resp.status_code == 200 and not resp.direct_passthrough
                and "gzip" in request.headers.get("Accept-Encoding", "").lower()
                and "Content-Encoding" not in resp.headers):
            data = resp.get_data()
            if len(data) > 1400:
                resp.set_data(gzip.compress(data, compresslevel=5))
                resp.headers["Content-Encoding"] = "gzip"
                resp.headers.add("Vary", "Accept-Encoding")
        return resp

    # -- terms -----------------------------------------------------------------
    @app.get("/terms")
    def all_terms():
        st = store()
        items = [{"term": t, "n_studies": st.term_n[t]} for t in st.sorted_terms if not t[0].isdigit()]
        return jsonify({"terms": [i["term"] for i in items], "items": items})

    @app.get("/terms/<path:term>")
    def related_terms(term):
        st = store()
        name = re.sub(r"\s+", " ", term.replace("_", " ")).strip().lower()
        if name not in st.term_id:
            close = [t for t in st.sorted_terms if name and (t.startswith(name.split()[0]) or name in t)][:8]
            abort(404, description={"error": f"'{term}' is not a LoTUS term", "suggestions": close})
        limit, offset = paging()
        limit = 30 if limit is None else min(limit, 500)
        related = RELATED_CACHE.get(name)
        if related is None:
            tid, n_a = st.term_id[name], st.term_n[name]
            rows = db().execute("""
                SELECT t.term, t.n_studies, COUNT(*) AS co
                FROM study_terms AS a
                JOIN study_terms AS b ON b.study_id = a.study_id AND b.term_id != a.term_id
                JOIN terms AS t ON t.term_id = b.term_id
                WHERE a.term_id = ?
                GROUP BY b.term_id""", (tid,)).fetchall()
            words = set(name.split())
            trivial = lambda t: set(t.split()) <= words or f" {name} " in f" {t} "   # noqa: E731
            # skip terms that only repeat the words of the term itself ("default mode" -> "mode")
            related = [{"term": t, "co_count": co, "jaccard": round(co / (n_a + n_b - co), 4), "n_studies": n_b}
                       for t, n_b, co in rows if not t[0].isdigit() and not trivial(t)]
            related.sort(key=lambda d: (-d["jaccard"], -d["co_count"], d["term"]))
            RELATED_CACHE.put(name, related)
        return jsonify({"term": name, "n_studies": st.term_n[name], "related": related[offset:offset + limit]})

    # -- mixed queries -------------------------------------------------------------
    @app.get("/query/<path:q>/studies")
    def query_studies(q):
        r = number_arg("r", DEFAULT_R, 0.0, MAX_R)
        res = query_or_400(q, r)
        st = store()
        order = st.year_order[res["mask"][st.year_order]]       # newest first, then PubMed ID
        limit, offset = paging()
        rows = [st.studies[st.row_ids[i]] for i in page(order, limit, offset)]
        return jsonify({"query": q, "parsed": res["parsed"], "count": res["count"], "applied": res["applied"],
                        "atoms": res["atoms"], "warnings": res["warnings"], "results": rows})

    @app.get("/query/<path:q>/locations")
    def query_locations(q):
        r = number_arg("r", DEFAULT_R, 0.0, MAX_R)
        res = query_or_400(q, r)
        st = store()
        sel = np.flatnonzero(res["mask"][st.peak_row])
        out = [{"study_id": st.row_ids[st.peak_row[i]], "x": float(st.peak_xyz[i, 0]),
                "y": float(st.peak_xyz[i, 1]), "z": float(st.peak_xyz[i, 2])} for i in sel]
        out.sort(key=lambda d: (d["study_id"], d["x"], d["y"], d["z"]))
        limit, offset = paging()
        shown = page(out, limit, offset)
        return jsonify({"parsed": res["parsed"], "location_counts": len(shown),
                        "study_counts": len({d["study_id"] for d in shown}), "total_locations": len(out),
                        "results": shown})

    @app.get("/query/<path:q>/nii")
    def query_map(q):
        r = number_arg("r", DEFAULT_R, 0.0, MAX_R)
        fwhm = number_arg("fwhm", DEFAULT_FWHM, 0.0, MAX_FWHM)
        voxel = number_arg("voxel", 2.0, 0.5, 10.0)
        if voxel != 2.0:
            abort(400, description="Only the 2 mm MNI152 grid is available (voxel=2)")
        kernel = (request.args.get("kernel") or "gauss").lower()
        if kernel not in ("gauss", "uniform"):
            abort(400, description="kernel must be gauss or uniform")
        mask = request.args.get("mask", "1") not in ("0", "false", "no")
        res = query_or_400(q, r)
        key = (res["parsed"], r, fwhm, kernel, mask)
        hit = MAP_CACHE.get(key)
        if hit is None:
            vol, n_peaks = density_map(res["mask"], fwhm, kernel, mask)
            ijk = np.unravel_index(int(np.argmax(vol)), vol.shape)          # where the map is highest
            top = (MNI_AFFINE @ np.array([*ijk, 1.0]))[:3]
            hit = MAP_CACHE.put(key, (nifti_gz(vol), n_peaks, float(vol.max()), ",".join(fmt_mm(v) for v in top)))
        data, n_peaks, vmax, top = hit
        slug = re.sub(r"[^A-Za-z0-9]+", "_", res["parsed"]).strip("_")[:60] or "query"
        return Response(data, mimetype="application/gzip", headers={
            "Content-Disposition": f'attachment; filename="lotus_{slug}.nii.gz"',
            "X-Lotus-Studies": str(res["count"]), "X-Lotus-Peaks": str(n_peaks), "X-Lotus-Max": f"{vmax:.6g}",
            "X-Lotus-Top": top})

    # -- one study -----------------------------------------------------------------
    @app.get("/studies/<study_id>")
    def one_study(study_id):
        st = store()
        if study_id not in st.studies:
            abort(404, description=f"Unknown study_id '{study_id}' (use a PubMed ID such as 10022492)")
        terms = db().execute("""SELECT t.term, st.weight FROM study_terms AS st JOIN terms AS t USING (term_id)
                                WHERE st.study_id = ? ORDER BY st.weight DESC, t.term""", (study_id,)).fetchall()
        peaks = db().execute("SELECT x, y, z, suspect FROM coordinates WHERE study_id = ? ORDER BY rowid",
                             (study_id,)).fetchall()
        return jsonify({**st.studies[study_id],
                        "terms": [{"term": t, "weight": round(w, 4)} for t, w in terms if not t[0].isdigit()][:25],
                        "peaks": [[float(x), float(y), float(z)] for x, y, z, _ in peaks],
                        "suspect": [bool(s) for *_, s in peaks]})

    # -- docs and health ---------------------------------------------------------
    @app.get("/help")
    def help_page():
        return jsonify(HELP)

    @app.get("/health")
    def health():
        if not database_ready():
            return jsonify({"ok": False, "error": "database not built"}), 503
        st = store()
        return jsonify({"ok": True, "studies": len(st.studies), "terms": len(st.term_id),
                        "peaks": int(len(st.peak_row)), "suspect_peaks": int(st.info.get("suspect_peaks", 0)),
                        "build": st.info,
                        "frontend": (DIST_DIR / "index.html").exists(), "brain_mask": st.brain_mask is not None})

    # -- the React frontend --------------------------------------------------------
    def from_dist(path: str):
        if not (DIST_DIR / path).is_file():
            abort(404, description=f"Not found: /{path}")
        resp = send_from_directory(DIST_DIR, path, max_age=0 if path == "index.html" else 3600)
        if path.startswith("assets/"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    @app.get("/")
    def index():
        if not (DIST_DIR / "index.html").is_file():
            return ("<p>LoTUS-BF API is running. The frontend is not built yet: run <code>npm run build</code>. "
                    "See <a href='/help'>/help</a>.</p>")
        return from_dist("index.html")

    @app.get("/lotus-bf")
    def lotus_bf_root():
        return app.redirect("/lotus-bf/")

    @app.get("/lotus-bf/")
    @app.get("/lotus-bf/<path:path>")
    def lotus_bf(path: str = "index.html"):
        return from_dist(path)

    @app.get("/assets/<path:path>")
    def assets(path):
        return from_dist("assets/" + path)

    @app.get("/static/<path:path>")
    def static_files(path):
        return from_dist("static/" + path)

    @app.get("/favicon.svg")
    @app.get("/logo.svg")
    def logo():
        return from_dist(request.path.lstrip("/"))

    return app


HELP = {
    "service": {"name": "LoTUS-BF", "tagline": "Location-or-Term Unified Search for Brain Functions"},
    "ok": True,
    "endpoints": ["/terms", "/terms/<term>", "/query/<query_string>/studies", "/query/<query_string>/locations",
                  "/query/<query_string>/nii", "/studies/<study_id>", "/health"],
    "notes": "One boolean expression mixes vocabulary terms and [x,y,z] locations; it is evaluated as a whole, "
             "so OR and NOT work across terms and locations.",
    "docs": {
        "syntax": {
            "terms": "vocabulary terms from Neurosynth abstracts (tf-idf > 0); neighbouring words are joined into "
                     "the longest vocabulary phrase; quotes keep a phrase together; term* matches every term that "
                     "starts with 'term'; words outside the vocabulary are searched in titles",
            "locations": "[x,y,z] in MNI mm: studies with a peak within r mm (default 6). 1,182 rows that are not "
                         "coordinates (three consecutive integers such as 1,2,3, or all three values within 1 mm of 0) "
                         "are kept in /studies/<id> but not searched and not drawn",
            "operators": ["AND", "OR", "NOT", "(", ")"],
            "precedence": "NOT > AND > OR; two items side by side mean AND",
        },
        "params": {
            "r": f"sphere radius in mm around every [x,y,z] (default {DEFAULT_R:g}, 0-{MAX_R:g})",
            "fwhm": f"smoothing of the map in mm (default {DEFAULT_FWHM:g}, 0-{MAX_FWHM:g})",
            "kernel": "gauss | uniform (map smoothing kernel)",
            "voxel": "2 (the only grid)",
            "mask": "1 (default) keeps the map inside the MNI brain; 0 keeps everything",
            "limit, offset": "paging for /studies and /locations",
        },
        "examples": [
            "/query/amygdala/studies",
            "/query/[-22,0,-20]/studies?r=8",
            '/query/"default mode" NOT [0,-52,26]/studies',
            "/query/(pain OR nociceptive) AND [0,6,40]/nii?fwhm=8",
            "/query/emotion* NOT faces/locations",
        ],
    },
}

app = create_app()   # WSGI entry point: gunicorn app:app


def main(argv=None):
    p = argparse.ArgumentParser(description="LoTUS-BF backend")
    p.add_argument("command", nargs="?", choices=["serve", "build-db"], default="serve")
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--debug", action="store_true")
    p.add_argument("--data-dir", default=None)
    p.add_argument("--if-missing", action="store_true", help="build-db: skip when the database already exists")
    args = p.parse_args(argv)
    if args.command == "build-db":
        if args.if_missing and database_ready():
            print(f"database already built: {DB_PATH}", flush=True)
            return
        build_database(DB_PATH, find_data_dir(args.data_dir))
        return
    if not database_ready():
        build_database(DB_PATH, find_data_dir(args.data_dir))
    port = args.port or int(os.getenv("PORT", "5000"))
    host = args.host or ("0.0.0.0" if os.getenv("PORT") else "127.0.0.1")
    print(f"LoTUS-BF on http://{host}:{port}  (database {DB_PATH})", flush=True)
    app.run(host=host, port=port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    sys.exit(main())
