import { useState } from 'react'
import { AREAS, CLASS_LABELS, E, METRICS, areaName, areasOf, downloadCsv, historicalRows, provenanceRows, type AreaId, type Classification } from '../eiq'
import { ClassBadge, SectionTitle } from '../eui'
import { PageHeader, Panel } from '../ui'

type Censored = { area_id: string; metric: string; months: string[] }

/** Minimal renderer for the exported coverage report (headings, paragraphs, pipe tables). */
function Report({ md }: { md: string }) {
  const blocks = md.trim().split(/\n\s*\n/)
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (b.startsWith('#')) return <h3 key={i} className="text-sm font-semibold text-white">{b.replace(/^#+\s*/, '')}</h3>
        if (lines[0].startsWith('|')) {
          const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim())
          const body = lines.slice(2)
          return (
            <div key={i} className="max-h-96 overflow-auto rounded-lg border border-line/60">
              <table className="eiq-table"><thead><tr>{cells(lines[0]).map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{body.map((l, j) => <tr key={j}>{cells(l).map((c, k) => <td key={k} className={k ? 'num' : ''}>{c}</td>)}</tr>)}</tbody></table>
            </div>
          )
        }
        return <p key={i} className="text-[12.5px] leading-relaxed text-mute">{b}</p>
      })}
    </div>
  )
}

type Missing = { monthly_gaps?: unknown[]; censored_air?: Censored[]; remaining_evidence_gaps?: Record<string, string[]>; coordinate_gaps?: { area_id: string; station: string }[]; quality_not_analysed?: string[]; distribution_coordinate_status?: string }

const NOTES: [string, string][] = [
  ['Canonical interface', 'Frozen Phase 1 monthly records, per-value provenance ledger, area registry and dated water sample ledger. All eight domains use the same global geographic scope. All Areas comparisons preserve individual series.'],
  ['Demonstration data', 'Operational/weather reference values and unverified legacy carbon/risk calculations are copied references, not measured locality totals.'],
  ['Modelled scenario', 'Approved hypothetical demand and live injections.'],
  ['Official observation', 'Dated, station-specific air/water evidence.'],
  ['Verified research', 'Supporting geographic/municipal context.'],
  ['Missing data', 'Retained as gaps, never fabricated.'],
  ['Water demand', '135 LPCD × 1,000 hypothetical users × actual calendar-month days, plus zero additional use. Original model inputs and Palasuni values remain unchanged. Numeric WQI is unavailable; chlorine “Safe” is a test-specific status, not a complete potability assessment.'],
  ['Intelligence', 'Chronological candidate comparisons select simple statistical forecasts. Later rolling origins provide descriptive error envelopes where sufficient; these are not guaranteed confidence intervals. Latest-period screening excludes its target. Percentage scenarios are isolated by area and metric and are not causal models. No trained machine learning or locality-wide environmental verdict is claimed.'],
  ['Unforecastable series', 'Palasuni SO₂/O₃, IRC SO₂ and Khandagiri SO₂ retain missing or censored history. No forecast is displayed for these series.'],
  ['Geography', 'Khandagiri marks groundwater point 1649, not air station 686. Air coordinates remain unverified. Palasuni and IRC mark historical air-site references with current survey unconfirmed.'],
  ['Carbon and assets', 'Prototype carbon factors/boundaries are unverified. Asset utilisation spellings and legacy/station PM10 definitions remain separate.'],
]

export default function Methodology({ sel = 'all', years = E.years }: Partial<import('../App').PageProps>) {
  const missing = E.missing as Missing
  const censored = missing.censored_air ?? []
  const [showRecords, setShowRecords] = useState(false)
  const records = showRecords ? historicalRows(sel, years) : []
  const cols = ['area', 'date', ...Object.keys(METRICS)]
  return (
    <>
      <PageHeader eyebrow="Provenance" title="Data & Methodology" desc={"Exported from the Nexora Bhubaneswar engine. Every value carries one evidence class, and missing or censored readings stay missing."} accent={'#7fb0c5'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle title="Evidence classes" />
          <ul className="space-y-3 p-5">
            {(Object.keys(CLASS_LABELS) as Classification[]).map((c) => <li key={c} className="flex items-start gap-3"><ClassBadge cls={c} /><span className="text-[12.5px] text-soft">{CLASS_LABELS[c]}</span></li>)}
          </ul>
        </Panel>
        <Panel>
          <SectionTitle title="Methods (summary)" />
          <ul className="list-disc space-y-2 p-5 pl-9 text-[12.5px] leading-relaxed text-mute">
            <li>Monthly rows, January 2023 – December 2025, for {AREAS.length} areas and {Object.keys(METRICS).length} indicators.</li>
            <li>Comparisons use the last selected calendar month per area; areas are never pooled.</li>
            <li>Screening: robust deviation (median/MAD) of the latest value against each series' own history; results are review prompts.</li>
            <li>Forecasts: the model is chosen by chronological MAE on earlier origins. Ranges are 10th–90th percentile empirical error envelopes, shown only when there are enough errors to support them.</li>
            <li>Scenarios: a step change to the latest value decays by the carryover factor across the affected months and is clipped to physical bounds. History is never changed.</li>
          </ul>
        </Panel>
      </div>
      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Classification codes" sub="Internal code → label shown on the dashboard" />
        <table className="eiq-table"><thead><tr><th>Classification</th><th>Display label</th></tr></thead>
          <tbody>{(Object.keys(CLASS_LABELS) as Classification[]).map((c) => <tr key={c}><td className="font-mono text-[11px]">{c}</td><td className="text-white">{CLASS_LABELS[c]}</td></tr>)}</tbody></table>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle title="Methodology notes" sub="From the Nexora MVP's Data & Methodology page" />
        <dl className="space-y-3 p-5">
          {NOTES.map(([k, v]) => <div key={k}><dt className="text-[13px] font-semibold text-white">{k}</dt><dd className="mt-0.5 text-[12.5px] leading-relaxed text-mute">{v}</dd></div>)}
        </dl>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle title="Missing data and verification requirements" />
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-[13px] font-semibold text-white">Remaining evidence gaps</h4>
            {Object.entries(missing.remaining_evidence_gaps ?? {}).map(([a, gaps]) => (
              <div key={a} className="mb-3"><div className="text-[12px] font-medium text-soft">{areaName(a as AreaId)}</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-mute">{gaps.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ))}
          </div>
          <div className="space-y-3 text-[12.5px] text-mute">
            <div><h4 className="mb-1 text-[13px] font-semibold text-white">Unverified coordinates</h4>
              <ul className="list-disc pl-5">{(missing.coordinate_gaps ?? []).map((c) => <li key={c.station}>{areaName(c.area_id as AreaId)} · station {c.station}</li>)}</ul></div>
            <div><h4 className="mb-1 text-[13px] font-semibold text-white">Distribution-system sample coordinates</h4><p>{missing.distribution_coordinate_status}</p></div>
            <div><h4 className="mb-1 text-[13px] font-semibold text-white">Water records not analysed</h4><p>{(missing.quality_not_analysed ?? []).length} sample records were reported without an analysed value; they stay visible in the water table and are never filled.</p></div>
            <div><h4 className="mb-1 text-[13px] font-semibold text-white">Monthly gaps</h4><p>{(missing.monthly_gaps ?? []).length ? `${(missing.monthly_gaps ?? []).length} gaps recorded` : 'No missing monthly rows: every area has all 36 months (individual fields may still be missing or censored).'}</p></div>
          </div>
        </div>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle title="Coverage report" />
        <div className="p-5"><Report md={E.coverage_report} /></div>
      </Panel>
      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Censored air readings" sub="Below detection limit or reported as a bound; excluded from numeric values" />
        <div className="overflow-x-auto">
          <table className="eiq-table"><thead><tr><th>Area</th><th>Metric</th><th>Months</th></tr></thead>
            <tbody>{censored.map((c, i) => <tr key={i}><td>{AREAS.find((a) => a.id === c.area_id)?.name ?? c.area_id}</td><td>{METRICS[c.metric]?.name ?? c.metric}</td><td className="num">{c.months.length} · {c.months[0]?.slice(0, 7)} → {c.months.at(-1)?.slice(0, 7)}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Historical records and downloads" sub={`${areaName(sel)} · ${years.join(', ')} · read-only`} right={<button className="eiq-btn" onClick={() => setShowRecords(!showRecords)}>{showRecords ? 'Hide table' : 'Show table'}</button>} />
        {showRecords && (
          <div className="max-h-[480px] overflow-auto border-b border-line/60">
            <table className="eiq-table"><thead><tr>{cols.map((c) => <th key={c}>{c === 'area' || c === 'date' ? c : METRICS[c].name}</th>)}</tr></thead>
              <tbody>{records.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={c === 'area' ? '' : 'num'}>{String((r as Record<string, unknown>)[c] ?? '')}</td>)}</tr>)}</tbody></table>
          </div>
        )}
        <div className="flex flex-wrap gap-2 p-5">
          <button className="eiq-btn" onClick={() => downloadCsv(`${sel}_historical_selected.csv`, historicalRows(sel, years))}>Download selected historical records (read-only export)</button>
          {areasOf(sel).map((a) => <button key={a} className="eiq-btn" onClick={() => downloadCsv(`${a}_provenance.csv`, provenanceRows(a, years))}>Download provenance · {areaName(a)}</button>)}
        </div>
        <p className="px-5 pb-4 font-mono text-[10.5px] break-all text-dim">Canonical source: data_three_area/monthly.csv · SHA256: {E.canonical_sha256}</p>
      </Panel>
    </>
  )
}
