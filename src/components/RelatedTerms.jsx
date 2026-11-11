import { XIcon } from './Icons'
import { useRequest } from '../hooks/useRequest'
import { getJSON, urls } from '../lib/api'
import { fmt } from '../lib/query'

// GET /terms/<term>: terms that appear in the same abstracts (Jaccard overlap of their study sets).
export default function RelatedTerms({ term, onAdd, onClose }) {
  const { data, error, loading } = useRequest(urls.related(term, 18), getJSON)

  return (
    <div className="rounded-xl border border-lotus-100 bg-lotus-50/60 p-2.5">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-xs text-slate-600">
          Often studied with <span className="font-semibold text-lotus-800">{term}</span>
          {data && <span className="text-slate-400"> ({fmt(data.n_studies)} studies)</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="Hide related terms" className="rounded p-0.5 text-slate-400 hover:text-slate-600">
          <XIcon className="size-3.5" />
        </button>
      </div>
      {loading && !data && <div className="h-12 animate-pulse rounded-lg bg-white/70" />}
      {error && <p className="text-xs text-rose-700">{error.message}</p>}
      {data && (
        <div className="flex flex-wrap gap-1">
          {data.related.map((r) => (
            <button
              key={r.term}
              type="button"
              onClick={() => onAdd(r.term)}
              title={`${fmt(r.co_count)} studies use both · overlap ${(r.jaccard * 100).toFixed(0)}%`}
              className="rounded-full border border-lotus-200 bg-white px-2 py-0.5 text-xs text-lotus-800 hover:border-lotus-400 hover:bg-lotus-100"
            >
              {r.term}
              <span className="ml-1 text-[10px] text-lotus-400 tabular-nums">{(r.jaccard * 100).toFixed(0)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
