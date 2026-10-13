import { useEffect, useState, useSyncExternalStore } from 'react'
import { AREAS, CLASS_LABELS, DOMAINS, E, METRICS, SCENARIO_DEFAULT, areaName, areasOf, backtestRows, downloadCsv, fmt, forecast, history, projectScenario, scenarioFindings, scenarioStore, series, waterEquivalents, type AreaId, type Selection } from '../eiq'
import { MonthlyChart, Range, ScreenBadge, SectionTitle, Select, areaLines } from '../eui'
import { PageHeader, Panel } from '../ui'
import type { PageProps } from '../App'

export default function Scenario({ sel }: PageProps) {
  const [scope, setScope] = useState<Selection>(sel)
  useEffect(() => setScope(sel), [sel]) // follow the global Area selector, like the MVP
  const [domain, setDomain] = useState('Energy')
  const d = DOMAINS.find((x) => x.name === domain)!
  const [metric, setMetric] = useState(d.default)
  const key = d.metrics.includes(metric) ? metric : d.metrics[0]
  useSyncExternalStore(scenarioStore.subscribe, scenarioStore.all)
  const single = scope !== 'all'
  const st = single ? scenarioStore.get(scope as AreaId, key) : { ...SCENARIO_DEFAULT }
  const set = (patch: Partial<typeof st>) => single && scenarioStore.set(scope as AreaId, key, { ...st, ...patch, affected: Math.min(patch.affected ?? st.affected, 12) })

  return (
    <>
      <PageHeader eyebrow="Hypothetical modelling" title="Scenario Lab" desc={'Backtested baseline projections and isolated modelled scenarios. Historical records are read-only; no trained machine learning is claimed.'} accent={'#f5b84b'} />
      <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <Panel className="ai-surface relative space-y-4 self-start p-5">
          <Select label="Area" value={scope} options={['all', ...AREAS.map((a) => a.id)] as Selection[]} onChange={setScope} format={areaName} />
          <Select label="Injection domain" value={domain} options={DOMAINS.map((x) => x.name)} onChange={(v) => { setDomain(v); setMetric(DOMAINS.find((x) => x.name === v)!.metrics[0]) }} />
          <Select label="Parameter" value={key} options={d.metrics} onChange={setMetric} format={(k) => METRICS[k].name} />
          {single ? (
            <>
              <Range label="Live injected change" value={st.change} min={-80} max={200} step={5} suffix="%" onChange={(v) => set({ change: v })} />
              <Range label="Shock carryover each month" value={Math.round(st.carryover * 100)} min={0} max={100} step={5} suffix="%" onChange={(v) => set({ carryover: v / 100 })} />
              <Range label="Forecast horizon (months)" value={st.horizon} min={3} max={12} onChange={(v) => set({ horizon: v })} />
              <Range label="Affected forecast months" value={st.affected} min={1} max={12} onChange={(v) => set({ affected: v })} />
              <button className="eiq-btn w-full" onClick={() => set({ change: 0 })}>↺ Reset injection</button>
              <p className="text-[11px] leading-snug text-dim">Each area/metric keeps its own magnitude, carryover, horizon and affected duration for this session. Saved non-zero scenarios also appear in Recommendations.</p>
            </>
          ) : <p className="rounded-lg border border-sapphire-soft/30 bg-sapphire/10 px-3 py-2.5 text-[12px] leading-relaxed text-soft">All Areas compares separate baseline forecasts. Choose an individual area to edit its metric-specific scenario; saved injections do not alter these baseline comparisons.</p>}
        </Panel>
        <div className="min-w-0 space-y-4">
          {areasOf(scope).map((a) => <AreaScenario key={a} area={a} metricKey={key} single={single} s={single ? st : { ...SCENARIO_DEFAULT }} />)}
        </div>
      </div>
    </>
  )
}

function AreaScenario({ area, metricKey: key, single, s }: { area: AreaId; metricKey: string; single: boolean; s: { change: number; carryover: number; horizon: number; affected: number } }) {
  const [evalOpen, setEvalOpen] = useState(false)
  const m = METRICS[key]
  const f = forecast(area, key, s.horizon)
  const hist = history(area, key)
  const ser = series(area, key)
  const lastCls = ser.points.at(-1)?.[2]
  const latest = hist.filter((p) => p[1] != null).at(-1)
  if (!f.available || !latest) {
    return (
      <Panel>
        <SectionTitle title={`${m.name} · ${areaName(area)}`} sub={`${lastCls ? CLASS_LABELS[lastCls] : ''} · ${ser.scope}`} />
        <p className="mx-5 mt-4 rounded-lg border border-med/40 bg-med/10 px-3 py-2 text-xs text-med">Forecast unavailable: {f.reason ?? 'no exact latest value'}</p>
        <div className="p-4"><MonthlyChart lines={areaLines([area], key, () => hist)} unit={m.unit} height={260} indiLabel={m.name} /></div>
      </Panel>
    )
  }
  const sc = projectScenario(f.points!.map((p) => p[1]), latest[1]!, s.change, s.carryover, s.affected, m.lower, m.upper)
  const table = f.points!.map(([month, v, lo, hi], i) => ({ area_id: area, 'Forecast month': month, Model: f.method, 'Baseline projection': v, 'Empirical range lower': lo ?? '', 'Empirical range upper': hi ?? '', 'Scenario projection': sc.projected[i], 'Scenario difference': sc.projected[i] - v }))
  const flags = single && s.change ? scenarioFindings(area, key, f, sc.projected, s.change, s.carryover, s.affected) : []
  const sel = f.scores?.find((x) => x.Selected)
  return (
    <Panel>
      <SectionTitle title={`${m.name} · ${areaName(area)}`} sub={`${lastCls ? CLASS_LABELS[lastCls] : ''} · ${ser.scope}`} />
      <div className="space-y-1 px-5 pt-4 text-[12.5px]">
        <p className="text-soft"><span className="font-semibold text-white">Selected forecast model:</span> {f.method}</p>
        <p className="text-[11.5px] text-mute">Chronological selection MAE: {fmt(f.mae ?? null, m.unit, false)}{sel ? `; ${sel['Validation predictions']} validation predictions` : ''}; selection targets end {f.selection_end}.</p>
        <p className="text-[11px] leading-relaxed text-dim">{f.limitations}</p>
      </div>
      {single && (
        <div className="grid grid-cols-3 gap-3 px-5 pt-4">
          <Stat k="Latest recorded baseline" v={fmt(latest[1], m.unit)} d={latest[0]} />
          <Stat k="Injected scenario reading" v={fmt(sc.injected, m.unit)} d={`${s.change > 0 ? '+' : ''}${s.change}% requested · simulated`} />
          <Stat k="Forecast month 1 · scenario" v={fmt(sc.projected[0], m.unit)} d={f.points![0][0]} />
        </div>
      )}
      <div className="p-4"><MonthlyChart lines={areaLines([area], key, () => hist)} unit={m.unit} height={320} forecast={{ color: '#a99bff', points: f.points! }} scenario={single ? f.points!.map((p, i) => [p[0], sc.projected[i]]) : undefined} indiLabel={m.name} /></div>
      <p className="px-5 text-[11px] text-dim">Grey/coloured: history · violet dashed: baseline · shaded: empirical error range{single ? ' · amber: hypothetical scenario' : ''}. Values are clipped to the indicator's physical bounds{m.lower != null || m.upper != null ? ` (${m.lower ?? '−∞'} to ${m.upper ?? '∞'})` : ''}.</p>
      <div className="m-5 max-h-80 overflow-auto rounded-lg border border-line/60">
        <table className="eiq-table">
          <thead><tr><th>Forecast month</th><th>Model</th><th>Baseline</th><th>Range lower</th><th>Range upper</th><th>Scenario</th><th>Difference</th></tr></thead>
          <tbody>{table.map((r) => <tr key={r['Forecast month']}><td className="num">{r['Forecast month']}</td><td className="text-[11px]">{r.Model}</td><td className="num">{fmt(r['Baseline projection'])}</td><td className="num">{r['Empirical range lower'] === '' ? '—' : fmt(r['Empirical range lower'] as number)}</td><td className="num">{r['Empirical range upper'] === '' ? '—' : fmt(r['Empirical range upper'] as number)}</td><td className="num text-white">{fmt(r['Scenario projection'])}</td><td className="num">{fmt(r['Scenario difference'])}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 px-5 pb-4">
        <button className="eiq-btn" onClick={() => downloadCsv(`${area}_scenario_projection.csv`, table)}>Download scenario comparison · {areaName(area)}</button>
        <button className="eiq-btn" onClick={() => setEvalOpen(!evalOpen)} aria-expanded={evalOpen}>{evalOpen ? 'Hide' : 'Show'} chronological model evaluation</button>
      </div>
      {evalOpen && (
        <div className="space-y-2 border-t border-line/60 p-5">
          <div className="overflow-x-auto rounded-lg border border-line/60">
            <table className="eiq-table">
              <thead><tr><th>Model</th><th>Chronological MAE</th><th>Validation predictions</th><th>Evaluated leads</th><th>Selected</th></tr></thead>
              <tbody>{(f.scores ?? []).map((x) => <tr key={x.Model} className={x.Selected ? 'bg-sapphire/10' : ''}><td className="text-white">{x.Model}</td><td className="num">{fmt(x['Chronological MAE'], m.unit, false)}</td><td className="num">{x['Validation predictions']}</td><td className="num">{x['Evaluated leads']}</td><td>{x.Selected ? '✓ selected' : ''}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-[11px] text-dim">Candidate validation uses only earlier training data. Later rolling origins calibrate the selected method; they do not select it.</p>
          <button className="eiq-btn" onClick={async () => downloadCsv(`${area}_${key}_backtest.csv`, await backtestRows(area, key))}>Download validation predictions · {areaName(area)}</button>
        </div>
      )}
      {single && s.change !== 0 && (
        <div className="space-y-3 border-t border-line/60 p-5">
          <h4 className="text-[13px] font-semibold text-white">Hypothetical scenario screening</h4>
          {flags.length ? (
            <div className="max-h-80 overflow-auto rounded-lg border border-line/60">
              <table className="eiq-table">
                <thead><tr><th>Month</th><th>Baseline</th><th>Scenario</th><th>Difference</th><th>Result</th><th>Reason</th></tr></thead>
                <tbody>{flags.map((x) => <tr key={x['Measurement period']}><td className="num">{x['Measurement period']}</td><td className="num">{fmt(x.Baseline)}</td><td className="num text-white">{fmt(x['Scenario value'])}</td><td className="num">{fmt(x.Difference)}</td><td><ScreenBadge s={x['Screening result']} /></td><td className="min-w-72 text-[11px] leading-snug text-dim">{x.Reason}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="rounded-lg border border-line px-3 py-3 text-xs text-mute">No projected difference after clipping, carryover and affected-duration assumptions.</p>}
          {key === 'water_consumption_l' ? (
            <>
              <div className="overflow-x-auto rounded-lg border border-line/60">
                <table className="eiq-table">
                  <thead><tr><th>Forecast month</th><th>Baseline volume kL</th><th>Scenario volume kL</th><th>Volume difference kL</th><th>Equivalent scenario LPCD</th></tr></thead>
                  <tbody>{waterEquivalents(f, sc.projected, E.water_population[area]).map((r) => <tr key={r['Forecast month']}><td className="num">{r['Forecast month']}</td><td className="num">{fmt(r['Baseline volume kL'])}</td><td className="num">{fmt(r['Scenario volume kL'])}</td><td className="num">{fmt(r['Volume difference kL'])}</td><td className="num">{fmt(r['Equivalent scenario LPCD'])}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="text-[11px] text-dim">Downstream accounting only: litres ÷ 1,000 gives kL; litres ÷ hypothetical users ÷ calendar days gives equivalent LPCD. No leakage, water-quality or causal effect is inferred.</p>
            </>
          ) : <p className="text-[11px] text-dim">No downstream causal effects are calculated: verified conversion factors or causal relationships are unavailable for this metric.</p>}
        </div>
      )}
    </Panel>
  )
}

const Stat = ({ k, v, d }: { k: string; v: string; d: string }) => (
  <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className="num mt-1 text-lg font-semibold text-white">{v}</div><div className="text-[10.5px] text-dim">{d}</div></div>
)
