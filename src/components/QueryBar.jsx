import { useRef, useState } from 'react'
import { ClockIcon, LinkIcon, SearchIcon, WarnIcon, XIcon } from './Icons'
import { RADII, fmt } from '../lib/query'

const OPERATORS = ['AND', 'OR', 'NOT', '(', ')']

export default function QueryBar({
  draft, onDraft, onRun, onClear, query, radius, onRadius, result, recent, onPickRecent, onHelp,
}) {
  const inputRef = useRef(null)
  const recentRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const edited = draft.trim() !== query

  // Put an operator where the cursor is (not always at the end), with a space on each side.
  const insert = (token) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const before = draft.slice(0, start).replace(/\s+$/, '')
    const after = draft.slice(end).replace(/^\s+/, '')
    const left = before ? `${before} ` : ''
    onDraft(`${left}${token} ${after}`)
    const caret = left.length + token.length + 1
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the address bar still has the link
    }
  }

  const pickRecent = (q) => {
    if (recentRef.current) recentRef.current.open = false
    onPickRecent(q)
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-label="Query">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onRun()
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="relative flex-1">
          <span className="sr-only">Query</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder='amygdala, [-22,0,-20], or "default mode" NOT [0,-52,26]'
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            enterKeyHint="search"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-10 pl-10 font-mono text-[15px] text-slate-900 shadow-inner shadow-slate-100 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-lotus-400 focus:ring-4 focus:ring-lotus-100"
          />
          {draft && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear the query"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </label>
        <div className="flex gap-2">
          <label className="flex items-center">
            <span className="sr-only">Radius around each location</span>
            <select
              value={radius}
              onChange={(e) => onRadius(Number(e.target.value))}
              title="How close a peak has to be to an [x,y,z] in your query"
              className="h-full rounded-xl border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-lotus-400 focus:ring-4 focus:ring-lotus-100"
            >
              {RADII.map((v) => (
                <option key={v} value={v}>
                  r = {v} mm
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex-1 rounded-xl bg-lotus-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-lotus-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {OPERATORS.map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => insert(op)}
            title={op === '(' || op === ')' ? 'Group part of the query' : `Insert ${op} at the cursor`}
            className="min-w-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600 hover:border-lotus-300 hover:bg-lotus-50 hover:text-lotus-700"
          >
            {op}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
        <button type="button" onClick={onHelp} className="px-1 text-xs text-slate-500 hover:text-lotus-700 hover:underline">
          Syntax &amp; examples
        </button>
        {recent.length > 0 && (
          <details ref={recentRef} className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-xs text-slate-500 hover:text-lotus-700">
              <ClockIcon className="size-3.5" /> Recent
            </summary>
            <ul className="absolute left-0 z-20 mt-1 w-72 max-w-[80vw] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {recent.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => pickRecent(q)}
                    className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs text-slate-700 hover:bg-lotus-50"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="ml-auto flex items-center gap-2">
          {edited && draft.trim() && (
            <span className="text-xs text-amber-700">Edited: press Enter to search</span>
          )}
          {query && (
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <LinkIcon className="size-3.5" />
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          )}
        </div>
      </div>

      <Interpretation query={query} result={result} />
    </section>
  )
}

// "Read as …" line: the server's reading of the query, a chip per term/location with its own count.
function Interpretation({ query, result }) {
  if (!query) return null
  const { data, error, loading } = result
  if (error) {
    const pos = error.body?.position
    return (
      <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
        <div className="flex items-start gap-2">
          <WarnIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error.message}</span>
        </div>
        {Number.isInteger(pos) && (
          <pre className="mt-1 overflow-x-auto font-mono text-xs leading-snug text-rose-700">
            {query}
            {'\n'}
            {' '.repeat(Math.min(pos, query.length))}^
          </pre>
        )}
      </div>
    )
  }
  if (!data) return loading ? <div className="mt-3 h-6 w-72 animate-pulse rounded-lg bg-slate-100" /> : null
  return (
    <div className={`mt-3 space-y-2 transition-opacity ${loading ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-slate-500">Read as</span>
        <code className="rounded-lg bg-slate-50 px-2 py-0.5 font-mono text-[13px] ring-1 ring-slate-200">
          <Colored text={data.parsed} />
        </code>
        <span className="text-slate-400" aria-hidden="true">
          =
        </span>
        <span className="font-semibold text-slate-900">
          {fmt(data.count)} {data.count === 1 ? 'study' : 'studies'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.atoms.map((atom) => (
          <AtomChip key={atom.text} atom={atom} />
        ))}
      </div>
      {data.warnings?.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-800">
          {data.warnings.map((w) => (
            <li key={w} className="flex items-center gap-1.5">
              <WarnIcon className="size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Colored({ text }) {
  const parts = text.match(/\[[^\]]*\]|title:"[^"]*"|"[^"]*"|\bAND\b|\bOR\b|\bNOT\b|[()]|[^\s()]+|\s+/g) || []
  return parts.map((part, i) => {
    if (/^\s+$/.test(part)) return part
    let cls = 'text-lotus-700'
    if (/^(AND|OR|NOT)$/.test(part)) cls = 'font-semibold text-slate-500'
    else if (part === '(' || part === ')') cls = 'text-slate-400'
    else if (part.startsWith('[')) cls = 'text-teal-700'
    else if (part.startsWith('title:')) cls = 'text-amber-700'
    return (
      <span key={i} className={cls}>
        {part}
      </span>
    )
  })
}

const CHIP = {
  term: 'border-lotus-200 bg-lotus-50 text-lotus-800',
  prefix: 'border-lotus-200 bg-lotus-50 text-lotus-800',
  title: 'border-amber-200 bg-amber-50 text-amber-800',
  location: 'border-teal-200 bg-teal-50 text-teal-800',
}

function AtomChip({ atom }) {
  let label = atom.text
  let hint = 'Studies whose abstract uses this term'
  if (atom.kind === 'location') {
    label = `${atom.text} ±${atom.r} mm`
    hint = `Studies with a peak within ${atom.r} mm of ${atom.text}`
  } else if (atom.kind === 'prefix') {
    label = `${atom.text} · ${atom.n_terms} terms`
    hint = `Matches ${atom.expands_to.join(', ')}`
  } else if (atom.kind === 'title') {
    label = `${atom.text.replace(/^title:/, '')} in titles`
    hint = 'Not a LoTUS term, so study titles were searched instead'
  }
  return (
    <span title={hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${CHIP[atom.kind]}`}>
      <span className="font-medium">{label}</span>
      <span className="rounded-full bg-white/80 px-1.5 font-semibold tabular-nums">{fmt(atom.n)}</span>
    </span>
  )
}
