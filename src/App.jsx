import { Suspense, lazy, useCallback, useState } from 'react'
import Header from './components/Header'
import QueryBar from './components/QueryBar'
import TermsPanel from './components/TermsPanel'
import StudiesTable from './components/StudiesTable'
import StudyDrawer from './components/StudyDrawer'
import HelpDialog from './components/HelpDialog'
import Welcome from './components/Welcome'
import { useUrlState } from './hooks/useUrlState'
import { useRequest } from './hooks/useRequest'
import { useLocalStorage } from './hooks/useLocalStorage'
import { getJSON, urls } from './lib/api'
import { appendClause, fmt, formatPoint, quoteTerm } from './lib/query'

// NiiVue is by far the largest dependency, so the viewer loads in parallel instead of before the page.
const BrainViewer = lazy(() => import('./components/BrainViewer'))

const TABS = [
  { id: 'studies', label: 'Studies' },
  { id: 'brain', label: 'Brain map' },
  { id: 'terms', label: 'Terms' },
]

export default function App() {
  const [{ q: query, r: radius }, commit] = useUrlState()
  const [draft, setDraft] = useState(query)
  const [shownQuery, setShownQuery] = useState(query)
  if (shownQuery !== query) {
    // the committed query changed (search, back/forward, a shared link): show it in the box
    setShownQuery(query)
    setDraft(query)
  }
  const [recent, setRecent] = useLocalStorage('lotus-bf:recent', [])
  const [selectedTerm, setSelectedTerm] = useState(null)
  const [studyId, setStudyId] = useState(null)
  const [focus, setFocus] = useState(null)
  const [tab, setTab] = useState('studies')
  const [helpOpen, setHelpOpen] = useState(false)

  // The query only runs when it is committed (Enter, Search, a click), never on every keystroke.
  const studies = useRequest(query ? urls.studies(query, radius) : null, getJSON)

  const run = useCallback(
    (text) => {
      const q = text.trim()
      commit({ q })
      if (q) setRecent((list) => [q, ...list.filter((x) => x !== q)].slice(0, 8))
    },
    [commit, setRecent],
  )

  const addClause = (clause, op = 'AND') => {
    const next = appendClause(draft, clause, op)
    setDraft(next)
    run(next)
  }
  const addTerm = (term, op = 'AND') => {
    setSelectedTerm(term)
    addClause(quoteTerm(term), op)
  }
  const addLocation = (mm, op = 'AND') => addClause(formatPoint(mm), op)
  const showPeak = (mm) => {
    setFocus({ mm, at: Date.now() })
    setTab('brain')
  }
  const runExample = (q) => {
    setDraft(q)
    run(q)
    setTab('studies')
  }
  const clear = () => {
    setDraft('')
    run('')
    setSelectedTerm(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header onHelp={() => setHelpOpen(true)} onHome={clear} />

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5">
        <QueryBar
          draft={draft}
          onDraft={setDraft}
          onRun={() => run(draft)}
          onClear={clear}
          query={query}
          radius={radius}
          onRadius={(r) => commit({ r })}
          result={studies}
          recent={recent}
          onPickRecent={runExample}
          onHelp={() => setHelpOpen(true)}
        />

        <nav aria-label="Panels" className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1 text-sm lg:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-lg py-1.5 font-medium ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {t.label}
              {t.id === 'studies' && query && studies.data ? ` (${fmt(studies.data.count)})` : ''}
            </button>
          ))}
        </nav>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,0.8fr)] xl:grid-cols-[270px_minmax(0,1fr)_minmax(420px,0.85fr)]">
          <aside className={`${tab === 'terms' ? '' : 'max-lg:hidden'} lg:sticky lg:top-4`}>
            <TermsPanel onAdd={addTerm} selected={selectedTerm} onSelect={setSelectedTerm} />
          </aside>

          <section className={tab === 'studies' ? '' : 'max-lg:hidden'}>
            {query ? (
              <StudiesTable result={studies} query={query} radius={radius} onOpen={setStudyId} />
            ) : (
              <Welcome onExample={runExample} />
            )}
          </section>

          <section className={`${tab === 'brain' ? '' : 'max-lg:hidden'} lg:sticky lg:top-4`}>
            <Suspense fallback={<div className="aspect-[4/5] animate-pulse rounded-2xl border border-slate-200 bg-white" />}>
              <BrainViewer query={query} radius={radius} focus={focus} onAddLocation={addLocation} />
            </Suspense>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-4 text-center text-xs leading-relaxed text-slate-500">
        Data: Neurosynth (14,371 studies, 507,891 peaks, 3,228 abstract terms) via Tren Huang&apos;s ns-nano. Built with React,
        Tailwind CSS, NiiVue and Flask for Psychoinformatics &amp; Neuroinformatics, National Taiwan University.{' '}
        <a href="/help" className="underline hover:text-lotus-700">
          API documentation
        </a>
      </footer>

      <StudyDrawer studyId={studyId} onClose={() => setStudyId(null)} onAddTerm={addTerm} onShowPeak={showPeak} onAddLocation={addLocation} />
      <HelpDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onExample={(q) => {
          setHelpOpen(false)
          runExample(q)
        }}
      />
    </div>
  )
}
