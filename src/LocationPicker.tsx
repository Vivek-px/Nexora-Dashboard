/**
 * Where is the problem? (Part 1C) – four ways to mark it, then fill in the rest:
 * search a place, share the device's current location, type coordinates, or click the map.
 * Place search uses OpenStreetMap Nominatim through the Nexora server (search on Enter only, per its usage policy).
 */
import { useEffect, useRef, useState } from 'react'
import { Crosshair, Hash, LoaderCircle, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { api, type GeoHit } from './api'
import { AREAS, areaName, type AreaId } from './eiq'
import { PinPicker } from './stationMap'

export interface Spot { lat: number; lon: number; place: string; source: 'map' | 'gps' | 'search' | 'coordinates'; accuracy?: number }
type Mode = 'search' | 'gps' | 'coords'

const field = 'h-9 w-full min-w-0 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none'
const SOURCE = { map: 'map click', gps: 'your device location', search: 'place search', coordinates: 'typed coordinates' } as const

/** Accepts "20.2961, 85.8245", "20.2961 85.8245" or degrees-minutes-seconds like 20°17'46"N 85°49'28"E. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const t = text.trim()
  const dms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?/gi)]
  let lat: number, lon: number
  if (dms.length === 2 && t.includes('°')) {
    const v = dms.map((m) => (Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600) * (/[SW]/i.test(m[4] ?? '') ? -1 : 1))
    ;[lat, lon] = /[EW]/i.test(dms[0][4] ?? '') ? [v[1], v[0]] : [v[0], v[1]]
  } else {
    const n = t.split(/[\s,;]+/).filter(Boolean).map(Number)
    if (n.length !== 2 || n.some((x) => !Number.isFinite(x))) return null
    ;[lat, lon] = n
  }
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: +lat.toFixed(6), lon: +lon.toFixed(6) } : null
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

export default function LocationPicker({ area, sites, value, onChange, onSuggestSite }: {
  area: AreaId; sites: AreaId[]; value: Spot | null; onChange: (s: Spot | null) => void; onSuggestSite: (a: AreaId) => void
}) {
  const [mode, setMode] = useState<Mode>('search')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GeoHit[] | null>(null)
  const [coords, setCoords] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const seq = useRef(0)

  // Name the spot (best effort) when it came from the map, GPS or typed coordinates.
  const named = async (s: Spot) => {
    const n = ++seq.current
    setErr('')
    onChange(s)
    if (s.place) return
    try {
      const r = await api<{ name: string }>(`/geo/reverse?lat=${s.lat}&lon=${s.lon}`)
      if (n === seq.current && r.name) onChange({ ...s, place: r.name })
    } catch { /* address is optional */ }
  }
  useEffect(() => { setErr('') }, [mode])

  const search = async () => {
    if (q.trim().length < 3) return setErr('Type at least 3 letters, then press Enter.')
    setBusy(true); setErr(''); setHits(null)
    try {
      const r = await api<GeoHit[]>(`/geo/search?q=${encodeURIComponent(q.trim())}`)
      setHits(r)
      if (!r.length) setErr('No match. Try a landmark, road or locality name, or use the map.')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Search failed') } finally { setBusy(false) }
  }
  const locate = () => {
    if (!('geolocation' in navigator)) return setErr('This browser cannot share its location. Use search, coordinates or the map.')
    setBusy(true); setErr('')
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); named({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), place: '', source: 'gps', accuracy: Math.round(p.coords.accuracy) }) },
      (e) => {
        setBusy(false)
        setErr(e.code === e.PERMISSION_DENIED ? 'Location permission was blocked. Allow it from the address-bar icon, or use search, coordinates or the map.'
          : e.code === e.TIMEOUT ? 'Getting your location took too long. Try again near a window, or use another option.' : 'Your location is not available on this device (desktop PCs often have no GPS). Use search, coordinates or the map.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }
  const setTyped = () => {
    const c = parseCoords(coords)
    if (!c) return setErr('Enter latitude and longitude, e.g. 20.2961, 85.8245 (or 20°17′46″N 85°49′28″E).')
    setErr('')
    named({ ...c, place: '', source: 'coordinates' })
  }

  // Suggest the nearest of the user's sites when the pin is clearly closer to another one.
  const ref = (a: AreaId) => { const r = AREAS.find((x) => x.id === a)?.reference; return r?.latitude != null && r.longitude != null ? { lat: r.latitude, lon: r.longitude } : null }
  const nearest = value ? sites.map((a) => ({ a, d: ref(a) ? km(value, ref(a)!) : Infinity })).sort((x, y) => x.d - y.d)[0] : null
  const cur = value && ref(area) ? km(value, ref(area)!) : null

  const tab = (m: Mode, label: string, Icon: typeof Search) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${mode === m ? 'bg-sapphire/30 text-white shadow-[inset_0_0_0_1px_rgba(106,140,240,.5)]' : 'text-mute hover:text-fg'}`}><Icon size={13} />{label}</button>
  )
  return (
    <fieldset className="space-y-2.5" aria-label="Location of the problem">
      <legend className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-mute"><MapPin size={12} />Where is it? Mark the spot first, then fill in the details</legend>
      <div role="tablist" className="flex gap-1 rounded-lg border border-line bg-ink/40 p-1">
        {tab('search', 'Search place', Search)}
        {tab('gps', 'My location', LocateFixed)}
        {tab('coords', 'Coordinates', Hash)}
      </div>
      {mode === 'search' && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input className={field} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }} placeholder="Landmark, road, locality – e.g. Palasuni water works" aria-label="Search a place" />
            <button type="button" onClick={search} disabled={busy} className="eiq-btn shrink-0">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Search size={13} />}Search</button>
          </div>
          {hits && hits.length > 0 && (
            <ul className="indi-scroll max-h-44 overflow-y-auto rounded-lg border border-line/70 bg-panel/80" role="listbox" aria-label="Search results">
              {hits.map((h, i) => (
                <li key={i}><button type="button" role="option" aria-selected={value?.lat === h.lat && value?.lon === h.lon} onClick={() => { setHits(null); named({ lat: +h.lat.toFixed(6), lon: +h.lon.toFixed(6), place: h.name, source: 'search' }) }} className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] text-soft hover:bg-white/[0.05]"><MapPin size={12} className="mt-0.5 shrink-0 text-lav" /><span className="line-clamp-2">{h.name}</span></button></li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-dim">Search © OpenStreetMap contributors (Nominatim). Press Enter to search.</p>
        </div>
      )}
      {mode === 'gps' && (
        <button type="button" onClick={locate} disabled={busy} className="eiq-btn w-full">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Crosshair size={14} />}{busy ? 'Finding you…' : 'Share my current location'}</button>
      )}
      {mode === 'coords' && (
        <div className="flex gap-2">
          <input className={field} value={coords} onChange={(e) => setCoords(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setTyped() } }} placeholder="Latitude, longitude – e.g. 20.2961, 85.8245" aria-label="Coordinates" />
          <button type="button" onClick={setTyped} className="eiq-btn shrink-0"><MapPin size={13} />Set pin</button>
        </div>
      )}
      {err && <p role="alert" className="rounded-lg border border-med/40 bg-med/10 px-3 py-2 text-[12px] text-med">{err}</p>}
      <PinPicker area={area} value={value} onChange={(p) => p && named({ ...p, place: '', source: 'map' })} />
      {value ? (
        <div className="flex items-start gap-2 rounded-lg border border-lav/25 bg-lav/[0.06] px-3 py-2 text-[12px] text-soft">
          <MapPin size={14} className="mt-0.5 shrink-0 text-gold" />
          <div className="min-w-0 flex-1">
            <div className="num font-medium text-white">{value.lat.toFixed(5)}, {value.lon.toFixed(5)}<span className="ml-1.5 font-normal text-dim">via {SOURCE[value.source]}{value.accuracy ? ` · ±${value.accuracy} m` : ''}</span></div>
            {value.place && <div className="mt-0.5 line-clamp-2 text-mute">{value.place}</div>}
            {nearest && nearest.a !== area && cur != null && nearest.d < cur - 1 && nearest.d < 25 && (
              <button type="button" onClick={() => onSuggestSite(nearest.a)} className="mt-1 text-[11.5px] text-lav underline">This spot is nearer {areaName(nearest.a)} ({nearest.d.toFixed(1)} km) – file it under that site</button>
            )}
          </div>
          <button type="button" onClick={() => { seq.current++; onChange(null) }} aria-label="Clear location" className="text-dim hover:text-fg"><X size={14} /></button>
        </div>
      ) : <p className="text-[11px] text-dim">Or click the map to drop a pin. Location is optional but helps the team find the problem quickly.</p>}
    </fieldset>
  )
}
