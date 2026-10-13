import { useState } from 'react'
import { DOMAINS, DOMAIN_ACCENT, METRICS, areasOf, comparison, downloadCsv, findings, fmt, history, provenanceRows, series } from '../eiq'
import WaterQuality from '../WaterQuality'
import { ClassBadge, MonthlyChart, ScreenBadge, SectionTitle, Select, areaLines } from '../eui'
import { PageHeader, Panel, hueStyle } from '../ui'
import type { PageProps } from '../App'

export default function Domain({ sel, years, domain, setDomain, metric, setMetric }: PageProps) {
  const d = DOMAINS.find((x) => x.name === domain) ?? DOMAINS[0]
  const key = metric && d.metrics.includes(metric) ? metric : d.default
  const m = METRICS[key]
  const areas = areasOf(sel)
  const comp = comparison(sel, key, years)
  const flags = findings(sel, years).filter((f) => f.Domain === d.name)
  const accent = DOMAIN_ACCENT[d.name]
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const single = areas.length === 1
  const vals = single ? history(areas[0], key, years).map((p) => p[1]).filter((v): v is number => v != null) : []
  const ledger = ledgerOpen ? areas.flatMap((a) => provenanceRows(a, years, [key])) : []
  const NOTES: Record<string, { tone: 'info' | 'warn' | 'muted'; text: string }> = {
    'Air Quality': { tone: 'info', text: 'Official PM10 and AQI remain separate from legacy PM10. SO₂ below detection limits is not zero. O₃ has a distinct averaging basis.' },
    Water: { tone: 'info', text: 'Consumption is the approved hypothetical demand model: 135 LPCD × 1,000 equivalent users × calendar days. Water quality is separate dated sampling evidence (below).' },
    Carbon: { tone: 'warn', text: 'Prototype CO₂e estimates have an unverified factor and boundary; these are not verified emissions or Scope 2 accounting.' },
    'Buildings & Assets': { tone: 'muted', text: 'The two asset utilisation spellings retain separate source definitions.' },
  }
  const note = NOTES[d.name]
  return (
    <>
      <PageHeader eyebrow="Eight domains" title="Domain Intelligence" desc={"Monthly history, provenance and screening per indicator."} accent={DOMAIN_ACCENT[d.name]} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Domain">
        {DOMAINS.map((x) => (
          <button key={x.name} role="tab" aria-selected={x.name === d.name} onClick={() => { setDomain(x.name); setMetric(null) }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${x.name === d.name ? 'border-transparent text-ink' : 'border-line text-mute hover:text-white'}`} style={x.name === d.name ? { background: DOMAIN_ACCENT[x.name] } : undefined}>{x.name}</button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="sapphire-surface">
          <SectionTitle title={m.name} sub={`${m.unit} · ${years.join(', ')} · ${areas.length > 1 ? 'one line per area' : comp[0].name}`} right={<div className="w-60"><Select label="Indicator" value={key} options={d.metrics} onChange={(v) => setMetric(v)} format={(k) => METRICS[k].name} /></div>} />
          {single && (
            <div className="grid grid-cols-3 gap-3 px-4 pt-4">
              <Stat k="Last selected reading" v={fmt(comp[0].value, m.unit)} />
              <Stat k="Selected-period average" v={vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, m.unit) : '—'} />
              <Stat k="Available-value range" v={vals.length ? `${fmt(Math.min(...vals))} – ${fmt(Math.max(...vals))}` : '—'} />
            </div>
          )}
          <div className="p-4"><MonthlyChart lines={areaLines(areas, key, (a) => history(a, key, years))} unit={m.unit} height={320} indiLabel={m.name} /></div>
        </Panel>
        <Panel className="hue-card" style={hueStyle(d.name)}>
          <SectionTitle title="Selected-period values" sub={comp[0].period} />
          <div className="space-y-4 p-5">
            {comp.map((r) => {
              const s = series(r.area, key)
              return (
                <div key={r.area} className="border-b border-line/50 pb-3 last:border-0">
                  <div className="flex items-center justify-between"><span className="text-xs text-mute">{r.name}</span><ClassBadge cls={r.cls} /></div>
                  <div className="num mt-1 text-xl font-semibold text-white" style={{ color: r.value == null ? undefined : accent }}>{fmt(r.value, m.unit)}</div>
                  <p className="mt-1 text-[11px] leading-snug text-dim">{s.scope}</p>
                  <p className="mt-0.5 text-[11px] text-dim">Status: {s.status}</p>
                  {s.source.startsWith('http') ? <a className="text-[11px] text-lav hover:text-white" href={s.source} target="_blank" rel="noreferrer">Source</a> : <p className="text-[11px] text-dim">Source: {s.source}</p>}
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      {note && <div className={`mt-4 rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed ${note.tone === 'warn' ? 'border-med/40 bg-med/10 text-[#f8d79a]' : note.tone === 'info' ? 'border-sapphire-soft/30 bg-sapphire/10 text-soft' : 'border-line text-mute'}`}>{note.text}</div>}

      <Panel className="mt-4 overflow-hidden">
        <button className="flex w-full items-center justify-between px-5 py-3.5 text-left" onClick={() => setLedgerOpen(!ledgerOpen)} aria-expanded={ledgerOpen}>
          <span><span className="block text-[15px] font-semibold text-white">Indicator source ledger</span><span className="text-[11.5px] text-mute">Every month's raw value, evidence class, measurement status and source for {m.name}</span></span>
          <span className="text-lg text-mute">{ledgerOpen ? '−' : '+'}</span>
        </button>
        {ledgerOpen && (
          <>
            <div className="max-h-96 overflow-auto border-t border-line/60">
              <table className="eiq-table">
                <thead><tr><th>Area</th><th>Month</th><th>Raw value</th><th>Unit</th><th>Evidence</th><th>Measurement status</th><th>Source</th><th>Geographic scope</th></tr></thead>
                <tbody>{ledger.map((r, i) => (
                  <tr key={i}><td>{r.area_name}</td><td className="num">{r.date}</td><td className="num text-white">{r.raw_value || '—'}</td><td>{r.unit}</td><td><ClassBadge cls={r.classification as never} /></td><td>{r.measurement_status}</td>
                    <td className="max-w-64 text-[11px]">{r.source_url ? <a className="text-lav hover:text-white" href={r.source_url} target="_blank" rel="noreferrer">Open source</a> : <span className="text-dim">{r.source_ref}</span>}</td><td className="min-w-56 text-[11px] text-dim">{r.geographic_scope}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="p-3"><button className="eiq-btn" onClick={() => downloadCsv(`${key}_source_ledger.csv`, ledger)}>Download ledger CSV</button></div>
          </>
        )}
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title={`${d.name} screening results`} sub="Latest selected month against each series' own history. Review prompts, not hazard findings." right={<button className="eiq-btn" onClick={() => downloadCsv(`${d.name}-screening.csv`, flags as unknown as Record<string, unknown>[])}>Export CSV</button>} />
        <div className="overflow-x-auto">
          <table className="eiq-table">
            <thead><tr><th>Area</th><th>Metric</th><th>Period</th><th>Value</th><th>Expected</th><th>Robust dev.</th><th>Result</th><th>Evidence</th></tr></thead>
            <tbody>
              {flags.map((f, i) => (
                <tr key={i}><td>{f.Area}</td><td className="text-white">{f.Metric}</td><td className="num">{f['Measurement period']}</td><td className="num">{fmt(f.Value, f.Unit)}</td><td className="num">{fmt(f['Expected reference'])}</td><td className="num">{f['Robust deviation'] == null ? '—' : f['Robust deviation'].toFixed(2)}</td><td><ScreenBadge s={f['Screening result']} /></td><td><ClassBadge cls={f.Classification} /></td></tr>
              ))}
              {!flags.length && <tr><td colSpan={8} className="py-6 text-center text-mute">No screening rows for this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {d.name === 'Water' && <WaterQuality sel={sel} />}
    </>
  )
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className="num mt-1 text-lg font-semibold text-white">{v}</div></div>
)
