/** Feature 8: benchmarking – per person, per m² and against norms (CPHEEO 135 LPCD) or the site's own targets. */
import { useEffect, useState, type ReactNode } from 'react'
import { ShieldCheck, Trash2, Wrench, GitMerge, Info } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Benchmark, type BenchRow } from '../api'
import { AREA_COLOR, areaName, areasOf, fmt, type AreaId, type Selection } from '../eiq'
import { SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'

type CriticalComponent = { key: string; label: string; score: number | null; current: number | null; target: number | null; unit: string; status: string; basis: string; source: string }
type CriticalEvent = { area: string; period: string; level: string; metric_count: number; metrics: { metric: string; value: number | null; unit: string; status: string; expected: number | null; deviation: number | null; classification: string }[]; explanation: string }
type RiskResult = { risk_score: number | null; level: string; signals: string[]; basis: string; limitations: string; latest_value?: number; latest_period?: string; baseline_median?: number | null; change_pct?: number | null; risk_horizon?: string; projected_next_period_kg?: number }
type DemoInsights = { data_label: string; scenario: string; readings: Record<string, string | number>[]; events: { timestamp: string; severity: string; kind: string; explanation: string; metrics: { metric: string; value: number; unit: string; baseline: number; threshold: number; increase_pct: number }[] }[]; forecast: { status: string; method?: string; horizon_hours?: number; forecast?: Record<string, string | number>[]; backtest?: Record<string, { mae: number | null; samples: number; unit: string }>; limitations?: string; message?: string }; recommendations: { title: string; priority: string; action: string; assumptions: string[]; expected_benefit: string; confidence: string; verification: string }[]; method_notes: string[] }
type CriticalInsights = { area: string; area_name: string; scorecard: { score: number | null; coverage_pct: number; components_available: number; components_total: number; band: string; method: string; components: CriticalComponent[]; period: string | null }; waste_overflow: RiskResult; maintenance_risk: RiskResult; cross_metric_events: CriticalEvent[]; data_period: string | null; notice: string }

const MEASURES = [
  { key: 'lpcd', label: 'Water per person per day', unit: 'L', ref: 'lpcd' },
  { key: 'kwh_per_person', label: 'Electricity per person per month', unit: 'kWh', ref: null },
  { key: 'kwh_per_m2', label: 'Electricity per m² per month', unit: 'kWh/m²', ref: null },
  { key: 'waste_kg_pp_day', label: 'Waste per person per day', unit: 'kg', ref: 'waste' },
  { key: 'co2e_kg_per_person', label: 'CO₂e (prototype) per person per month', unit: 'kg', ref: null },
  { key: 'peak_vs_contract_pct', label: 'Peak demand as % of contract demand', unit: '%', ref: 'contract' },
] as const

export default function Benchmarks({ sel, go }: { sel: Selection; go: (p: 'admin') => void }) {
  const { version, user } = useSession()
  const [data, setData] = useState<Record<string, Benchmark>>({})
  const [measure, setMeasure] = useState<string>('lpcd')
  const [critical, setCritical] = useState<Record<string, CriticalInsights>>({})
  const [demo, setDemo] = useState<DemoInsights | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoError, setDemoError] = useState('')
  const runDemo = (scenario: string) => { setDemoLoading(true); setDemoError(''); api<DemoInsights>(`/demo-intelligence?scenario=${scenario}`).then(setDemo).catch((e: Error) => setDemoError(e.message || 'Could not load simulator. Check backend and permissions.')).finally(() => setDemoLoading(false)) }
  useEffect(() => { api<Record<string, CriticalInsights>>('/critical-insights').then(setCritical).catch(() => setCritical({})) }, [version])
  useEffect(() => { api<Record<string, Benchmark>>('/benchmarks').then(setData).catch(() => {}) }, [version])
  const areas = areasOf(sel).filter((a) => data[a])
  const m = MEASURES.find((x) => x.key === measure)!
  const months = [...new Set(areas.flatMap((a) => data[a].monthly.map((r) => r.month)))].sort().slice(-24)
  const rows = months.map((mo) => ({ m: mo, ...Object.fromEntries(areas.map((a) => [a, (data[a].monthly.find((r) => r.month === mo) as unknown as Record<string, number | null>)?.[m.key] ?? null])) }))
  const refValue = m.ref === 'contract' ? 100 : m.ref && areas[0] ? data[areas[0]].references[m.ref as 'lpcd' | 'waste'].value : null
  const missingProfile = areas.some((a) => data[a].profile.population_source.startsWith('MVP') || !data[a].profile.floor_area_m2)
  return (
    <>
      <PageHeader eyebrow="Operations" title="Benchmarking" desc="Compare sites fairly: usage per person, per square metre and against norms – CPHEEO’s 135 litres per person per day for water, and your own targets for energy (EPI) and waste." accent="#a99bff" />
      {missingProfile && <div className="mb-4 rounded-lg border border-med/40 bg-med/10 px-4 py-3 text-[12.5px] text-soft">Some sites still use the MVP’s hypothetical population (1,000) or have no floor area. {user.role === 'admin' ? <button className="text-lav underline" onClick={() => go('admin')}>Enter real figures in Admin → Site profiles</button> : 'Ask an admin to enter real figures.'}</div>}
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        {areas.map((a) => {
          const b = data[a]; const last = b.monthly.at(-1)
          // Each measure shows its own most recent month with a value (uploads may cover only some metrics).
          const latest = (k: keyof BenchRow) => { const r = [...b.monthly].reverse().find((x) => x[k] != null); return r ? { v: r[k] as number, m: r.month } : null }
          const lp = latest('lpcd'), ke = latest('kwh_per_person'), wa = latest('waste_kg_pp_day'), pk = latest('peak_vs_contract_pct')
          const when = (x: { m: string } | null) => (x && x.m !== last?.month ? ` (${x.m})` : '')
          return (
            <Panel key={a} className="p-4">
              <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-white">{areaName(a)}</span><span className="text-[10.5px] text-dim">{last?.month}</span></div>
              <dl className="mt-3 space-y-1.5 text-[12px]">
                <Row k="Energy Performance Index" v={b.epi_kwh_m2_year != null ? fmt(b.epi_kwh_m2_year, 'kWh/m²/yr') : 'Needs floor area'} t={b.references.epi.value != null ? `target ${fmt(b.references.epi.value)}` : ''} bad={b.epi_kwh_m2_year != null && b.references.epi.value != null && b.epi_kwh_m2_year > b.references.epi.value} />
                <Row k={`Water per person per day${when(lp)}`} v={fmt(lp?.v ?? null, 'L')} t={`norm ${fmt(b.references.lpcd.value)} L`} bad={(lp?.v ?? 0) > (b.references.lpcd.value ?? Infinity)} />
                <Row k={`Electricity per person${when(ke)}`} v={fmt(ke?.v ?? null, 'kWh/mo')} t="" />
                <Row k={`Waste per person per day${when(wa)}`} v={fmt(wa?.v ?? null, 'kg')} t={b.references.waste.value != null ? `target ${fmt(b.references.waste.value)}` : ''} bad={b.references.waste.value != null && (wa?.v ?? 0) > b.references.waste.value} />
                <Row k={`Peak vs contract demand${when(pk)}`} v={pk ? `${pk.v.toFixed(0)}%` : b.profile.contract_demand_kw ? 'No peak readings' : 'Needs contract demand'} t="" bad={(pk?.v ?? 0) > 100} />
              </dl>
              <p className="mt-2 text-[10.5px] text-dim">Population {fmt(b.profile.population)} ({b.profile.population_source}) · evidence: {last?.evidence}</p>
            </Panel>
          )
        })}
      </div>
      <Panel>
        <SectionTitle title={`${m.label} · site comparison`} sub={`${m.unit} · last 24 months · reference line = ${m.ref === 'contract' ? 'contract demand (100%)' : m.ref ? 'norm/target' : 'none'}`} right={<div className="w-72"><Select label="Measure" value={measure} options={MEASURES.map((x) => x.key)} onChange={setMeasure} format={(k) => MEASURES.find((x) => x.key === k)!.label} /></div>} />
        <div className="p-4" style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 300 }}>
            <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="rgba(232,227,250,.08)" vertical={false} />
              <XAxis dataKey="m" tick={{ fill: '#b8b2d2', fontSize: 11 }} minTickGap={24} />
              <YAxis tick={{ fill: '#b8b2d2', fontSize: 11 }} width={56} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip contentStyle={{ background: '#1d3159', border: '1px solid #3b3677', borderRadius: 10, fontSize: 12 }} formatter={(v, k) => [fmt(Number(v), m.unit), areaName(String(k) as AreaId)]} />
              {refValue != null && <ReferenceLine y={refValue} stroke="#e6c477" strokeDasharray="5 4" label={{ value: m.ref === 'contract' ? 'Contract demand' : 'Norm / target', fill: '#e6c477', fontSize: 10, position: 'insideTopRight' }} />}
              {areas.map((a) => <Line key={a} dataKey={a} stroke={AREA_COLOR[a]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="px-5 pb-4 text-[11px] text-dim">Per-person and per-m² figures use the site profile. Values built on demonstration data are for illustration only. The 135 LPCD figure is the CPHEEO norm for cities with sewerage; campuses and hospitals may set their own target.</p>
      </Panel>

      <div className="mt-6">
        <PageHeader eyebrow="Explainable intelligence" title="Sustainability & Risk Insights" desc="Transparent scorecard, waste and maintenance risk proxies, and same-period cross-metric anomaly events. Estimates are labelled and traceable to available monthly data." accent="#43d6a0" />
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-med/30 bg-med/5 p-3 text-[11.5px] leading-relaxed text-soft"><Info size={15} className="mt-0.5 shrink-0 text-med" /><span>These are rules-based prototype estimates, not calibrated probabilities. The waste indicator uses monthly waste totals (not bin fill sensors); maintenance risk uses available proxy metrics and open complaints. Historical/modelled inputs are not presented as live sensor readings.</span></div>
        <Panel className="mb-5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="text-sm font-semibold text-white">Simulated IoT → Detection → Forecast → Action</div><p className="mt-1 text-[11px] text-dim">Repeatable local demonstration. All readings below are synthetic, not live facility data.</p></div>
            <div className="flex flex-wrap gap-2">{(['normal','leak','energy_spike','compound'] as const).map((sc) => <button key={sc} disabled={demoLoading} onClick={() => runDemo(sc)} className="rounded-lg border border-line px-3 py-2 text-[11px] text-soft hover:border-lav disabled:opacity-50">{sc === 'normal' ? 'Normal' : sc === 'leak' ? 'Inject water leak' : sc === 'energy_spike' ? 'Inject energy spike' : 'Inject compound event'}</button>)}</div>
          </div>
          {demoError && <p className="mt-3 text-xs text-crit">{demoError}</p>}
          {demoLoading && <p className="mt-3 text-xs text-mute">Generating deterministic scenario…</p>}
          {demo && <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-med/30 bg-med/5 p-3 text-[11px] text-soft">{demo.data_label} · Scenario: <b>{demo.scenario}</b> · 24-hour forecast status: <b>{demo.forecast.status}</b></div>
            <div className="grid gap-3 md:grid-cols-3">{(['energy_kwh','water_l','waste_kg'] as const).map((metric) => { const last = demo.readings.at(-1); return <div key={metric} className="rounded-lg border border-line p-3"><div className="text-[10px] uppercase text-mute">{metric.replaceAll('_',' ')}</div><div className="num mt-1 text-xl text-white">{last?.[metric] ?? '—'} <span className="text-xs text-mute">{metric==='energy_kwh'?'kWh':metric==='water_l'?'L':'kg'}</span></div><div className="text-[10px] text-dim">Latest simulated hour</div></div>})}</div>
            <div><div className="text-xs font-semibold text-white">Detected events ({demo.events.length})</div>{demo.events.length ? demo.events.slice(-5).map((ev,i)=><div key={`${ev.timestamp}-${i}`} className="mt-2 rounded-lg border border-line p-3"><div className="flex gap-2 text-[11px]"><b className={ev.severity==='HIGH'?'text-crit':'text-med'}>{ev.severity}</b><span className="text-mute">{new Date(ev.timestamp).toLocaleString()}</span><span className="text-soft">{ev.metrics.map(m=>m.metric.replaceAll('_',' ')).join(' + ')}</span></div><p className="mt-1 text-[11px] text-dim">{ev.explanation}</p></div>) : <p className="mt-2 text-[11px] text-mute">No threshold event in the current normal scenario.</p>}</div>
            {demo.forecast.forecast && <div><div className="text-xs font-semibold text-white">Next 24 hours · {demo.forecast.method}</div><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{demo.forecast.forecast.slice(0,4).map((f,i)=><div key={String(f.timestamp)} className="rounded-lg border border-line p-2 text-[10px] text-mute">{new Date(String(f.timestamp)).toLocaleString()}<div className="mt-1 text-white">{f.energy_kwh} kWh</div><div>{f.water_l} L · {f.waste_kg} kg</div></div>)}</div><div className="mt-2 text-[10px] text-dim">Backtest MAE: {Object.entries(demo.forecast.backtest || {}).map(([k,v])=>`${k.replaceAll('_',' ')} ${v.mae ?? 'N/A'} ${v.unit}`).join(' · ')}. Showing 4 of 24 hourly points. {demo.forecast.limitations}</div></div>}
            <div><div className="text-xs font-semibold text-white">Evidence-led recommendations</div>{demo.recommendations.map((r,i)=><div key={`${r.title}-${i}`} className="mt-2 rounded-lg border border-line p-3"><div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">{r.title}<span className="rounded bg-med/10 px-2 py-1 text-[10px] text-med">{r.priority}</span></div><p className="mt-1 text-[11px] text-soft">{r.action}</p><p className="mt-1 text-[10px] text-dim"><b>Assumptions:</b> {r.assumptions.join(' ')}</p><p className="mt-1 text-[10px] text-dim"><b>Expected benefit:</b> {r.expected_benefit}</p><p className="mt-1 text-[10px] text-dim"><b>Confidence:</b> {r.confidence} <b>Verification:</b> {r.verification}</p></div>)}</div>
            <ul className="list-disc pl-4 text-[10px] text-dim">{demo.method_notes.map((n)=> <li key={n}>{n}</li>)}</ul>
          </div>}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          {areas.map((a) => {
            const item = critical[a]
            if (!item) return <Panel key={a} className="p-4"><div className="text-sm font-semibold text-white">{areaName(a)}</div><p className="mt-2 text-xs text-mute">Insights are loading or unavailable. Check the backend API and your page permissions.</p></Panel>
            const score = item.scorecard.score
            return <Panel key={a} className="min-w-0 p-4">
              <div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-white">{item.area_name}</div><span className="text-[10px] text-dim">Data through {item.data_period ?? '—'}</span></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                <div className="rounded-xl border border-line/70 bg-panel/70 p-3 text-center">
                  <ShieldCheck size={19} className="mx-auto text-mint" />
                  <div className="mt-2 text-[10px] uppercase tracking-wider text-mute">Sustainability score</div>
                  <div className="num mt-1 text-3xl font-semibold text-white">{score == null ? '—' : score.toFixed(1)}<span className="text-sm text-mute">/100</span></div>
                  <div className="mt-1 text-[10.5px] text-mute">{item.scorecard.band}</div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-mint" style={{ width: `${score ?? 0}%` }} /></div>
                  <div className="mt-2 text-[10px] text-dim">Data coverage {item.scorecard.coverage_pct}%</div>
                </div>
                <div className="space-y-2">
                  {item.scorecard.components.map((c) => <div key={c.key} className="rounded-lg border border-line/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2"><span className="text-[11.5px] text-soft">{c.label}</span><span className={`num text-xs font-semibold ${c.score == null ? 'text-dim' : c.score >= 80 ? 'text-mint' : c.score >= 60 ? 'text-med' : 'text-crit'}`}>{c.score == null ? 'N/A' : `${c.score}/100`}</span></div>
                    <div className="mt-1 text-[10px] text-dim">Current: {c.current == null ? '—' : `${c.current.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`} · {c.basis}</div>
                  </div>)}
                </div>
              </div>
              <details className="mt-3 text-[10.5px] text-dim"><summary className="cursor-pointer text-mute">Scoring method</summary><p className="mt-2 leading-relaxed">{item.scorecard.method}</p></details>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <RiskCard title="Waste-overflow risk" icon={<Trash2 size={15} />} risk={item.waste_overflow} />
                <RiskCard title="Equipment maintenance" icon={<Wrench size={15} />} risk={item.maintenance_risk} />
              </div>
              <div className="mt-4 rounded-lg border border-line/70 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white"><GitMerge size={15} className="text-lav" />Cross-metric anomaly events</div>
                {item.cross_metric_events.length ? item.cross_metric_events.map((ev, i) => <div key={`${ev.period}-${i}`} className="mt-2 border-t border-line/60 pt-2">
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md px-2 py-0.5 text-[10px] ${ev.level === 'High' ? 'bg-crit/15 text-crit' : 'bg-med/15 text-med'}`}>{ev.level}</span><span className="text-[11px] text-soft">{ev.period} · {ev.metric_count} metrics</span></div>
                  <div className="mt-1 flex flex-wrap gap-1.5">{ev.metrics.map((metric) => <span key={metric.metric} className="rounded-md border border-line px-2 py-1 text-[10px] text-mute">{metric.metric.replaceAll('_', ' ')} · {metric.status}</span>)}</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-dim">{ev.explanation}</p>
                </div>) : <p className="mt-2 text-[11px] text-mute">No same-area, same-month compound event detected among energy, water and waste review flags. This does not mean there are no facility risks.</p>}
              </div>
            </Panel>
          })}
        </div>
      </div>
    </>
  )
}

function RiskCard({ title, icon, risk }: { title: string; icon: ReactNode; risk: RiskResult }) {
  const score = risk.risk_score
  const tone = score == null ? 'text-dim' : score >= 70 ? 'text-crit' : score >= 40 ? 'text-med' : 'text-mint'
  return <div className="rounded-lg border border-line/70 p-3">
    <div className="flex items-center gap-2 text-[11.5px] font-semibold text-soft">{icon}{title}</div>
    <div className={`num mt-2 text-2xl font-semibold ${tone}`}>{score == null ? '—' : score}<span className="ml-1 text-xs text-dim">/100</span></div>
    <div className="text-[10.5px] text-mute">{risk.level}</div>
    {risk.projected_next_period_kg != null && <div className="mt-1 text-[10.5px] text-soft">Next-month estimate: {risk.projected_next_period_kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</div>}
    <ul className="mt-2 list-disc space-y-1 pl-4 text-[10.5px] leading-relaxed text-dim">{risk.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <details className="mt-2 text-[10px] text-dim"><summary className="cursor-pointer text-mute">Method & limitations</summary><p className="mt-1">{risk.basis} {risk.limitations}</p></details>
  </div>
}

const Row = ({ k, v, t, bad }: { k: string; v: string; t: string; bad?: boolean }) => (
  <div className="flex items-baseline justify-between gap-2"><dt className="text-mute">{k}</dt><dd className={`num font-semibold ${bad ? 'text-crit' : 'text-white'}`}>{v}{t && <span className="ml-1.5 text-[10.5px] font-normal text-dim">{t}</span>}</dd></div>
)
