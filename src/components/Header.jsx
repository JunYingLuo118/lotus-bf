import Logo from './Logo'
import { HelpIcon } from './Icons'
import { API_BASE } from '../lib/api'

export default function Header({ onHelp, onHome }) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-3 sm:px-5">
        <button type="button" onClick={onHome} className="flex items-center gap-3 text-left" title="Start over">
          <Logo className="size-10 shrink-0 sm:size-11" />
          <div>
            <div className="text-xl leading-tight font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              LoTUS<span className="text-lotus-600">-BF</span>
            </div>
            <div className="text-xs text-slate-500 sm:text-sm">
              <span className="font-semibold text-lotus-700">Lo</span>cation-or-<span className="font-semibold text-lotus-700">T</span>erm{' '}
              <span className="font-semibold text-lotus-700">U</span>nified <span className="font-semibold text-lotus-700">S</span>earch
              for <span className="font-semibold text-lotus-700">B</span>rain <span className="font-semibold text-lotus-700">F</span>unctions
            </div>
          </div>
        </button>
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onHelp}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-lotus-50 hover:text-lotus-700"
          >
            <HelpIcon className="size-4" />
            <span className="hidden sm:inline">How to search</span>
          </button>
          <a
            href={`${API_BASE}/help`}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 sm:inline"
          >
            API
          </a>
        </nav>
      </div>
    </header>
  )
}
