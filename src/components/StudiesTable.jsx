import { useMemo, useState } from 'react'
import { DownloadIcon, ExternalIcon, SearchIcon } from './Icons'
import { getJSON, urls } from '../lib/api'
import { downloadText, firstAuthors, fmt, slugify, toCSV } from '../lib/query'

const SORTS = {
  newest: { label: 'Newest first', compare: (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.study_id.localeCompare(b.study_id) },
  oldest: { label: 'Oldest first', compare: (a, b) => (a.year ?? 0) - (b.year ?? 0) || a.study_id.localeCompare(b.study_id) },
  title: { label: 'Title A–Z', compare: (a, b) => text(a.title).localeCompare(text(b.title), 'en', { sensitivity: 'base' }) },
  journal: { label: 'Journal A–Z', compare: (a, b) => text(a.journal).localeCompare(text(b.journal), 'en', { sensitivity: 'base' }) },
  author: { label: 'First author A–Z', compare: (a, b) => text(a.authors).localeCompare(text(b.authors), 'en', { sensitivity: 'base' }) },
  peaks: { label: 'Most peaks', compare: (a, b) => (b.n_peaks ?? 0) - (a.n_peaks ?? 0) },
}
const PAGE_SIZES = [20, 50, 100]
const text = (v) => String(v ?? '')

// GET /query/<q>/studies (fetched in App and shared with the query bar) + GET /query/<q>/locations for the export.
export default function StudiesTable({ result, query, radius, onOpen }) {
  const { data, error, loading } = result
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [filter, setFilter] = useState('')
  const [exportState, setExportState] = useState('')
  const [seenQuery, setSeenQuery] = useState(query)
  if (seenQuery !== query) {
    // a new search starts on the first page with no filter
    setSeenQuery(query)
    setPage(0)
    setFilter('')
  }

  const rows = useMemo(() => data?.results ?? [], [data])
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = f
      ? rows.filter((r) => `${r.title} ${r.authors} ${r.journal} ${r.year} ${r.study_id}`.toLowerCase().includes(f))
      : rows
    return [...list].sort(SORTS[sort].compare)
  }, [rows, filter, sort])

  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const current = Math.min(page, pages - 1)
  const pageRows = shown.slice(current * pageSize, (current + 1) * pageSize)

  const exportStudies = () =>
    downloadText(
      `lotus_studies_${slugify(query)}.csv`,
      toCSV(shown.map((r) => ({ ...r, pubmed: urls.pubmed(r.study_id) })), ['study_id', 'year', 'journal', 'title', 'authors', 'n_peaks', 'pubmed']),
    )

  const exportPeaks = async () => {
    setExportState('busy')
    try {
      const d = await getJSON(urls.locations(query, radius))
      downloadText(`lotus_peaks_${slugify(query)}.csv`, toCSV(d.results, ['study_id', 'x', 'y', 'z']))
      setExportState('')
    } catch (e) {
      setExportState(`Peaks export failed: ${e.message}`)
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">Studies</h2>
        {data && (
          <span className="rounded-full bg-lotus-100 px-2 py-0.5 text-xs font-semibold text-lotus-800 tabular-nums">{fmt(data.count)}</span>
        )}
        {loading && <span className="text-xs text-slate-400">updating…</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportStudies}
            disabled={!shown.length}
            title="Download these studies as a spreadsheet"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-lotus-300 hover:text-lotus-700 disabled:opacity-40"
          >
            <DownloadIcon className="size-3.5" /> Studies CSV
          </button>
          <button
            type="button"
            onClick={exportPeaks}
            disabled={!rows.length || exportState === 'busy'}
            title="Download every reported peak of these studies (MNI x, y, z)"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700 disabled:opacity-40"
          >
            <DownloadIcon className="size-3.5" /> {exportState === 'busy' ? 'Preparing…' : 'Peaks CSV'}
          </button>
        </div>
        {exportState && exportState !== 'busy' && <p className="w-full text-xs text-rose-700">{exportState}</p>}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <label className="relative min-w-40 flex-1">
            <span className="sr-only">Filter these studies</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setPage(0)
              }}
              placeholder="Filter by title, author, journal or year…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1 pr-2 pl-7 text-xs outline-none focus:border-lotus-400 focus:bg-white focus:ring-2 focus:ring-lotus-100"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-slate-700">
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <p className="px-4 py-10 text-center text-sm text-slate-500">Fix the query above to see studies.</p>}

      {!data && loading && (
        <div className="space-y-3 p-4">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          <p className="font-medium text-slate-700">No study matches all of that.</p>
          <p className="mt-1">Try a larger radius, OR instead of AND, or fewer NOTs.</p>
        </div>
      )}

      {data && rows.length > 0 && (
        <ol className={`divide-y divide-slate-100 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {pageRows.map((r) => (
            <li key={r.study_id} className="group flex gap-3 px-4 py-2.5 hover:bg-lotus-50/60">
              <span className="w-10 shrink-0 pt-0.5 text-xs font-medium text-slate-400 tabular-nums">{r.year}</span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(r.study_id)}
                  className="text-left text-sm leading-snug font-medium text-slate-800 group-hover:text-lotus-800 hover:underline"
                >
                  {r.title}
                </button>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {firstAuthors(r.authors)}
                  <span className="text-slate-300"> · </span>
                  <span className="italic">{r.journal}</span>
                </div>
              </div>
              <a
                href={urls.pubmed(r.study_id)}
                target="_blank"
                rel="noreferrer"
                title="Open in PubMed"
                aria-label={`Open ${r.study_id} in PubMed`}
                className="shrink-0 self-start rounded p-1 text-slate-300 hover:bg-white hover:text-lotus-600"
              >
                <ExternalIcon className="size-4" />
              </a>
            </li>
          ))}
          {pageRows.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              Nothing in these {fmt(rows.length)} studies matches “{filter}”.
            </li>
          )}
        </ol>
      )}

      {data && shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>
            {fmt(current * pageSize + 1)}–{fmt(Math.min(shown.length, (current + 1) * pageSize))} of {fmt(shown.length)}
            {filter && ` (filtered from ${fmt(rows.length)})`} · click a title for its terms and peaks
          </span>
          <div className="flex items-center gap-1">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
              className="mr-2 rounded border border-slate-200 bg-white px-1 py-0.5"
              aria-label="Studies per page"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <PageButton disabled={current === 0} onClick={() => setPage(0)} label="First page">«</PageButton>
            <PageButton disabled={current === 0} onClick={() => setPage(current - 1)} label="Previous page">‹</PageButton>
            <span className="px-1 tabular-nums">
              {current + 1} / {pages}
            </span>
            <PageButton disabled={current >= pages - 1} onClick={() => setPage(current + 1)} label="Next page">›</PageButton>
            <PageButton disabled={current >= pages - 1} onClick={() => setPage(pages - 1)} label="Last page">»</PageButton>
          </div>
        </div>
      )}
    </div>
  )
}

function PageButton({ children, label, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="min-w-7 rounded-md border border-slate-200 px-1.5 py-0.5 text-sm text-slate-600 hover:border-lotus-300 hover:text-lotus-700 disabled:opacity-30"
      {...rest}
    >
      {children}
    </button>
  )
}
