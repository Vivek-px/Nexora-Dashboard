/**
 * Station reference map: real street map + real topography, fully interactive.
 *
 * All map services are free and keyless:
 *  - Streets:    OpenStreetMap standard tiles (same look as the MVP's Plotly 'open-street-map')
 *  - Topographic: OpenTopoMap (contours + relief shading baked into the tiles)
 *  - Satellite:  Esri World Imagery
 *  - Elevation:  Mapzen/Tilezen Terrain Tiles on AWS Open Data (terrarium-encoded DEM)
 * The elevation tiles drive the hillshade, the live contour lines, the 3D terrain and the click-for-elevation readout.
 * Markers, the on/off switch and the controls are part of the inline style, so they keep working offline.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mlcontour from 'maplibre-contour'
import { AREAS, type AreaId, type Selection } from './eiq'

// MapLibre's worker is self-contained. Serve it untouched from /public (copied on postinstall):
// Vite's dev transform would inject its browser client into the worker and crash it.
maplibregl.setWorkerUrl(new URL(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`, window.location.href).href)

const CENTER: [number, number] = [85.824, 20.285]
const ZOOM = 11.5
const PIN = { on: '#d97706', off: '#0d9488' } // MVP colours: teal areas, amber selection
const TERRAIN_EXAGGERATION = 2 // Bhubaneswar is gently rolling; 2x makes Khandagiri–Udayagiri relief readable in 3D

type Basemap = 'streets' | 'topo' | 'satellite'
const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'topo', label: 'Topographic' },
  { id: 'satellite', label: 'Satellite' },
]

// One shared DEM source: hillshade, contours, 3D terrain and the elevation readout all reuse its cached tiles.
const dem = new mlcontour.DemSource({
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  maxzoom: 14,
  worker: false,
  timeoutMs: 20000,
})
dem.setupMaplibre(maplibregl as unknown as Parameters<typeof dem.setupMaplibre>[0])

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    streets: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' },
    topo: { type: 'raster', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), tileSize: 256, maxzoom: 17, attribution: 'Map style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA), SRTM' },
    satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    dem: { type: 'raster-dem', tiles: [dem.sharedDemProtocolUrl], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen, AWS Open Data)' },
    // 3D terrain gets its own source (same cached tiles) so hillshade and terrain render cleanly together.
    'dem-terrain': { type: 'raster-dem', tiles: [dem.sharedDemProtocolUrl], tileSize: 256, maxzoom: 14, encoding: 'terrarium' },
    contours: {
      type: 'vector',
      tiles: [dem.contourProtocolUrl({ multiplier: 1, thresholds: { 10: [50, 100], 11: [20, 100], 12: [10, 50], 13: [5, 25], 15: [2, 10] }, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })],
      maxzoom: 15,
    },
  },
  layers: [
    { id: 'white-bg', type: 'background', paint: { 'background-color': '#ffffff' } },
    { id: 'streets', type: 'raster', source: 'streets' },
    { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
    { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#3d3226', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#5a4a3a' } },
    { id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', paint: { 'line-color': '#8a5a2b', 'line-opacity': ['match', ['get', 'level'], 1, 0.75, 0.4], 'line-width': ['match', ['get', 'level'], 1, 1.2, 0.6] } },
    { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0],
      layout: { 'symbol-placement': 'line', 'text-size': 10, 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'], 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#6b4423', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.2 } },
  ],
}

/** Elevation in metres at a point, read straight from the DEM tile (no 3D needed). */
async function elevationAt(lng: number, lat: number): Promise<number | null> {
  const z = 14
  const n = 2 ** z
  const xf = ((lng + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const [x, y] = [Math.floor(xf), Math.floor(yf)]
  try {
    const t = await dem.getDemTile(z, x, y)
    const px = Math.min(t.width - 1, Math.floor((xf - x) * t.width))
    const py = Math.min(t.height - 1, Math.floor((yf - y) * t.height))
    const v = t.data[py * t.width + px]
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Native-style control: back to the starting view, north up and flat. */
class ResetControl implements maplibregl.IControl {
  private box?: HTMLDivElement
  onAdd(m: maplibregl.Map) {
    const box = document.createElement('div')
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const b = document.createElement('button')
    b.type = 'button'
    b.title = 'Reset view (north up, flat)'
    b.setAttribute('aria-label', 'Reset map view')
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
    b.onclick = () => m.easeTo({ center: CENTER, zoom: ZOOM, pitch: 0, bearing: 0 })
    box.appendChild(b)
    this.box = box
    return box
  }
  onRemove() {
    this.box?.remove()
  }
}

const fmtCoord = (lng: number, lat: number) => `${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`

/** Station reference map. Positions come from the registry; tiles need internet, markers work offline. */
export function StationMap({ selection, onSelect, height = 380, tiles, hover }: { selection: Selection; onSelect: (a: AreaId) => void; height?: number; tiles: boolean; hover: (a: AreaId) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [, setTick] = useState(0)
  const [open, setOpen] = useState<AreaId | null>(null)
  const [basemap, setBasemap] = useState<Basemap>('streets')
  const [relief, setRelief] = useState(false)
  const [contours, setContours] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const located = AREAS.filter((a) => a.reference.latitude != null && a.reference.longitude != null)

  useEffect(() => {
    if (!ref.current) return
    const m = new maplibregl.Map({
      container: ref.current, style: STYLE, center: CENTER, zoom: ZOOM, minZoom: 9, maxZoom: 18, maxPitch: 75,
      attributionControl: { compact: true }, scrollZoom: true, dragRotate: true, touchPitch: true,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    m.addControl(new maplibregl.TerrainControl({ source: 'dem-terrain', exaggeration: TERRAIN_EXAGGERATION }), 'top-right')
    m.addControl(new maplibregl.FullscreenControl({ container: wrap.current ?? undefined }), 'top-right')
    m.addControl(new ResetControl(), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left')
    const redraw = () => setTick((t) => t + 1)
    m.on('move', redraw)
    m.on('load', redraw)
    m.on('idle', redraw)
    m.on('terrain', redraw)
    m.on('error', (e) => console.warn('[map]', e.error?.message ?? e))
    // Live coordinates under the pointer; click anywhere for coordinates + ground elevation.
    m.on('mousemove', (e) => setCursor(fmtCoord(e.lngLat.lng, e.lngLat.lat)))
    m.on('mouseout', () => setCursor(null))
    m.on('click', async (e) => {
      const { lng, lat } = e.lngLat
      popup.current?.remove()
      const p = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', className: 'elev-popup' })
        .setLngLat(e.lngLat).setHTML(`<b>Ground elevation</b><br>measuring…<br><span>${fmtCoord(lng, lat)}</span>`).addTo(m)
      popup.current = p
      const ele = await elevationAt(lng, lat)
      if (popup.current === p) p.setHTML(`<b>Ground elevation</b><br>${ele == null ? 'unavailable (offline?)' : `${Math.round(ele)} m above sea level`}<br><span>${fmtCoord(lng, lat)}</span>`)
    })
    map.current = m
    redraw()
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Basemap, relief and contour switches; the Street-map checkbox turns every online layer off.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    const apply = () => {
      for (const b of BASEMAPS) vis(b.id, tiles && basemap === b.id)
      vis('hillshade', tiles && relief && basemap !== 'topo')
      vis('contour-lines', tiles && contours)
      vis('contour-labels', tiles && contours)
      if (!tiles && m.getTerrain()) m.setTerrain(null)
    }
    if (m.isStyleLoaded()) apply()
    else m.once('load', apply)
  }, [tiles, basemap, relief, contours])

  const m = map.current
  return (
    <div ref={wrap} data-station-map className="station-map relative overflow-hidden rounded-xl border border-line/70" style={{ height, background: '#ffffff' }}>
      {/* Inline position/size: MapLibre's unlayered `.maplibregl-map { position: relative }` would override Tailwind's `absolute` and collapse the container to 0px. */}
      <div ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {m && located.map((a) => {
        const p = m.project([a.reference.longitude!, a.reference.latitude!])
        const on = selection === a.id
        const size = on ? 24 : 17
        // Hover label sits beside the marker like Plotly's, flipped so it stays inside the map.
        const w = ref.current?.clientWidth ?? 600
        const below = p.y < (wrap.current?.clientHeight ?? height) / 2
        const tipX = p.x > w - 300 ? -288 : p.x < 150 ? 12 : -144
        return (
          <div key={a.id} className="absolute z-[2] size-0" style={{ left: p.x, top: p.y }}>
            <button
              onClick={() => onSelect(a.id)}
              onMouseEnter={() => setOpen(a.id)}
              onMouseLeave={() => setOpen(null)}
              onFocus={() => setOpen(a.id)}
              onBlur={() => setOpen(null)}
              aria-label={`${a.name}: ${a.reference.name}. Select area`}
              aria-pressed={on}
              className="map-pin absolute block rounded-full"
              style={{ width: size, height: size, left: -size / 2, top: -size / 2, background: on ? PIN.on : PIN.off }}
            />
            <span className="map-label pointer-events-none absolute -translate-x-1/2 whitespace-nowrap" style={{ left: 0, bottom: size / 2 + 2 }}>{a.name}</span>
            {open === a.id && <div className="map-hover absolute z-10 w-72 p-3 text-xs" style={{ left: tipX, ...(below ? { top: size / 2 + 8 } : { bottom: size / 2 + 8 }) }}>{hover(a.id)}</div>}
          </div>
        )
      })}

      {/* Layer switcher, styled like MapLibre's own controls. */}
      {tiles && (
        <div className="map-ctrl absolute top-[10px] left-[10px] z-[3]" role="group" aria-label="Map layers">
          <div className="map-seg" role="radiogroup" aria-label="Base map">
            {BASEMAPS.map((b) => (
              <button key={b.id} role="radio" aria-checked={basemap === b.id} onClick={() => setBasemap(b.id)} className={basemap === b.id ? 'on' : ''}>{b.label}</button>
            ))}
          </div>
          <label><input type="checkbox" checked={relief} disabled={basemap === 'topo'} onChange={(e) => setRelief(e.target.checked)} />Relief shading</label>
          <label><input type="checkbox" checked={contours} onChange={(e) => setContours(e.target.checked)} />Contour lines</label>
        </div>
      )}
      {cursor && <div className="map-readout absolute bottom-[10px] left-1/2 z-[3] -translate-x-1/2">{cursor} · click for elevation</div>}
    </div>
  )
}

/** Small street map for one verified water sampling point (MVP environmental_map.map_figure). */
export function PointMap({ lng, lat, label, tiles, height = 300 }: { lng: number; lat: number; label: string; tiles: boolean; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const style: maplibregl.StyleSpecification = { version: 8, sources: { streets: STYLE.sources.streets }, layers: [STYLE.layers[0], STYLE.layers[1]] }
    const m = new maplibregl.Map({ container: ref.current, style, center: [lng, lat], zoom: 13, attributionControl: { compact: true }, scrollZoom: false })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('move', () => setTick((t) => t + 1))
    m.on('load', () => setTick((t) => t + 1))
    map.current = m
    setTick((t) => t + 1)
    return () => { m.remove(); map.current = null }
  }, [lng, lat])
  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => m.setLayoutProperty('streets', 'visibility', tiles ? 'visible' : 'none')
    if (m.isStyleLoaded()) apply()
    else m.once('load', apply)
  }, [tiles])
  const p = map.current?.project([lng, lat])
  return (
    <div data-station-map className="station-map relative overflow-hidden rounded-xl border border-line/70" style={{ height, background: '#ffffff' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {p && (
        <div className="absolute z-[2] size-0" style={{ left: p.x, top: p.y }}>
          <span className="map-pin absolute block rounded-full" style={{ width: 19, height: 19, left: -9.5, top: -9.5, background: PIN.off }} title={label} />
          <span className="map-label pointer-events-none absolute -translate-x-1/2 whitespace-nowrap" style={{ left: 0, bottom: 12 }}>{label}</span>
        </div>
      )}
    </div>
  )
}

/** Click-to-place pin for staff complaints (Feature 11). Street map only, centred on the selected site. */
export function PinPicker({ area, value, onChange, height = 260 }: { area: AreaId; value: { lat: number; lon: number } | null; onChange: (p: { lat: number; lon: number } | null) => void; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  const [, setTick] = useState(0)
  const ref0 = AREAS.find((a) => a.id === area)?.reference
  const site = { lon: ref0?.longitude ?? CENTER[0], lat: ref0?.latitude ?? CENTER[1] }
  useEffect(() => {
    if (!ref.current) return
    const style: maplibregl.StyleSpecification = { version: 8, sources: { streets: STYLE.sources.streets }, layers: [STYLE.layers[0], STYLE.layers[1]] }
    const m = new maplibregl.Map({ container: ref.current, style, center: value ? [value.lon, value.lat] : [site.lon, site.lat], zoom: 15, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.getCanvas().style.cursor = 'crosshair'
    m.on('click', (e) => cb.current({ lat: +e.lngLat.lat.toFixed(6), lon: +e.lngLat.lng.toFixed(6) }))
    m.on('move', () => setTick((t) => t + 1))
    m.on('load', () => setTick((t) => t + 1))
    map.current = m
    setTick((t) => t + 1)
    return () => { m.remove(); map.current = null }
  }, [site.lat, site.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  // A pin set from search, GPS or typed coordinates: glide the map to it.
  useEffect(() => {
    const m = map.current
    if (!m || !value) return
    const z = m.getZoom()
    if (!m.getBounds().contains([value.lon, value.lat]) || z < 14) m.flyTo({ center: [value.lon, value.lat], zoom: Math.max(z, 16), speed: 1.4 })
  }, [value?.lat, value?.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = value && map.current ? map.current.project([value.lon, value.lat]) : null
  return (
    <div data-station-map data-pin-picker className="station-map relative overflow-hidden rounded-xl border border-line/70" style={{ height, background: '#ffffff' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {p && (
        <div className="pointer-events-none absolute z-[2] size-0" style={{ left: p.x, top: p.y }}>
          <span className="map-pin absolute block rounded-full" style={{ width: 19, height: 19, left: -9.5, top: -9.5, background: PIN.on }} />
        </div>
      )}
    </div>
  )
}
