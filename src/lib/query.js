// Small helpers for building query strings and exporting results.

export const RADII = [2, 4, 6, 8, 10, 12, 15, 20]
export const DEFAULT_RADIUS = 6

export const EXAMPLES = [
  { q: 'amygdala', note: 'a term' },
  { q: '[-22,0,-20]', note: 'a location: left amygdala' },
  { q: '"default mode" NOT [0,-52,26]', note: 'a term minus a location' },
  { q: 'reward AND [10,12,-8]', note: 'a term near ventral striatum' },
  { q: '(pain OR nociceptive) AND [0,6,40]', note: 'grouping with brackets' },
  { q: 'emotion* NOT faces', note: 'every term starting with emotion' },
  { q: '"theory of mind"', note: 'a phrase' },
]

const OPERATOR = /^(AND|OR|NOT)$/i

// Multi-word terms need quotes, otherwise "default mode" could be read as two words.
export function quoteTerm(term) {
  return /\s/.test(term) || OPERATOR.test(term) ? `"${term}"` : term
}

export function formatPoint(mm) {
  return `[${mm.map((v) => Math.round(v)).join(',')}]`
}

export function hasTopLevelOr(query) {
  let depth = 0
  for (const [token] of query.matchAll(/\[[^\]]*\]|"[^"]*"|\(|\)|\bOR\b/gi)) {
    if (token === '(') depth += 1
    else if (token === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && token.toUpperCase() === 'OR') return true
  }
  return false
}

// Add a clause to the end of a query: "a" + fear -> "a AND fear"; "a OR b" + fear -> "(a OR b) AND fear"
export function appendClause(query, clause, op = 'AND') {
  const base = query.trim()
  if (!base) return op === 'NOT' ? `NOT ${clause}` : clause
  if (/(\b(AND|OR|NOT)|\()\s*$/i.test(base)) return `${base} ${clause}`
  const left = op !== 'OR' && hasTopLevelOr(base) ? `(${base})` : base
  return `${left} ${op} ${clause}`
}

export function slugify(text) {
  return (text || 'query').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'query'
}

export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n')
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function firstAuthors(authors, n = 3) {
  const list = (authors || '').split(',').map((s) => s.trim()).filter(Boolean)
  return list.length > n ? `${list.slice(0, n).join(', ')} et al.` : list.join(', ')
}

export const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '–')
