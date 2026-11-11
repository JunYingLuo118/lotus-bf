# LoTUS-BF

**Location-or-Term Unified Search for Brain Functions.** Search 14,371 neuroimaging studies from Neurosynth by
what their abstracts talk about (a term), by where they report activation (an MNI coordinate), or both in one
boolean query, and see where the matching studies report their peaks on a 3D brain.

This is a rebuilt frontend and backend for the LoTUS-BF course project (Psychoinformatics & Neuroinformatics,
National Taiwan University, Tren Huang). The API keeps the routes of the original version, so the original
frontend also runs against this backend.

## Query language

| You type | It finds |
|---|---|
| `amygdala` | studies whose abstract uses the term (Neurosynth rule: tf-idf > 0) |
| `default mode` | neighbouring words become one term when the vocabulary has that phrase |
| `"theory of mind"` | quotes keep a phrase together; stop words such as *of* are skipped |
| `emotion*` | every term that starts with *emotion* |
| `[-22,0,-20]` | studies with a peak within *r* mm (default 6) of this MNI coordinate |
| `A B`, `A AND B` / `A OR B` / `A NOT B` / `( … )` | boolean logic; NOT binds tightest, then AND, then OR |

The whole expression is evaluated as one formula, so `amygdala OR [0,-52,26]` really is a union, and words that
are not in the vocabulary are searched in titles (the answer says so).

1,182 of the 507,891 peaks (0.23%) are not coordinates but numbers the automatic table extraction misread: three
consecutive integers in some order (1,2,3 / 17,18,19: row or column numbers) or three values all within 1 mm of
zero (p-values). They stay in the database and are shown greyed out in a study's details, but searches and maps
leave them out; otherwise they pile up near [0,0,0] and become the top of large maps such as *default mode*.

## API

| Endpoint | Component that uses it | Returns |
|---|---|---|
| `GET /terms` | `TermsPanel` | vocabulary terms with study counts |
| `GET /terms/<term>` | `RelatedTerms` | terms used in the same abstracts (Jaccard) |
| `GET /query/<q>/studies?r=6` | `QueryBar` + `StudiesTable` | matching studies, how the query was read, per-term counts |
| `GET /query/<q>/locations?r=6` | `StudiesTable` (Peaks CSV) | every peak of the matching studies |
| `GET /query/<q>/nii?r=6&fwhm=10&kernel=gauss` | `BrainViewer` | smoothed peak-density map, NIfTI on the MNI152 2 mm grid |
| `GET /studies/<pmid>` | `StudyDrawer` | one study: metadata, strongest terms, peaks |
| `GET /help`, `GET /health` | | documentation, database status |

## Run it locally

```bash
pip install -r requirements.txt
python app.py            # builds lotus.sqlite on first run (~10 s), then serves API + frontend on :5000
```

Frontend development (Node.js 20.19+):

```bash
npm install
npm run dev              # http://localhost:3000, API calls are proxied to python app.py on :5000
npm run build            # writes dist/, which app.py serves
npm run lint
```

## Deploy (Render, free plan)

Push this folder to a GitHub repository (including `dist/` and `data/`, excluding `node_modules/` and
`lotus.sqlite`), then on Render choose **New + → Blueprint** and pick the repository; `render.yaml` does the rest.

## What is in here

- `app.py` the whole backend: Parquet → SQLite loader, query parser, API, NIfTI maps, static files
- `src/` React 19 + Tailwind CSS 4 + NiiVue frontend; `dist/` its production build
- `data/` `coordinates.parquet`, `metadata.parquet`, `annotations.parquet` from
  [spiketren/ns-nano](https://github.com/spiketren/ns-nano)
- `public/static/mni_2mm.nii.gz` the MNI152 2 mm template from the original LoTUS-BF package

Data: the Neurosynth database (Yarkoni et al., 2011). Viewer: [NiiVue](https://niivue.com).
