/** Feature 9: bill & tariff – estimated electricity/water bills, contract-demand penalties and a 3-month bill-shock forecast. */
import { useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Bills as BillsT } from '../api'
import { AREAS, areaName, areasOf, fmt, type AreaId, type Selection } from '../eiq'
import { SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'

const rs = (v: number | null | undefined) => (v == null ? '—' : `₹ ${Math.round(v).toLocaleString('en-IN')}`)

export default function Bills({ sel, go }: { sel: Selection; go: (p: 'admin') => void }) {
  const { version, user } = useSession()
  const [data, setData] = useState<Record<string, BillsT>>({})
  const [area, setArea] = useState<AreaId>(areasOf(sel)[0])
  useEffect(() => { api<Record<string, BillsT>>('/bills').then(setData).catch(() => {}) }, [version])
  useEffect(() => { setArea(areasOf(sel)[0]) }, [sel])
  const b = data[area]
  const hist = b?.history.slice(-12) ?? []
  const chart = [...hist.map((h) => ({ m: h.month, energy: h.bill?.energy ?? null, demand: h.bill?.demand ?? null, excess: h.bill?.excess_penalty ?? null, kind: 'actual' })),
    ...(b?.forecast ?? []).map((f) => ({ m: f.month, forecast: f.bill?.electricity_total ?? null, forecast_hi: f.bill_hi?.electricity_total ?? null, kind: 'forecast' }))]
  return (
    <>
      <PageHeader eyebrow="Operations" title="Bills & tariff" desc="Estimated electricity and water bills from your tariff, warnings when peak demand exceeds the contract demand, and a 3-month bill-shock forecast." accent="#f5b84b" />
      <div className="mb-4 w-64"><Select label="Site" value={area} options={areasOf(sel).length > 1 ? AREAS.map((a) => a.id) : areasOf(sel)} onChange={(v) => setArea(v as AreaId)} format={(v) => areaName(v as AreaId)} /></div>
      {!b ? <Panel className="p-6 text-sm text-mute">Loading…</Panel> : !b.configured ? (
        <Panel className="p-6 text-sm text-soft">No tariff is set for {areaName(area)} yet. {user.role === 'admin' ? <button className="text-lav underline" onClick={() => go('admin')}>Enter the tariff in Admin → Site profiles</button> : 'Ask an admin to enter the tariff (energy rate, demand charge, contract demand).'}</Panel>
      ) : (
        <>
          {b.warnings.length > 0 && <div className="mb-4 space-y-1.5 rounded-xl border border-med/40 bg-med/10 p-4 text-[13px] text-soft">{b.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}</div>}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat k={`Latest bill (${hist.at(-1)?.month})`} v={rs(hist.at(-1)?.bill?.electricity_total)} d={hist.at(-1)?.evidence ?? ''} />
            <Stat k="Average of last 3 months" v={rs(b.avg_last3)} d="Electricity" />
            <Stat k={`Forecast ${b.forecast.at(-1)?.month ?? ''}`} v={rs(b.forecast.at(-1)?.bill?.electricity_total)} d={`Upper range ${rs(b.forecast.at(-1)?.bill_hi?.electricity_total)}`} />
            <Stat k="Contract demand" v={b.profile.contract_demand_kw ? `${b.profile.contract_demand_kw} kW` : 'Not set'} d={`Latest peak ${fmt(hist.at(-1)?.peak_kw ?? null, 'kW')}`} />
          </div>
          <Panel>
            <SectionTitle title="Electricity bill – last 12 months and next 3" sub="Bars: energy + demand + excess-demand charges · line: forecast total (dashed = upper range)" />
            <div className="p-4" style={{ height: 330 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 300 }}>
                <ComposedChart data={chart} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
                  <CartesianGrid stroke="rgba(232,227,250,.08)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: '#b8b2d2', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#b8b2d2', fontSize: 11 }} width={70} tickFormatter={(v: number) => `₹${fmt(v)}`} />
                  <Tooltip contentStyle={{ background: '#1d3159', border: '1px solid #3b3677', borderRadius: 10, fontSize: 12 }} formatter={(v) => rs(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="energy" name="Energy charge" stackId="b" fill="#42d9f5" isAnimationActive={false} />
                  <Bar dataKey="demand" name="Demand charge" stackId="b" fill="#7767d9" isAnimationActive={false} />
                  <Bar dataKey="excess" name="Excess-demand penalty" stackId="b" fill="#ff6b7a" isAnimationActive={false} />
                  <Line dataKey="forecast" name="Forecast total" stroke="#f5b84b" strokeWidth={2.2} isAnimationActive={false} />
                  <Line dataKey="forecast_hi" name="Forecast upper range" stroke="#f5b84b" strokeDasharray="4 4" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel className="mt-4 overflow-hidden">
            <SectionTitle title="Monthly breakdown" />
            <div className="overflow-x-auto"><table className="eiq-table"><thead><tr><th>Month</th><th>kWh</th><th>Peak kW</th><th>Energy</th><th>Demand</th><th>Excess penalty</th><th>Fixed</th><th>Electricity total</th><th>Water</th><th>Evidence</th></tr></thead>
              <tbody>{[...hist].reverse().map((h) => <tr key={h.month}><td className="num">{h.month}</td><td className="num">{fmt(h.kwh)}</td><td className="num" title={h.bill?.demand_basis ?? undefined}>{h.peak_kw != null ? fmt(h.peak_kw) : h.bill?.demand_basis ? <span className="text-dim">— (min. billing)</span> : '—'}</td><td className="num">{rs(h.bill?.energy)}</td><td className="num">{rs(h.bill?.demand)}</td>
                <td className={`num ${(h.bill?.excess_penalty ?? 0) > 0 ? 'text-crit' : ''}`}>{rs(h.bill?.excess_penalty)}</td><td className="num">{rs(h.bill?.fixed)}</td><td className="num font-semibold text-white">{rs(h.bill?.electricity_total)}</td><td className="num">{rs(h.bill?.water)}</td><td className="text-[11px]">{h.evidence}</td></tr>)}</tbody></table></div>
            <p className="px-5 py-3 text-[11px] text-dim">{b.note} Tariff used: energy ₹{b.profile.energy_rate}/kWh, demand ₹{b.profile.demand_rate ?? '—'}/kW, billing demand ≥ {b.profile.min_billing_pct}% of contract, excess demand × {b.profile.excess_multiplier}, fixed ₹{b.profile.fixed_charge}, water ₹{b.profile.water_rate_per_kl ?? '—'}/kL.</p>
          </Panel>
        </>
      )}
    </>
  )
}

const Stat = ({ k, v, d }: { k: string; v: string; d: string }) => <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className="num mt-1 text-xl font-semibold text-white">{v}</div><div className="text-[10.5px] text-dim">{d}</div></div>
