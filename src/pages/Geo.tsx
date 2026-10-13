import { useState } from 'react'
import { AREAS, AREA_COLOR, CLASS_LABELS, METRICS, areaName, areasOf, comparison, fmt, history, series, type Classification } from '../eiq'
import { ClassBadge, MonthlyChart, SectionTitle, Select, StationMap, areaLines } from '../eui'
import { PageHeader, Panel } from '../ui'
import { AreaHover } from './CommandCenter'
import type { PageProps } from '../App'

export default function Geo({ sel, years, setSel }: PageProps) {
  const [key, setKey] = useState('pm25_ug_m3')
  const [tiles, setTiles] = useState(true)
  const m = METRICS[key]
  const comp = comparison('all', key, years)
  const ids = AREAS.map((a) => a.id)
  // MVP 'Selected-period data coverage': records and numeric values per area and evidence class.
  const coverage = areasOf(sel).flatMap((a) => {
    const t = new Map<Classification, { records: number; numeric: number }>()
    for (const k of Object.keys(METRICS)) for (const p of history(a, k, years)) {
      const c = t.get(p[2]) ?? { records: 0, numeric: 0 }
      c.records++; if (p[1] != null) c.numeric++
      t.set(p[2], c)
    }
    return [...t.entries()].map(([cls, c]) => ({ area: areaName(a), cls, ...c }))
  })
  const compSel = comparison(sel, key, years)
  return (
    <>
      <PageHeader eyebrow="Spatial evidence" title="Geographic Intelligence" desc={"Station locations and same-month comparison across Palasuni, IRC Village/Nayapalli and Khandagiri. Areas are compared side by side and never pooled into an average."} accent={'#42d9f5'} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel className="board">
          <SectionTitle title="Reference locations" sub="Select a marker to focus the workspace on that area" right={<label className="flex items-center gap-2 text-[11.5px] text-mute"><input type="checkbox" checked={tiles} onChange={(e) => setTiles(e.target.checked)} className="eiq-toggle" />Street map</label>} />
          <div className="p-4"><StationMap selection={sel} onSelect={setSel} tiles={tiles} height={420} hover={(a) => <AreaHover id={a} years={years} />} /></div>
        </Panel>
        <Panel>
          <SectionTitle title="Same-month area comparison" sub={`${comp[0].period} · last selected month with data`} right={<div className="w-56"><Select label="Indicator" value={key} options={Object.keys(METRICS)} onChange={setKey} format={(k) => `${METRICS[k].domain} · ${METRICS[k].name}`} /></div>} />
          <div className="space-y-3 p-5">
            {comp.map((r) => {
              const max = Math.max(...comp.map((x) => x.value ?? 0)) || 1
              return (
                <button key={r.area} onClick={() => setSel(r.area)} className={`block w-full rounded-xl border p-3 text-left transition-colors ${sel === r.area ? 'border-sapphire bg-sapphire/10' : 'border-line hover:border-lav/40'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium text-white">{r.name}</span><ClassBadge cls={r.cls} /></div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${((r.value ?? 0) / max) * 100}%`, background: AREA_COLOR[r.area] }} /></div>
                    <span className="num w-28 text-right text-[13px] font-semibold text-white">{fmt(r.value, m.unit)}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] leading-snug text-dim">{r.scope}</div>
                </button>
              )
            })}
          </div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <SectionTitle title={`${m.name} by area`} sub={`${m.unit} · monthly · ${years.join(', ')} · gaps shown as breaks`} />
        <div className="p-4"><MonthlyChart lines={areaLines(ids, key, (a) => history(a, key, years))} unit={m.unit} indiLabel={m.name} /></div>
        <div className="flex flex-wrap gap-4 px-5 pb-4 text-xs text-mute">{ids.map((a) => <span key={a} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: AREA_COLOR[a] }} />{areaName(a)}</span>)}</div>
        <div className="overflow-x-auto border-t border-line/60">
          <table className="eiq-table">
            <thead><tr><th>Area</th><th>Period</th><th>Value</th><th>Classification</th><th>Scope</th><th>Source</th></tr></thead>
            <tbody>{compSel.map((r) => (
              <tr key={r.area}><td className="text-white">{r.name}</td><td className="num">{r.period}</td><td className="num">{fmt(r.value, m.unit)}</td><td><ClassBadge cls={r.cls} long /></td><td className="min-w-56 text-[11px] text-dim">{r.scope}</td>
                <td className="text-[11px]">{r.source.startsWith('http') ? <a className="text-lav hover:text-white" href={r.source} target="_blank" rel="noreferrer">Open source</a> : <span className="text-dim">{r.source}</span>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Map reference points" sub="What each marker represents, with its coordinate source and scope" />
        <div className="overflow-x-auto">
          <table className="eiq-table">
            <thead><tr><th>Area</th><th>Reference</th><th>Station ID</th><th>Medium</th><th>Latitude</th><th>Longitude</th><th>Coordinate status</th><th>Coordinate source</th><th>Scope</th></tr></thead>
            <tbody>{AREAS.map((a) => (
              <tr key={a.id}><td className="text-white">{a.name}</td><td>{a.reference.name}</td><td>{a.reference.station_id}</td><td>{a.reference.medium}</td><td className="num">{a.reference.latitude ?? '—'}</td><td className="num">{a.reference.longitude ?? '—'}</td><td>{a.reference.coordinate_status.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="text-[11px]">{a.reference.coordinate_source?.startsWith('http') ? <a className="text-lav hover:text-white" href={a.reference.coordinate_source} target="_blank" rel="noreferrer">Open source</a> : a.reference.coordinate_source}</td><td className="min-w-56 text-[11px] text-dim">{a.reference.scope}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Selected-period data coverage" sub={`${areaName(sel)} · ${years.join(', ')} · records are metric-months; numeric values exclude missing and censored readings`} />
        {coverage.length ? (
          <div className="overflow-x-auto">
            <table className="eiq-table">
              <thead><tr><th>Area</th><th>Classification</th><th>Records</th><th>Numeric values</th></tr></thead>
              <tbody>{coverage.map((c, i) => <tr key={i}><td className="text-white">{c.area}</td><td><span className="flex items-center gap-2"><ClassBadge cls={c.cls} />{CLASS_LABELS[c.cls]}</span></td><td className="num">{c.records}</td><td className="num">{c.numeric}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="p-5 text-sm text-mute">No monthly coverage in the selected reporting period.</p>}
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Station registry" sub="Coordinates as published; unverified or missing coordinates are not plotted" />
        <div className="overflow-x-auto">
          <table className="eiq-table">
            <thead><tr><th>Area</th><th>Station</th><th>Medium</th><th>Latitude</th><th>Longitude</th><th>Coordinate status</th></tr></thead>
            <tbody>
              {AREAS.flatMap((a) => a.stations.map((s) => (
                <tr key={s.station_id}><td>{a.name}</td><td className="text-white">{s.name}</td><td>{s.medium}</td><td className="num">{s.latitude ?? '—'}</td><td className="num">{s.longitude ?? '—'}</td><td>{s.coordinate_status.replace(/_/g, ' ').toLowerCase()}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
