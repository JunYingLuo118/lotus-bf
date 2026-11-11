import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_RADIUS, RADII } from '../lib/query'

function readUrl() {
  const params = new URLSearchParams(window.location.search)
  const r = Number(params.get('r'))
  return { q: (params.get('q') ?? '').trim(), r: RADII.includes(r) ? r : DEFAULT_RADIUS }
}

/**
 * The committed query and radius live in the address bar (?q=...&r=...), so every result can be
 * shared as a link and the browser's back/forward buttons step through earlier searches.
 */
export function useUrlState() {
  const [state, setState] = useState(readUrl)

  useEffect(() => {
    const onPop = () => setState(readUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const commit = useCallback((patch) => {
    const next = { ...readUrl(), ...patch }
    const params = new URLSearchParams(window.location.search)
    if (next.q) params.set('q', next.q)
    else params.delete('q')
    if (next.r !== DEFAULT_RADIUS) params.set('r', String(next.r))
    else params.delete('r')
    const search = params.toString()
    const { pathname, hash } = window.location
    const url = `${pathname}${search ? `?${search}` : ''}${hash}`
    if (url !== `${pathname}${window.location.search}${hash}`) window.history.pushState(null, '', url)
    setState(next)
  }, [])

  return [state, commit]
}
