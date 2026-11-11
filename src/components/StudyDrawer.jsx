import { useEffect, useRef } from 'react'
import { CrosshairIcon, ExternalIcon, PlusIcon, XIcon } from './Icons'
import { useRequest } from '../hooks/useRequest'
import { getJSON, urls } from '../lib/api'
import { formatPoint } from '../lib/query'

// GET /studies/<id>: one study's details, its strongest terms and every peak it reported.
export default function StudyDrawer({ studyId, onClose, onAddTerm, onShowPeak, onAddLocation }) {
  const ref = useRef(null)
  const { data, error, loading } = useRequest(studyId ? urls.study(studyId) : null, getJSON)
  const study = data?.study_id === studyId ? data : null

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (studyId && !dialog.open) dialog.showModal()
    if (!studyId && dialog.open) dialog.close()
  }, [studyId])

  const close = () => ref.current?.close()
  const act = (fn) => (...args) => {
    fn(...args)
    close()
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) close() // a click on the dimmed backdrop
      }}
      aria-labelledby="study-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl overflow-y-auto bg-white p-0 text-slate-800 shadow-2xl"
    >
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">PubMed {studyId}</div>
          <h2 id="study-title" className="mt-1 text-base leading-snug font-semibold text-slate-900">
            {study?.title ?? (loading ? 'Loading…' : '')}
          </h2>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="space-y-6 px-5 py-4">
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error.message}</p>}
        {!study && loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        )}

        {study && (
          <>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Authors</dt>
              <dd>{study.authors}</dd>
              <dt className="text-slate-500">Journal</dt>
              <dd>{study.journal}</dd>
              <dt className="text-slate-500">Year</dt>
              <dd>{study.year}</dd>
            </dl>
            <a
              href={urls.pubmed(study.study_id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-lotus-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lotus-700"
            >
              Read the abstract on PubMed <ExternalIcon className="size-4" />
            </a>

            <section>
              <h3 className="text-sm font-semibold text-slate-900">Its strongest terms</h3>
              <p className="text-xs text-slate-500">Weighted by how much the abstract uses them. Click one to add it to the query.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {study.terms.map((t) => (
                  <button
                    key={t.term}
                    type="button"
                    onClick={act(() => onAddTerm(t.term))}
                    className="rounded-full border border-lotus-200 bg-lotus-50 px-2.5 py-0.5 text-xs text-lotus-800 hover:border-lotus-400 hover:bg-lotus-100"
                  >
                    {t.term} <span className="text-[10px] text-lotus-400 tabular-nums">{t.weight.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-900">
                {study.peaks.length} reported {study.peaks.length === 1 ? 'peak' : 'peaks'} (MNI mm)
              </h3>
              <p className="text-xs text-slate-500">
                Show one on the brain, or use it as a location in your query.
                {study.suspect?.some(Boolean) &&
                  ' Greyed rows look like table numbers or statistics rather than coordinates, so searches and maps leave them out.'}
              </p>
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {study.peaks.map((p, i) =>
                  study.suspect?.[i] ? (
                    <li key={i} className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 text-sm text-slate-400">
                      <span className="w-6 text-xs tabular-nums">{i + 1}</span>
                      <code className="flex-1 font-mono line-through">[{p.join(', ')}]</code>
                      <span className="text-xs">not a coordinate?</span>
                    </li>
                  ) : (
                    <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="w-6 text-xs text-slate-400 tabular-nums">{i + 1}</span>
                      <code className="flex-1 font-mono text-slate-800">{formatPoint(p)}</code>
                      <button
                        type="button"
                        onClick={act(() => onShowPeak(p))}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-teal-700 hover:bg-teal-50"
                      >
                        <CrosshairIcon className="size-3.5" /> Show
                      </button>
                      <button
                        type="button"
                        onClick={act(() => onAddLocation(p))}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        <PlusIcon className="size-3.5" /> Query
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          </>
        )}
      </div>
    </dialog>
  )
}
