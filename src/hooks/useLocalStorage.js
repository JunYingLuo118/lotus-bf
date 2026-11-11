import { useEffect, useState } from 'react'

// State that survives a reload (used for the list of recent searches).
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? initialValue : JSON.parse(raw)
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // private mode or storage full: the list just won't be remembered
    }
  }, [key, value])

  return [value, setValue]
}
