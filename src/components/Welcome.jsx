import { EXAMPLES } from '../lib/query'

const STEPS = [
  ['Type', 'a term such as amygdala, a location such as [-22,0,-20], or both joined with AND, OR, NOT.'],
  ['Click', 'any term on the left to add it, or a study to see its terms and peaks.'],
  ['Point', 'at the brain to read a coordinate, then add it to your query as a location.'],
]

// Shown instead of the studies table before the first search.
export default function Welcome({ onExample }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Search the brain literature by what, where, or both</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
        LoTUS-BF looks through 14,371 neuroimaging studies from Neurosynth. Ask for a <b className="text-lotus-700">term</b> their
        abstracts use, a <b className="text-teal-700">location</b> where they report activation, or mix the two in one query. The map
        shows where the matching studies report their peaks.
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
              <span className="grid size-6 place-items-center rounded-full bg-lotus-600 text-xs text-white">{i + 1}</span>
              {title}
            </div>
            {text}
          </li>
        ))}
      </ol>
      <h3 className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">Try one</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.q}
            type="button"
            onClick={() => onExample(ex.q)}
            className="group rounded-xl border border-slate-200 px-3 py-2 text-left transition hover:border-lotus-300 hover:bg-lotus-50"
          >
            <code className="font-mono text-sm text-slate-800 group-hover:text-lotus-800">{ex.q}</code>
            <div className="text-xs text-slate-500">{ex.note}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
