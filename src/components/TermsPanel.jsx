import { useDeferredValue, useMemo, useState } from 'react'
import RelatedTerms from './RelatedTerms'
import { SearchIcon, XIcon } from './Icons'
import { useRequest } from '../hooks/useRequest'
import { getJSON, urls } from '../lib/api'
import { fmt } from '../lib/query'

const SHOW = 250

// GET /terms: the vocabulary, searchable, with how many studies use each term.
export default function TermsPanel({ onAdd, selected, onSelect }) {
  const { data, error, loading } = useRequest(urls.terms(), getJSON)
  const [search, setSearch] = useState('')
  const [order, setOrder] = useState('az')
  const needle = useDeferredValue(search.trim().toLowerCase())

  const matches = useMemo(() => {
    const items = data?.items ?? []
    if (needle) {
      // words that start with what you typed come first, then the rest, bigger terms first
      const rank = (t) => (t === needle ? 0 : t.startsWith(needle) ? 1 : t.split(' ').some((w) => w.startsWith(needle)) ? 2 : 3)
      return items
        .filter((i) => i.term.includes(needle))
        .sort((a, b) => rank(a.term) - rank(b.term) || b.n_studies - a.n_studies)
    }
    return order === 'count' ? [...items].sort((a, b) => b.n_studies - a.n_studies) : items
  }, [data, needle, order])

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:max-h-[calc(100vh-7rem)]">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-900">Terms</h2>
        {data && <span className="text-xs text-slate-400">{fmt(data.items.length)} in the vocabulary</span>}
      </div>

      {selected && <RelatedTerms term={selected} onAdd={onAdd} onClose={() => onSelect(null)} />}

      <label className="relative">
        <span className="sr-only">Search terms</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a term…"
          className="w-full rounded-lg border border-slate-300 py-1.5 pr-8 pl-8 text-sm outline-none focus:border-lotus-400 focus:ring-4 focus:ring-lotus-100"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear the term search"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </label>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Click a term to add it</span>
        {!needle && (
          <select value={order} onChange={(e) => setOrder(e.target.value)} className="rounded border border-slate-200 bg-white px-1 py-0.5">
            <option value="az">A–Z</option>
            <option value="count">Most studies</option>
          </select>
        )}
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">Could not load terms: {error.message}</p>}
      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      )}

      {data && (
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto pr-1 max-lg:max-h-[60vh]">
          {matches.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">No term contains “{search}”.</li>}
          {matches.slice(0, SHOW).map(({ term, n_studies: n }) => (
            <li key={term} className="group flex items-center rounded-lg hover:bg-lotus-50">
              <button
                type="button"
                onClick={() => onAdd(term)}
                title={`Add ${term} to the query`}
                aria-label={`Add ${term} (${fmt(n)} studies) to the query`}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1 text-left text-sm"
              >
                <span className={`truncate ${term === selected ? 'font-semibold text-lotus-700' : 'text-slate-700'}`}>
                  <Highlight text={term} needle={needle} />
                </span>
                <span className="shrink-0 text-xs text-slate-400 tabular-nums">{fmt(n)}</span>
              </button>
              <span className="flex shrink-0 gap-0.5 pr-1 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onAdd(term, 'NOT')}
                  title={`Exclude studies about ${term}`}
                  aria-label={`Exclude ${term}`}
                  className="rounded px-1 font-mono text-[10px] font-semibold text-slate-500 hover:bg-white hover:text-rose-700"
                >
                  NOT
                </button>
                <button
                  type="button"
                  onClick={() => onAdd(term, 'OR')}
                  title={`Also include studies about ${term}`}
                  aria-label={`Or ${term}`}
                  className="rounded px-1 font-mono text-[10px] font-semibold text-slate-500 hover:bg-white hover:text-lotus-700"
                >
                  OR
                </button>
              </span>
            </li>
          ))}
          {matches.length > SHOW && (
            <li className="px-2 py-2 text-xs text-slate-400">
              Showing {SHOW} of {fmt(matches.length)}. Type to narrow the list.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function Highlight({ text, needle }) {
  const at = needle ? text.indexOf(needle) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-lotus-100 px-0.5 text-lotus-800">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}
