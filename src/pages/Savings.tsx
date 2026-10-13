/** Feature 4: savings tracker – before/after comparison of an indicator, in units and rupees. */
import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api, can, type Saving } from '../api'
import { AREAS, METRICS, actionId, actions, areaName, areasOf, downloadCsv, fmt, series, type AreaId, type Selection } from '../eiq'
import { SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'

/** Indicative tariffs (₹ per unit) – edit per site; they only pre-fill the form. */
const TARIFF_HINT: Record<string, number> = { kWh: 8, kW: 0, L: 0.02, kg: 0, 'kg CO₂e': 0 }
const TRACKABLE = Object.keys(METRICS).filter((k) => ['kWh', 'kW', 'L', 'kg', 'kg CO₂e'].includes(METRICS[k].unit))

interface Preview { unit: string; baseline_avg: number; after_avg: number; months: number; baseline_months: number; units_saved: number; rupees_saved: number; evidence: string }

export default function Savings({ sel }: { sel: Selection }) {
  const { user, version } = useSession()
  const editable = can(user, 'manager')
  const [rows, setRows] = useState<Saving[]>([])
  const [area, setArea] = useState<AreaId>(areasOf(sel)[0])
  const [metric, setMetric] = useState('electricity_kwh')
  const months = useMemo(() => series(area, metric).points.filter((p) => p[1] != null).map((p) => p[0]), [area, metric, version])
  const [bFrom, setBFrom] = useState('')
  const [bTo, setBTo] = useState('')
  const [aFrom, setAFrom] = useState('')
  const [aTo, setATo] = useState('')
  const [tariff, setTariff] = useState(String(TARIFF_HINT[METRICS.electricity_kwh.unit] ?? 0))
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const linkable = useMemo(() => actions(area, []).concat(actions(area, [2023, 2024, 2025])).filter((a, i, all) => all.findIndex((b) => actionId(b) === actionId(a)) === i), [area])

  useEffect(() => { api<Saving[]>('/savings').then(setRows).catch(() => {}) }, [version])
  useEffect(() => {
    // Default: last 3 months as "after", the 3 months before as "baseline".
    const n = months.length
    if (n >= 6) { setBFrom(months[n - 6]); setBTo(months[n - 4]); setAFrom(months[n - 3]); setATo(months[n - 1]) }
    setPreview(null)
  }, [months])
  useEffect(() => { setTariff(String(TARIFF_HINT[METRICS[metric].unit] ?? 0)) }, [metric])

  const body = (save: boolean) => ({ area, metric, baseline_from: bFrom, baseline_to: bTo, after_from: aFrom, after_to: aTo, tariff: Number(tariff) || 0,
    action_id: link || null, action_title: linkable.find((a) => actionId(a) === link)?.['Recommended action'] ?? '', note, save })
  const calc = async (save: boolean) => {
    setErr('')
    try {
      const r = await api<Preview & Saving>('/savings', { json: body(save) })
      if (save) { setRows((x) => [r, ...x]); setPreview(null); setNote('') } else setPreview(r)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
  }
  const del = async (id: number) => { if (confirm('Delete this savings record?')) { await api(`/savings/${id}`, { method: 'DELETE' }); setRows((x) => x.filter((s) => s.id !== id)) } }

  const visible = rows.filter((r) => areasOf(sel).includes(r.area))
  const rupees = visible.reduce((s, r) => s + r.rupees_saved, 0)
  const byUnit = visible.reduce<Record<string, number>>((m, r) => ({ ...m, [r.unit]: (m[r.unit] ?? 0) + r.units_saved }), {})
  const measured = visible.filter((r) => r.evidence.startsWith('Measured')).reduce((s, r) => s + r.rupees_saved, 0)
  const month = (label: string, v: string, set: (v: string) => void) => <Select label={label} value={v || months[0] || ''} options={months} onChange={(x) => { set(x); setPreview(null) }} />

  return (
    <>
      <PageHeader eyebrow="Operations" title="Savings tracker" desc="Compare an indicator before and after an action and record what was saved, in units and rupees. Records based on demonstration or modelled data are marked as estimates." accent="#43d6a0" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat k="Total recorded savings" v={`₹ ${fmt(rupees, '', false)}`} d={`${visible.length} records · ${areasOf(sel).length > 1 ? 'all selected sites' : areaName(sel)}`} />
        <Stat k="Of which from measured data" v={`₹ ${fmt(measured, '', false)}`} d="Both periods are uploaded meter readings" />
        {Object.entries(byUnit).slice(0, 2).map(([u, v]) => <Stat key={u} k={`Saved (${u})`} v={fmt(v, u)} d="Positive = less used after the action" />)}
      </div>

      {editable && (
        <Panel className="mb-4">
          <SectionTitle title="Record a saving" sub="Average per month in the baseline period, minus average in the after period, times the number of after-months" />
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Select label="Site" value={area} options={areasOf(sel).length > 1 ? AREAS.map((a) => a.id) : areasOf(sel)} onChange={(v) => setArea(v as AreaId)} format={(v) => areaName(v as AreaId)} />
            <Select label="Indicator" value={metric} options={TRACKABLE} onChange={setMetric} format={(k) => `${METRICS[k].domain} · ${METRICS[k].name} (${METRICS[k].unit})`} />
            <label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium text-mute">Tariff (₹ per {METRICS[metric].unit})</span>
              <input type="number" min={0} step="0.01" value={tariff} onChange={(e) => { setTariff(e.target.value); setPreview(null) }} className="h-9 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none" /></label>
            <Select label="Linked action (optional)" value={link} options={['', ...linkable.map(actionId)]} onChange={setLink} format={(id) => (id ? (linkable.find((a) => actionId(a) === id)?.['Recommended action'] ?? id).slice(0, 70) : '— none —')} />
            {month('Baseline from', bFrom, setBFrom)}{month('Baseline to', bTo, setBTo)}{month('After from', aFrom, setAFrom)}{month('After to', aTo, setATo)}
            <label className="flex flex-col gap-1.5 md:col-span-2 xl:col-span-3"><span className="text-[11px] font-medium text-mute">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Chiller schedule changed on 5 Jan" className="h-9 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none" /></label>
            <div className="flex items-end gap-2"><button className="eiq-btn flex-1" onClick={() => calc(false)}>Calculate</button><button className="eiq-btn eiq-btn-primary flex-1" disabled={!preview} onClick={() => calc(true)}>Save</button></div>
          </div>
          {err && <p className="mx-5 mb-4 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{err}</p>}
          {preview && (
            <div className="mx-5 mb-5 grid gap-3 rounded-lg border border-line p-4 text-xs sm:grid-cols-5">
              <Mini k="Baseline average" v={fmt(preview.baseline_avg, preview.unit)} d={`${preview.baseline_months} months`} />
              <Mini k="After average" v={fmt(preview.after_avg, preview.unit)} d={`${preview.months} months`} />
              <Mini k="Saved" v={fmt(preview.units_saved, preview.unit)} d={preview.units_saved < 0 ? 'Negative: usage went up' : 'Less used after'} />
              <Mini k="Value" v={`₹ ${fmt(preview.rupees_saved, '', false)}`} d={`at ₹${tariff}/${preview.unit}`} />
              <Mini k="Evidence" v={preview.evidence.startsWith('Measured') ? 'Measured' : 'Estimate'} d={preview.evidence} />
            </div>
          )}
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <SectionTitle title="Savings records" right={<button className="eiq-btn" onClick={() => downloadCsv('savings.csv', visible as unknown as Record<string, unknown>[])}>Export CSV</button>} />
        <div className="overflow-x-auto">
          <table className="eiq-table"><thead><tr><th>Site</th><th>Indicator</th><th>Baseline</th><th>After</th><th>Saved</th><th>₹ saved</th><th>Evidence</th><th>Linked action / note</th><th>By</th><th /></tr></thead>
            <tbody>{visible.map((r) => (
              <tr key={r.id}><td>{areaName(r.area)}</td><td className="text-white">{METRICS[r.metric]?.name}</td><td className="num text-[11px]">{r.baseline_from} → {r.baseline_to}<br />{fmt(r.baseline_avg, r.unit)}/mo</td><td className="num text-[11px]">{r.after_from} → {r.after_to}<br />{fmt(r.after_avg, r.unit)}/mo</td>
                <td className={`num ${r.units_saved >= 0 ? 'text-ok' : 'text-crit'}`}>{fmt(r.units_saved, r.unit)}</td><td className="num text-white">₹ {fmt(r.rupees_saved, '', false)}</td>
                <td><span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10.5px] ${r.evidence.startsWith('Measured') ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-med/40 bg-med/10 text-med'}`}>{r.evidence.startsWith('Measured') ? 'Measured' : 'Estimate'}</span></td>
                <td className="max-w-72 text-[11px] text-mute">{r.action_title}{r.action_title && r.note ? ' · ' : ''}{r.note}</td><td className="text-[11px]">{r.user_name}</td>
                <td>{editable && <button aria-label="Delete" className="eiq-btn !px-2 !py-1" onClick={() => del(r.id)}><Trash2 size={12} /></button>}</td></tr>
            ))}
              {!visible.length && <tr><td colSpan={10} className="py-8 text-center text-mute">No savings recorded yet. Upload measured readings, act on a recommendation, then compare before and after here.</td></tr>}</tbody></table>
        </div>
        <p className="px-5 py-3 text-[11px] text-dim">A simple before/after comparison: it does not adjust for weather, occupancy or season. Compare the same months of the year where possible. Tariffs are entered by you; nothing here is a verified audit.</p>
      </Panel>
    </>
  )
}

const Stat = ({ k, v, d }: { k: string; v: string; d: string }) => <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className="num mt-1 text-xl font-semibold text-white">{v}</div><div className="text-[10.5px] text-dim">{d}</div></div>
const Mini = ({ k, v, d }: { k: string; v: string; d: string }) => <div><div className="text-[10.5px] text-mute">{k}</div><div className="num mt-0.5 text-[15px] font-semibold text-white">{v}</div><div className="text-[10.5px] text-dim">{d}</div></div>
