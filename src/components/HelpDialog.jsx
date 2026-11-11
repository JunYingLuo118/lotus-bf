import { useEffect, useRef } from 'react'
import { XIcon } from './Icons'
import { EXAMPLES } from '../lib/query'

const SYNTAX = [
  ['amygdala', 'Studies whose abstract uses the term (Neurosynth: tf-idf above 0).'],
  ['default mode', 'Neighbouring words become one term when the vocabulary has that phrase.'],
  ['"theory of mind"', 'Quotes keep a phrase together; small words such as "of" are skipped.'],
  ['emotion*', 'Every term that starts with "emotion": emotion, emotional, emotions…'],
  ['[-22,0,-20]', 'Studies with a peak within r mm of this MNI coordinate (set r next to Search).'],
  ['A B   or   A AND B', 'Both.'],
  ['A OR B', 'Either one.'],
  ['A NOT B', 'A, but not B.'],
  ['( … )', 'Grouping. Without brackets NOT is applied first, then AND, then OR.'],
  ['anything else', 'Words outside the vocabulary are looked up in titles, with a yellow note.'],
]

export default function HelpDialog({ open, onClose, onExample }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close()
      }}
      aria-labelledby="help-title"
      className="m-auto max-h-[90dvh] w-[min(46rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-white p-0 text-slate-800 shadow-2xl"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
        <h2 id="help-title" className="text-lg font-semibold text-slate-900">
          How to search
        </h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="space-y-5 px-5 py-4 text-sm leading-relaxed">
        <table className="w-full">
          <tbody>
            {SYNTAX.map(([code, what]) => (
              <tr key={code} className="border-b border-slate-100 align-top last:border-0">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">{code}</code>
                </td>
                <td className="py-1.5 text-slate-600">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section>
          <h3 className="font-semibold text-slate-900">Examples</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.q}
                type="button"
                onClick={() => onExample(ex.q)}
                title={ex.note}
                className="rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs text-slate-700 hover:border-lotus-300 hover:bg-lotus-50 hover:text-lotus-800"
              >
                {ex.q}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-semibold text-slate-900">What the brain map shows</h3>
          <p className="text-slate-600">
            Every peak reported by the matching studies is placed on the MNI152 2&nbsp;mm grid and smoothed (Gaussian, FWHM
            10&nbsp;mm by default). Brighter means more reported peaks nearby. It is a density of reported peaks, not a statistical
            test, and studies that report many peaks weigh more. Click a slice to move the crosshair, scroll to change the slice, and
            drag the 3D view to turn it; the crosshair can then be added to your query as a location.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-slate-900">Data</h3>
          <p className="text-slate-600">
            The Neurosynth database: 14,371 studies, 507,891 reported peaks and 3,228 terms taken from their abstracts, as packaged by
            Tren Huang for this course (spiketren/ns-nano). Terms come from abstracts only, so a study can be about a topic without its
            abstract using the word. The peaks were read from article tables automatically, and 1,182 of them (0.2%) are clearly not
            coordinates: three consecutive whole numbers such as 1,&nbsp;2,&nbsp;3 (row or column numbers), or three values all within
            1&nbsp;mm of zero (p-values). They still appear, greyed out, in a study&apos;s details, but searches and maps leave them out;
            otherwise they pile up at [0,0,0] and become the brightest spot of large maps.
          </p>
        </section>
      </div>
    </dialog>
  )
}
