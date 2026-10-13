/** Feature 6: live air quality (official CPCB when available, otherwise a clearly labelled model) and weather. */
import { useCallback, useEffect, useState } from 'react'
import { CloudRain, RefreshCw, Thermometer, Wind } from 'lucide-react'
import { api, type LiveData } from './api'
import { areaName, areasOf, type AreaId, type Selection } from './eiq'
import { SectionTitle } from './eui'
import { Panel } from './ui'

export const AQI_TONE: Record<string, string> = {
  Good: 'bg-ok/15 text-ok border-ok/40', Satisfactory: 'bg-ok/10 text-[#9be3b0] border-ok/30', Moderate: 'bg-med/15 text-med border-med/40',
  Poor: 'bg-high/15 text-high border-high/40', 'Very Poor': 'bg-crit/15 text-crit border-crit/40', Severe: 'bg-crit/25 text-crit border-crit/60',
}
/** IMD daily rainfall wording (mm/day). */
export const rainWord = (mm: number) => (mm >= 204.5 ? 'extremely heavy rain' : mm >= 115.6 ? 'very heavy rain' : mm >= 64.5 ? 'heavy rain' : mm >= 15.6 ? 'moderate rain' : mm >= 2.5 ? 'light rain' : mm > 0 ? 'very light rain' : 'no rain')

export function useLive() {
  const [live, setLive] = useState<LiveData | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (refresh = false) => {
    setBusy(true)
    try { setLive(await api<LiveData>(`/live${refresh ? '?refresh=true' : ''}`)) } catch { /* shown as unavailable */ } finally { setBusy(false) }
  }, [])
  useEffect(() => { load(); const t = setInterval(() => load(), 30 * 60_000); return () => clearInterval(t) }, [load])
  return { live, busy, refresh: () => load(true) }
}

export default function LivePanel({ sel }: { sel: Selection }) {
  const { live, busy, refresh } = useLive()
  const areas = areasOf(sel)
  return (
    <Panel className="mb-4 overflow-hidden">
      <SectionTitle title="Live conditions" sub="Air quality now and the next 3 days of weather · refreshed every 30 minutes" right={<button className="eiq-btn" onClick={refresh} disabled={busy}><RefreshCw size={12} className={busy ? 'animate-spin' : ''} />Refresh</button>} />
      <div className={`grid gap-3 p-4 ${areas.length > 1 ? 'lg:grid-cols-3' : ''}`}>
        {areas.map((a) => <AreaLive key={a} area={a} d={live?.[a]} />)}
      </div>
    </Panel>
  )
}

function AreaLive({ area, d }: { area: AreaId; d?: LiveData[string] }) {
  const air = d?.air
  const w = d?.weather
  return (
    <div className="summary-card space-y-2">
      <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-white">{areaName(area)}</span>
        {air?.kind && air.kind !== 'unavailable' && <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${air.kind === 'official' ? 'border-ok/40 text-ok' : 'border-med/40 text-med'}`}>{air.kind === 'official' ? 'Official · CPCB' : 'Modelled · not official'}</span>}</div>
      {!d ? <p className="text-[11.5px] text-mute">Loading…</p> : air?.kind === 'unavailable' || !air ? (
        <p className="text-[11.5px] text-mute">Live air quality unavailable{air?.error ? ` (${air.error.slice(0, 80)})` : ''}.</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className={`grid min-w-16 place-items-center rounded-lg border px-2 py-1.5 ${AQI_TONE[air.category ?? ''] ?? 'border-line text-mute'}`}><span className="num text-xl font-bold">{air.aqi ?? '—'}</span><span className="text-[9.5px] font-semibold uppercase">AQI</span></div>
          <div className="min-w-0 text-[11.5px] leading-snug">
            <div className="font-semibold text-white">{air.category ?? '—'}{air.lead ? <span className="font-normal text-mute"> · led by {air.lead}</span> : null}</div>
            <div className="text-mute">{air.station ?? air.match}{air.time ? ` · ${air.time}` : ''}</div>
            {!air.valid && <div className="text-dim">Indicative: fewer than 3 pollutants reported</div>}
            {air.stale && <div className="text-med">Showing last saved reading (service unreachable)</div>}
          </div>
        </div>
      )}
      {w && !w.error && w.current ? (
        <div className="space-y-1 border-t border-line/60 pt-2 text-[11.5px] text-soft">
          <div className="flex flex-wrap gap-x-3 gap-y-1"><span className="flex items-center gap-1"><Thermometer size={12} className="text-lav" />{w.current.temperature_2m?.toFixed(0)}°C (feels {w.current.apparent_temperature?.toFixed(0)}°C)</span>
            <span>{w.current.relative_humidity_2m}% humidity</span><span className="flex items-center gap-1"><Wind size={12} className="text-lav" />{w.current.wind_speed_10m?.toFixed(0)} km/h</span></div>
          <div className="flex gap-2">{(w.daily ?? []).map((x) => (
            <div key={x.date} className={`flex-1 rounded-md border px-2 py-1 ${x.rain_mm >= 64.5 || x.tmax >= 40 ? 'border-med/50 bg-med/10' : 'border-line'}`}>
              <div className="text-[10px] text-dim">{new Date(x.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</div>
              <div className="num text-white">{Math.round(x.tmax)}° / {Math.round(x.tmin)}°</div>
              <div className="flex items-center gap-1 text-[10px] text-mute"><CloudRain size={10} />{x.rain_mm.toFixed(0)} mm</div>
            </div>))}</div>
        </div>
      ) : d ? <p className="border-t border-line/60 pt-2 text-[11.5px] text-mute">Weather unavailable.</p> : null}
    </div>
  )
}
