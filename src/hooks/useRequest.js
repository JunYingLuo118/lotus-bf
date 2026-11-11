import { useEffect, useState } from 'react'

// Remember the last few answers so going back to a query (or toggling a setting back) is instant.
const cache = new Map()
const MAX_CACHED = 40

function remember(key, value) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value)
}

const IDLE = { data: null, error: null, loading: false, url: null }

/**
 * Fetch `url` with `loader(url, signal)` whenever the url changes.
 * - an older request is aborted when a newer one starts, so a slow answer can never overwrite a newer one
 * - while a new request runs, the previous data stays visible (loading = true) instead of a blank panel
 * - url = null means "nothing to load"
 */
export function useRequest(url, loader) {
  const [state, setState] = useState(() =>
    url && cache.has(url) ? { data: cache.get(url), error: null, loading: false, url } : { ...IDLE, loading: !!url, url },
  )

  useEffect(() => {
    if (!url) {
      setState(IDLE)
      return undefined
    }
    if (cache.has(url)) {
      setState({ data: cache.get(url), error: null, loading: false, url })
      return undefined
    }
    const controller = new AbortController()
    setState((prev) => ({ ...prev, error: null, loading: true }))
    loader(url, controller.signal).then(
      (data) => {
        remember(url, data)
        setState({ data, error: null, loading: false, url })
      },
      (error) => {
        if (error?.name !== 'AbortError') setState({ data: null, error, loading: false, url })
      },
    )
    return () => controller.abort()
  }, [url, loader])

  return state
}
