/** Port of the MVP's dashboard/water_quality.py: official dated samples, independent of demand simulations. */
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ExternalLink } from 'lucide-react'
import { E, areaName, areasOf, downloadCsv, sampleLabel, type Selection, type WaterSample } from './eiq'
import { ClassBadge, SectionTitle, Select } from './eui'
import { PointMap } from './stationMap'
import { Panel } from './ui'

const SITE_COLORS = ['#42d9f5', '#a99bff', '#e6c477', '#43d6a0', '#ff9a76', '#6a8cf0', '#d08fd2']

export default function WaterQuality({ sel }: { sel: Selection }) {
  const frame = useMemo(() => areasOf(sel).flatMap((a) => E.water_samples[a].map((w) => ({ ...w, area_id: a }))), [sel])
  const types = useMemo(() => [...new Set(frame.map((w) => w.type))].sort(), [frame])
  const [type, setType] = useState(types[0] ?? '')
  const [site, setSite] = useState('All sites')
  const [parameter, setParameter] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [chosen, setChosen] = useState('')
  const [tiles, setTiles] = useState(true)
  const [more, setMore] = useState(false)

  const t = types.includes(type) ? type : types[0] ?? ''
  const byType = frame.filter((w) => w.type === t)
  const sites = ['All sites', ...new Set(byType.map((w) => w.site))].sort((a, b) => (a === 'All sites' ? -1 : b === 'All sites' ? 1 : a.localeCompare(b)))
  const st = sites.includes(site) ? site : 'All sites'
  const scoped = st === 'All sites' ? byType : byType.filter((w) => w.site === st)
  const params = [...new Set(scoped.map((w) => w.parameter))].sort()
  const pa = params.includes(parameter) ? parameter : params[0] ?? ''
  const min = scoped.reduce((m, w) => (w.start < m ? w.start : m), '9999-12-31')
  const max = scoped.reduce((m, w) => (w.end > m ? w.end : m), '0000-01-01')
  const s0 = start && start >= min && start <= max ? start : min
  const e0 = end && end >= min && end <= max ? end : max
  useEffect(() => { setStart(''); setEnd('') }, [t, st])

  if (!frame.length) return <Panel className="mt-4 p-6 text-sm text-mute">No verified water samples exist for this geographic scope.</Panel>
  const badRange = s0 > e0
  const selected = badRange ? [] : scoped.filter((w) => w.parameter === pa && w.end >= s0 && w.start <= e0).sort((a, b) => a.start.localeCompare(b.start) || a.site.localeCompare(b.site))
  const latest = selected.at(-1)
  const record = selected.find((w) => w.id === chosen) ?? latest
  const located = record && record.lat != null && record.lon != null ? record : null
  const anyLocated = selected.some((w) => w.lat != null)
  const sitesInChart = [...new Set(selected.filter((w) => w.measurement_status === 'Measured' && w.exact != null).map((w) => w.site))]
  const categories = [...new Set(selected.map(sampleLabel))]

  return (
    <Panel className="mt-4">
      <SectionTitle title="Water Quality Observations" sub="Official dated river, groundwater and distribution-system samples · independent of demand simulations" />
      <div className="space-y-4 p-5">
        <div className="rounded-lg border border-med/35 bg-med/10 px-4 py-3 text-[12.5px] leading-relaxed text-[#f8d79a]">Numeric WQI is unavailable. “Safe” applies to the reported chlorine test, not a complete potability assessment.</div>
        <p className="text-[11.5px] text-dim">Global geographic scope: {areaName(sel)}</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Select label="Water type" value={t} options={types} onChange={(v) => { setType(v); setSite('All sites'); setChosen('') }} />
          <Select label="Sampling site" value={st} options={sites} onChange={(v) => { setSite(v); setChosen('') }} />
          <Select label="Water parameter" value={pa} options={params} onChange={(v) => { setParameter(v); setChosen('') }} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DateField label="Water start date" value={s0} min={min} max={max} onChange={setStart} />
          <DateField label="Water end date" value={e0} min={min} max={max} onChange={setEnd} />
        </div>
        <p className="text-[11px] text-dim">These controls filter water observations only. Month-only records match any selected day within their reported month.</p>
        {badRange && <p className="rounded-lg border border-med/40 bg-med/10 px-3 py-2 text-xs text-med">Water start date must be on or before the end date.</p>}

        {sel === 'all' && !badRange && (
          <div className="overflow-x-auto rounded-lg border border-line/60">
            <table className="eiq-table">
              <thead><tr><th>Area</th><th>Matching parameter records</th><th>Latest dated result</th><th>Date / reported month</th><th>Sampling site</th></tr></thead>
              <tbody>{areasOf(sel).map((a) => {
                const m = selected.filter((w) => w.area_id === a); const l = m.at(-1)
                return <tr key={a}><td className="text-white">{areaName(a)}</td><td className="num">{m.length}</td><td className="num">{l ? `${l.value} ${l.unit}` : 'Unavailable'}</td><td>{l ? sampleLabel(l) : 'Unavailable'}</td><td>{l?.site ?? 'Unavailable'}</td></tr>
              })}</tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-dim">Results are compared by named sampling site and medium. No aggregate water-quality score or locality-wide potability conclusion is calculated.</p>
          </div>
        )}

        {!badRange && !selected.length && <p className="rounded-lg border border-line px-3 py-6 text-center text-sm text-mute">No verified observations match these filters. Missing periods have not been filled.</p>}

        {selected.length > 0 && record && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {sel !== 'all'
                ? <Kpi k="Latest recorded result" v={latest!.value ? `${latest!.value} ${latest!.unit}` : 'Unavailable'} d={`${sampleLabel(latest!)} · ${latest!.site}`} />
                : <Kpi k="Areas with matching samples" v={String(new Set(selected.map((w) => w.area_id)).size)} d="Named sites, not locality averages" />}
              <Kpi k="Selected parameter records" v={String(selected.length)} d="One parameter per site and monitoring period. Annual overlaps excluded." />
              <Kpi k="Numeric WQI" v="Unavailable" d="Not published in the retrieved sources" />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-mute">Observation details</span>
              <select value={record.id} onChange={(e) => setChosen(e.target.value)} className="h-9 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg hover:border-lav/40 focus:border-sapphire focus:outline-none">
                {selected.map((w) => <option key={w.id} value={w.id}>{sampleLabel(w)} · {w.site} · {w.value} {w.unit}</option>)}
              </select>
            </label>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div>
                <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-white">Verified sampling locations</h4>
                  {anyLocated && <label className="flex items-center gap-2 text-[11.5px] text-mute"><input type="checkbox" className="eiq-toggle" checked={tiles} onChange={(e) => setTiles(e.target.checked)} />Show street-map background</label>}</div>
                {located
                  ? <><PointMap lng={located.lon!} lat={located.lat!} label={located.site} tiles={tiles} height={280} />
                    <p className="mt-2 text-[11px] text-dim">Marker represents the official Khandagiri groundwater monitoring point, not the locality boundary or a chlorine sampling site. Use the record selector above.</p></>
                  : <p className="rounded-lg border border-line px-3 py-6 text-center text-[12.5px] text-mute">Sampling coordinates are unverified for this observation. Results appear in the details panel; no guessed markers are placed.</p>}
              </div>
              <div className="summary-card space-y-1.5 text-[12.5px]">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-white">Selected observation</span><ClassBadge cls={record.classification} /></div>
                <p className="text-soft">{record.site} · {record.type}</p>
                <p className="text-soft">{sampleLabel(record)} · {record.parameter}: <span className="num font-semibold text-white">{record.value} {record.unit}</span></p>
                <p className="text-mute">Reported test status: {record.status || 'Not reported'}</p>
                <p className="text-mute">Verification: {record.verification}</p>
                {record.source && <a className="eiq-btn mt-1 w-full" href={record.source} target="_blank" rel="noreferrer">Open official source <ExternalLink size={12} /></a>}
                {record.notes && <p className="text-[11px] leading-snug text-dim">{record.notes}</p>}
                <p className="text-[11px] text-dim">{record.scope}</p>
                {record.source_page && <p className="text-[11px] text-dim">Source PDF page: {record.source_page}</p>}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-white">Measurements over time</h4>
              {sitesInChart.length ? (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 300 }}>
                    <ScatterChart margin={{ top: 10, right: 16, bottom: 30, left: 4 }}>
                      <CartesianGrid stroke="rgba(232,227,250,.08)" />
                      <XAxis type="category" dataKey="label" allowDuplicatedCategory={false} ticks={categories} tick={{ fill: '#b8b2d2', fontSize: 10.5 }} angle={-25} textAnchor="end" height={56} name="Sample date / reported monitoring month" />
                      <YAxis type="number" dataKey="v" tick={{ fill: '#b8b2d2', fontSize: 11 }} width={56} label={{ value: selected[0].unit, angle: -90, position: 'insideLeft', fill: '#918baf', fontSize: 11 }} />
                      <Tooltip cursor={{ stroke: '#a99bff', strokeOpacity: 0.4 }} content={({ payload }) => { const d = payload?.[0]?.payload as { site: string; label: string; raw: string; unit: string } | undefined; return d ? <div className="float-glass rounded-lg px-3 py-2 text-xs">{d.site} · {d.raw} {d.unit} · {d.label}</div> : null }} />
                      {sitesInChart.map((s, i) => <Scatter key={s} name={s} fill={SITE_COLORS[i % SITE_COLORS.length]} isAnimationActive={false}
                        data={selected.filter((w) => w.site === s && w.measurement_status === 'Measured' && w.exact != null).map((w) => ({ label: sampleLabel(w), v: w.exact, site: w.site, raw: w.value, unit: w.unit }))} />)}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="rounded-lg border border-line px-3 py-6 text-center text-[12.5px] text-mute">No exact numeric results are available for this selection. Censored bounds and unanalysed records remain visible in the table.</p>}
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-mute">{sitesInChart.map((s, i) => <span key={s} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SITE_COLORS[i % SITE_COLORS.length] }} />{s}</span>)}</div>
              {selected.some((w) => w.measurement_status === 'Censored') && <p className="mt-1 text-[11px] text-dim">Censored results are excluded from exact-value charts. Read their inequality and bound in the table.</p>}
            </div>

            <div className="max-h-96 overflow-auto rounded-lg border border-line/60">
              <table className="eiq-table">
                <thead><tr><th>Area</th><th>Site reported</th><th>Sample date</th><th>Period</th><th>Precision</th><th>Parameter</th><th>Value</th><th>Unit</th><th>Measurement</th><th>Reported status</th><th>Evidence</th><th>Scope</th><th>Official source</th><th>Page</th><th>Verification</th></tr></thead>
                <tbody>{selected.map((w) => (
                  <tr key={w.id} className={w.id === record.id ? 'bg-sapphire/10' : ''}><td>{areaName(w.area_id)}</td><td>{w.site_reported}</td><td className="num">{w.sample_date}</td><td className="num">{w.sample_period}</td><td>{w.date_precision}</td><td>{w.parameter}</td><td className="num text-white">{w.value}</td><td>{w.unit}</td><td>{w.measurement_status}</td><td>{w.status}</td><td><ClassBadge cls={w.classification} /></td><td className="min-w-56 text-[11px] text-dim">{w.scope}</td><td>{w.source ? <a className="text-lav hover:text-white" href={w.source} target="_blank" rel="noreferrer">Open source</a> : '—'}</td><td>{w.source_page}</td><td className="text-[11px]">{w.verification}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <button className="eiq-btn" onClick={() => downloadCsv('water_observations_selected.csv', selected.map(({ notes, ...w }) => ({ ...w, notes })) as unknown as Record<string, unknown>[])}>Download filtered water observations</button>
          </>
        )}

        <div className="rounded-lg border border-line/60">
          <button className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium text-white" onClick={() => setMore(!more)} aria-expanded={more}>Coverage, source overlaps and missing data<span className="text-mute">{more ? '−' : '+'}</span></button>
          {more && (
            <div className="space-y-2 px-4 pb-4 text-[12.5px] leading-relaxed text-mute">
              <p>Canonical coverage: {Object.values(E.water_samples).reduce((n, v) => n + v.length, 0)} parameter records across the three areas, including 36 dated Palasuni river sampling periods. Coverage counts are parameter fields, not independent samples.</p>
              <p>{E.water_evidence_records - Object.values(E.water_samples).reduce((n, v) => n + v.length, 0)} overlapping annual records are retained as supporting evidence and excluded from the canonical series; all {E.water_evidence_records} evidence records remain available for download.</p>
              <p>IRC Village/Nayapalli monthly water-quality history for 2023–2025 is unavailable. Groundwater is sampled in April and October only. Missing months remain missing.</p>
              <p>Nitrate as NO3 and nitrate-nitrogen as NO3-N remain separate parameters. No conversion or WQI calculation was performed.</p>
              <a className="eiq-btn" href={`${import.meta.env.BASE_URL}data/water_quality_evidence.csv`} download="water_source_evidence.csv">Download all source evidence</a>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

const Kpi = ({ k, v, d }: { k: string; v: string; d: string }) => (
  <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className="num mt-1 text-lg font-semibold text-white">{v}</div><div className="mt-0.5 text-[10.5px] leading-snug text-dim">{d}</div></div>
)
function DateField({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium text-mute">{label}</span>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg [color-scheme:dark] hover:border-lav/40 focus:border-sapphire focus:outline-none" />
    </label>
  )
}
export type { WaterSample }
