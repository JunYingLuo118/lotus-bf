import { useEffect, useRef, useState } from 'react'
import { NVImage, Niivue } from '@niivue/niivue'
import { CrosshairIcon, DownloadIcon, PlusIcon } from './Icons'
import { useRequest } from '../hooks/useRequest'
import { TEMPLATE_URL, getMap, urls } from '../lib/api'
import { fmt } from '../lib/query'

const FWHMS = [0, 6, 8, 10, 12, 15]
const MULTIPLANAR_GRID = 2 // NiiVue MULTIPLANAR_TYPE.GRID: axial, coronal, sagittal + 3D in a 2x2 grid
const SHOW_RENDER_ALWAYS = 1 // NiiVue SHOW_RENDER.ALWAYS

const formatMM = (mm) => `[${mm.map((v) => (Number.isInteger(v) ? v : v.toFixed(1))).join(', ')}]`

function readCursor(location) {
  const mm = Array.from(location?.mm ?? []).slice(0, 3)
  if (mm.length < 3) return null
  const overlay = location.values?.[1]
  return { mm: mm.map((v) => Math.round(v * 10) / 10), value: overlay ? Number(overlay.value) : null }
}

function moveCrosshair(nv, mm) {
  nv.scene.crosshairPos = nv.mm2frac(mm)
  nv.updateGLVolume()
  nv.createOnLocationChange()
}

// GET /query/<q>/nii drawn over the MNI152 template with NiiVue (WebGL2).
export default function BrainViewer({ query, radius, focus, onAddLocation }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [viewerError, setViewerError] = useState(null)
  const [fwhm, setFwhm] = useState(10)
  const [threshold, setThreshold] = useState(30)
  const [opacity, setOpacity] = useState(0.85)
  const [cursor, setCursor] = useState(null)
  const [overlayVersion, setOverlayVersion] = useState(0)
  const [gotoText, setGotoText] = useState('')
  const [gotoError, setGotoError] = useState('')

  const map = useRequest(query ? urls.map(query, radius, fwhm) : null, getMap)
  const mapData = query ? map.data : null

  // 1. create NiiVue once and load the template (the ref guard also covers React's StrictMode re-run)
  useEffect(() => {
    if (nvRef.current) return
    const nv = new Niivue({
      backColor: [0.05, 0.06, 0.08, 1],
      crosshairColor: [0.2, 0.85, 0.6, 1],
      crosshairWidth: 1,
      show3Dcrosshair: true,
      isColorbar: true,
      colorbarHeight: 0.035,
      textHeight: 0.035,
      multiplanarLayout: MULTIPLANAR_GRID,
      multiplanarShowRender: SHOW_RENDER_ALWAYS,
      isRadiologicalConvention: false,
      dragAndDropEnabled: false,
      logLevel: 'error',
      loadingText: '',
    })
    nvRef.current = nv
    ;(async () => {
      try {
        await nv.attachToCanvas(canvasRef.current)
        nv.setSliceType(nv.sliceTypeMultiplanar)
        await nv.loadVolumes([{ url: TEMPLATE_URL, colormap: 'gray', colorbarVisible: false }])
        nv.onLocationChange = (location) => setCursor(readCursor(location))
        nv.createOnLocationChange()
        setReady(true)
      } catch (err) {
        setViewerError(err)
      }
    })()
  }, [])

  // 2. keep the drawing buffer the size of its box (phone tabs, window resizes)
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (nvRef.current?.gl) nvRef.current.resizeListener()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // 3. put the newest map on top of the template, or take the old one away
  useEffect(() => {
    const nv = nvRef.current
    if (!ready || !nv) return undefined
    const previous = nv.volumes.slice(1)
    if (!mapData || !(mapData.max > 0)) {
      previous.forEach((v) => nv.removeVolume(v))
      nv.updateGLVolume()
      return undefined
    }
    let cancelled = false
    NVImage.loadFromUrl({
      url: mapData.buffer.slice(0), // a copy: the cached buffer must stay usable
      name: 'lotus_map.nii.gz',
      colormap: 'warm',
      opacity: 0,
      cal_min: mapData.max * 0.2,
      cal_max: mapData.max,
    })
      .then((image) => {
        if (cancelled) return
        previous.forEach((v) => nv.removeVolume(v))
        nv.addVolume(image)
        if (mapData.top) moveCrosshair(nv, mapData.top) // open each new map at its strongest spot
        setOverlayVersion((n) => n + 1)
      })
      .catch((err) => {
        if (!cancelled) setViewerError(err)
      })
    return () => {
      cancelled = true
    }
  }, [ready, mapData])

  // 4. threshold (% of the map's maximum) and opacity
  useEffect(() => {
    const nv = nvRef.current
    const overlay = nv?.volumes?.[1]
    if (!overlay || !(mapData?.max > 0)) return
    overlay.cal_max = mapData.max
    overlay.cal_min = Math.max((mapData.max * threshold) / 100, mapData.max * 0.002)
    overlay.opacity = opacity
    nv.updateGLVolume()
    nv.createOnLocationChange()
  }, [overlayVersion, threshold, opacity, mapData])

  // 5. jump to a coordinate chosen elsewhere (a peak in the study panel)
  useEffect(() => {
    if (ready && focus) moveCrosshair(nvRef.current, focus.mm)
  }, [ready, focus])

  const goTo = (e) => {
    e.preventDefault()
    const nums = gotoText.match(/-?\d+(\.\d+)?/g)?.map(Number)
    if (!nums || nums.length !== 3) {
      setGotoError('Type three numbers: x, y, z in MNI mm')
      return
    }
    setGotoError('')
    if (nvRef.current && ready) moveCrosshair(nvRef.current, nums)
  }

  const pct = cursor?.value != null && mapData?.max > 0 ? (cursor.value / mapData.max) * 100 : null
  const busy = !viewerError && (!ready || map.loading)
  // a bad query (400) is already explained under the query box; only other failures are shown here
  const mapError = map.error && map.error.status !== 400 ? map.error : null

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
        <h2 className="font-semibold text-slate-900">Brain map</h2>
        <span className="text-xs text-slate-500">
          {mapData ? `${fmt(mapData.studies)} studies · ${fmt(mapData.peaks)} peaks` : 'MNI152, 2 mm'}
        </span>
      </div>

      <div ref={boxRef} className="relative m-3 aspect-square overflow-hidden rounded-xl bg-[#0d0f14]">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />
        {busy && (
          <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
            {ready ? 'Drawing map…' : 'Loading viewer…'}
          </span>
        )}
        {ready && !query && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 px-4 text-center text-xs text-slate-400">
            Run a query to see where its studies report peaks.
          </p>
        )}
        {ready && mapData && !(mapData.max > 0) && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 px-4 text-center text-xs text-amber-300">
            No peaks to draw for this query.
          </p>
        )}
        {(viewerError || mapError) && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-sm text-slate-200">
            {viewerError
              ? `The brain viewer could not start (${viewerError.message}). It needs a browser with WebGL 2.`
              : `The map could not be made: ${mapError.message}`}
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <CrosshairIcon className="size-4 text-teal-600" />
          <span className="font-mono text-slate-800">{cursor ? formatMM(cursor.mm) : '–'}</span>
          {pct != null && (
            <span className="text-xs text-slate-500">
              density {cursor.value.toFixed(2)} · {pct.toFixed(0)}% of max
            </span>
          )}
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              disabled={!cursor}
              onClick={() => onAddLocation(cursor.mm)}
              title="Add the crosshair position to the query"
              className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
            >
              <PlusIcon className="size-3.5" /> Add to query
            </button>
            <button
              type="button"
              disabled={!cursor}
              onClick={() => onAddLocation(cursor.mm, 'NOT')}
              title="Exclude studies with a peak near the crosshair"
              className="rounded-lg border border-slate-300 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-40"
            >
              NOT
            </button>
          </span>
        </div>

        <form onSubmit={goTo} className="flex gap-2">
          <input
            value={gotoText}
            onChange={(e) => setGotoText(e.target.value)}
            placeholder="Go to x, y, z (e.g. -22, 0, -20)"
            aria-label="Go to an MNI coordinate"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
          <button type="submit" className="rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700">
            Go
          </button>
          <button
            type="button"
            disabled={!ready || !mapData?.top}
            onClick={() => moveCrosshair(nvRef.current, mapData.top)}
            title={mapData?.top ? `The map is highest at [${mapData.top.join(', ')}]` : 'Run a query first'}
            className="rounded-lg border border-slate-300 px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 hover:border-lotus-300 hover:text-lotus-700 disabled:opacity-40"
          >
            Go to peak
          </button>
        </form>
        {gotoError && <p className="-mt-2 text-xs text-rose-700">{gotoError}</p>}

        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">
            Show voxels above <b className="text-slate-800">{threshold}%</b> of the maximum
            <input type="range" min={0} max={90} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <label className="block text-xs text-slate-600">
            Overlay opacity <b className="text-slate-800">{Math.round(opacity * 100)}%</b>
            <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Smoothing
            <select value={fwhm} onChange={(e) => setFwhm(Number(e.target.value))} className="rounded border border-slate-300 bg-white px-1.5 py-1">
              {FWHMS.map((v) => (
                <option key={v} value={v}>
                  {v ? `FWHM ${v} mm` : 'none'}
                </option>
              ))}
            </select>
          </label>
          {query && (
            <a
              href={urls.map(query, radius, fwhm)}
              download
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-lotus-300 hover:text-lotus-700"
            >
              <DownloadIcon className="size-3.5" /> Download map (.nii.gz)
            </a>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Colour is the smoothed density of the peaks these studies report, not a statistical test. Click a slice to move the
          crosshair, scroll to change slices, drag the 3D view to turn it.
        </p>
      </div>
    </div>
  )
}
