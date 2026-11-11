// All calls go to the same origin unless VITE_API_BASE points somewhere else.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
export const TEMPLATE_URL = `${import.meta.env.BASE_URL}static/mni_2mm.nii.gz`

const enc = encodeURIComponent

// One function per endpoint; each React component uses one of them.
export const urls = {
  terms: () => `${API_BASE}/terms`,
  related: (term, limit = 24) => `${API_BASE}/terms/${enc(term)}?limit=${limit}`,
  studies: (q, r) => `${API_BASE}/query/${enc(q)}/studies?r=${r}`,
  locations: (q, r) => `${API_BASE}/query/${enc(q)}/locations?r=${r}`,
  map: (q, r, fwhm) => `${API_BASE}/query/${enc(q)}/nii?r=${r}&fwhm=${fwhm}&kernel=gauss&voxel=2`,
  study: (id) => `${API_BASE}/studies/${enc(id)}`,
  pubmed: (id) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function fail(res) {
  const body = await res.json().catch(() => null)
  throw new ApiError(body?.error || `The server answered ${res.status}`, res.status, body)
}

export async function getJSON(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) await fail(res)
  return res.json()
}

// The map comes back as a .nii.gz file; the headers say how many studies and peaks went into it.
export async function getMap(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) await fail(res)
  const buffer = await res.arrayBuffer()
  const num = (name) => Number(res.headers.get(name) ?? Number.NaN)
  const top = (res.headers.get('X-Lotus-Top') || '').split(',').map(Number)
  return {
    buffer,
    studies: num('X-Lotus-Studies'),
    peaks: num('X-Lotus-Peaks'),
    max: num('X-Lotus-Max'),
    top: top.length === 3 && top.every(Number.isFinite) ? top : null, // MNI mm of the map's highest voxel
  }
}
