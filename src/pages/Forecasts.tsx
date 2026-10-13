import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { CLASS_LABELS, DOMAINS, METRICS, areaName, areasOf, backtestRows, downloadCsv, findings, fmt, forecast, history, series, uploadedBeyondExport, type AreaId } from '../eiq'
import { ClassBadge, MonthlyChart, Range, ScreenBadge, SectionTitle, Select, areaLines } from '../eui'
import { PageHeader, Panel } from '../ui'
import type { PageProps } from '../App'

const RESULTS = ['All', 'High deviation', 'Watch', 'Within typical variation', 'Missing latest observation', 'Insufficient history']

export default function Forecasts({ sel, years }: PageProps) {
  const [domain, setDomain] = useState(DOMAINS[0].name)
  const d = DOMAINS.find((x) => x.name === domain)!
  const [metric, setMetric] = useState(d.default)
  const key = d.metrics.includes(metric) ? metric : d.default
  const [h, setH] = useState(6)
  const [res, setRes] = useState('All')
  const m = METRICS[key]
  const explanations = findings(sel, years).filter((x) => x.metric_key === key)
  const rows = findings(sel, years).filter((x) => res === 'All' || x['Screening result'] === res)
  return (
    <>
      <PageHeader eyebrow="Baseline projection" title="Forecasts & Anomalies" desc={'Transparent monthly projections and statistical review explanations. Forecasts use complete history, independent of the reporting-year filter.'} accent={'#a99bff'} />
      <Panel className="p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr_1.2fr]">
          <Select label="Forecast domain" value={domain} options={DOMAINS.map((x) => x.name)} onChange={(v) => { setDomain(v); setMetric(DOMAINS.find((x) => x.name === v)!.default) }} />
          <Select label="Forecast indicator" value={key} options={d.metrics} onChange={setMetric} format={(k) => METRICS[k].name} />
          <Range label="Projection horizon (months)" value={h} min={3} max={12} onChange={setH} />
        </div>
        <p className="mt-3 text-[11.5px] text-dim">No trained machine learning. Dated water-quality samples are not treated as continuous monthly series. Missing/censored series are not interpolated.</p>
      </Panel>

      {areasOf(sel).map((a) => <AreaForecast key={a} area={a} metricKey={key} h={h} />)}

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Selected-period anomaly explanations" sub={`${m.name} · ${areaName(sel)} · ${years.join(', ') || 'no years selected'}`} right={explanations.length ? <button className="eiq-btn" onClick={() => downloadCsv(`${key}_anomaly_explanations.csv`, explanations as unknown as Record<string, unknown>[])}>Export CSV</button> : undefined} />
        {explanations.length ? (
          <div className="overflow-x-auto">
            <table className="eiq-table">
              <thead><tr><th>Area</th><th>Period</th><th>Value</th><th>Expected</th><th>Robust dev.</th><th>Review range</th><th>Result</th><th>Evidence</th><th>Explanation</th></tr></thead>
              <tbody>{explanations.map((x, i) => (
                <tr key={i}><td className="text-white">{x.Area}</td><td className="num">{x['Measurement period']}</td><td className="num">{fmt(x.Value, x.Unit)}</td><td className="num">{fmt(x['Expected reference'])}</td>
                  <td className="num">{x['Robust deviation'] == null ? '—' : x['Robust deviation'].toFixed(2)}</td>
                  <td className="num">{(x as unknown as Record<string, number | null>)['Lower review threshold'] != null ? `${fmt((x as unknown as Record<string, number>)['Lower review threshold'])} – ${fmt((x as unknown as Record<string, number>)['Upper review threshold'])}` : '—'}</td>
                  <td><ScreenBadge s={x['Screening result']} /></td><td><ClassBadge cls={x.Classification} /></td><td className="min-w-80 text-[11px] leading-snug text-soft">{x.Reason}<span className="mt-1 block text-dim">{x.Limitation}</span></td></tr>
              ))}</tbody>
            </table>
            <p className="px-5 py-3 text-[11px] text-dim">Watch/high deviation are statistical review policies. Missing and censored readings remain coverage warnings; demonstration findings are demonstration results.</p>
          </div>
        ) : <p className="p-5 text-sm text-mute">No selected historical period to screen. Forecasts above still use complete history.</p>}
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Historical screening · all indicators" sub={`${areaName(sel)} · ${rows.length} fields · robust deviation from each series' history`} right={<div className="flex items-end gap-2"><div className="w-56"><Select label="Result" value={res} options={RESULTS} onChange={setRes} /></div><button className="eiq-btn" onClick={() => downloadCsv('screening.csv', rows as unknown as Record<string, unknown>[])}>Export CSV</button></div>} />
        <div className="max-h-[520px] overflow-auto">
          <table className="eiq-table">
            <thead><tr><th>Area</th><th>Domain</th><th>Metric</th><th>Period</th><th>Value</th><th>Expected</th><th>Result</th><th>Evidence</th><th>Limitation</th></tr></thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i} data-indi={x['Screening result'] === 'High deviation' ? 'anomaly' : undefined} data-indi-label={`${x.Area} ${x.Metric}`} data-indi-value={fmt(x.Value, x.Unit)}>
                  <td>{x.Area}</td><td>{x.Domain}</td><td className="text-white">{x.Metric}</td><td className="num">{x['Measurement period']}</td><td className="num">{fmt(x.Value, x.Unit)}</td><td className="num">{fmt(x['Expected reference'])}</td><td><ScreenBadge s={x['Screening result']} /></td><td><ClassBadge cls={x.Classification} /></td><td className="max-w-72 text-[11px] text-dim">{x.Limitation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

/** One area's baseline forecast, like the MVP's per-area block. */
function AreaForecast({ area, metricKey: key, h }: { area: AreaId; metricKey: string; h: number }) {
  const [open, setOpen] = useState(false)
  const m = METRICS[key]
  const f = forecast(area, key, h)
  const ser = series(area, key)
  const last = ser.points.at(-1)
  const table = (f.points ?? []).map(([month, v, lo, hi]) => ({ Month: month, 'Baseline projection': v, 'Empirical range lower': lo ?? '', 'Empirical range upper': hi ?? '' }))
  const sel = f.scores?.find((s) => s.Selected)
  return (
    <Panel className="sapphire-surface mt-4">
      <SectionTitle title={areaName(area)} sub={`${last ? CLASS_LABELS[last[2]] : ''} · ${ser.scope} · history through ${last?.[0] ?? '—'}`} />
      <div className="space-y-2 px-5 pt-4 text-[12.5px]">
        {f.available ? (
          <>
            <p className="text-soft"><span className="font-semibold text-white">Selected forecast model:</span> {f.method}</p>
            <p className="text-[11.5px] text-mute">Chronological selection MAE: {fmt(f.mae ?? null, m.unit, false)}{sel ? ` · ${sel['Validation predictions']} validation predictions` : ''} · selection targets end {f.selection_end}</p>
            <p className="text-[11px] leading-relaxed text-dim">{f.limitations}</p>
          </>
        ) : <p className="rounded-lg border border-med/40 bg-med/10 px-3 py-2 text-xs text-med">Forecast unavailable: {f.reason}</p>}
        {uploadedBeyondExport(area, key) > 0 && <p className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-[11.5px] text-soft">{uploadedBeyondExport(area, key)} uploaded measured month(s) are newer than this forecast. They are shown in the chart and were screened on upload (see alerts); re-run the MVP export to refresh the forecast.</p>}
      </div>
      <div className="p-4">
        <MonthlyChart lines={areaLines([area], key, (a) => history(a, key))} unit={m.unit} height={300} forecast={f.available ? { color: '#a99bff', points: f.points! } : undefined} indiLabel={`${m.name} · ${areaName(area)}`} />
      </div>
      <div className="flex flex-wrap gap-2 px-5 pb-4">
        {f.available && <button className="eiq-btn" onClick={() => downloadCsv(`${area}_${key}_baseline_forecast.csv`, table)}>Download baseline forecast · {areaName(area)}</button>}
        {f.available && <button className="eiq-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'} backtesting details</button>}
        {ser.source.startsWith('http') && <a className="eiq-btn" href={ser.source} target="_blank" rel="noreferrer">Baseline source · {areaName(area)} <ExternalLink size={12} /></a>}
      </div>
      {open && f.available && (
        <div className="space-y-3 border-t border-line/60 p-5">
          <h4 className="text-[13px] font-semibold text-white">Candidate models (chronological backtest)</h4>
          <div className="overflow-x-auto rounded-lg border border-line/60">
            <table className="eiq-table">
              <thead><tr><th>Model</th><th>Chronological MAE</th><th>Validation predictions</th><th>Evaluated leads</th><th>Selected</th></tr></thead>
              <tbody>{(f.scores ?? []).map((s) => <tr key={s.Model} className={s.Selected ? 'bg-sapphire/10' : ''}><td className="text-white">{s.Model}</td><td className="num">{fmt(s['Chronological MAE'], m.unit, false)}</td><td className="num">{s['Validation predictions']}</td><td className="num">{s['Evaluated leads']}</td><td>{s.Selected ? '✓ selected' : ''}</td></tr>)}</tbody>
            </table>
          </div>
          <h4 className="text-[13px] font-semibold text-white">Forecast values</h4>
          <div className="overflow-x-auto rounded-lg border border-line/60">
            <table className="eiq-table">
              <thead><tr><th>Month</th><th>Baseline projection</th><th>Empirical range lower</th><th>Empirical range upper</th></tr></thead>
              <tbody>{table.map((r) => <tr key={r.Month}><td className="num">{r.Month}</td><td className="num text-white">{fmt(r['Baseline projection'], m.unit)}</td><td className="num">{r['Empirical range lower'] === '' ? '—' : fmt(r['Empirical range lower'] as number)}</td><td className="num">{r['Empirical range upper'] === '' ? '—' : fmt(r['Empirical range upper'] as number)}</td></tr>)}</tbody>
            </table>
          </div>
          <button className="eiq-btn" onClick={async () => downloadCsv(`${area}_${key}_backtest.csv`, await backtestRows(area, key))}>Download validation predictions (12-month evaluation)</button>
          <p className="text-[11px] text-dim">Candidate validation uses only earlier training data. Later rolling origins calibrate the selected method; they do not select it.</p>
        </div>
      )}
    </Panel>
  )
}
