import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AREAS, AREA_COLOR, CLASS_LABELS, CLASS_TONE, areaName, fmt, monthLabel, type AreaId, type Classification, type Point, type Selection } from './eiq'
import { Panel, useFocus } from './ui'

export function ClassBadge({ cls, long }: { cls: Classification; long?: boolean }) {
  const t = CLASS_TONE[cls]
  return <span title={CLASS_LABELS[cls]} className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${t.cls}`}>{long ? CLASS_LABELS[cls] : t.short}</span>
}

const SCREEN: Record<string, { tone: string; mark: string }> = {
  'High deviation': { tone: 'border-crit/40 bg-crit/10 text-crit', mark: '▲▲' },
  Watch: { tone: 'border-med/40 bg-med/10 text-med', mark: '▲' },
  'Within typical variation': { tone: 'border-ok/30 bg-ok/10 text-ok', mark: '●' },
  'Missing latest observation': { tone: 'border-high/40 bg-high/10 text-high', mark: '○' },
  'Insufficient history': { tone: 'border-line text-mute', mark: '○' },
  'Outside empirical baseline range': { tone: 'border-med/40 bg-med/10 text-med', mark: '▲' },
  'Within empirical baseline range': { tone: 'border-ok/30 bg-ok/10 text-ok', mark: '●' },
  'Uncertainty unavailable': { tone: 'border-line text-mute', mark: '○' },
}
export function ScreenBadge({ s }: { s: string }) {
  const t = SCREEN[s] ?? { tone: 'border-line text-mute', mark: '·' }
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${t.tone}`}><span aria-hidden className="text-[8px]">{t.mark}</span>{s}</span>
}
export function PriorityBadge({ p }: { p: string }) {
  const tone = p.startsWith('P1') ? 'border-crit/40 bg-crit/10 text-crit' : p.startsWith('P2') ? 'border-med/40 bg-med/10 text-med' : 'border-line text-mute'
  return <span className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${tone}`}>{p}</span>
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Select<T extends string>({ label, value, options, onChange, format }: { label: string; value: T; options: T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-mute">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-9 min-w-0 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg transition-colors hover:border-lav/40 focus:border-sapphire focus:outline-none">
        {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
      </select>
    </label>
  )
}

export function Range({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[11px] font-medium text-mute">{label}<span className="num text-[13px] font-semibold text-white">{value > 0 && min < 0 ? '+' : ''}{value}{suffix}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="eiq-range mt-2 w-full" />
    </label>
  )
}

/* ---------------------------------------------------------------- Chart */

type Line_ = { id: string; label: string; color: string; points: Point[] }
export function MonthlyChart({ lines, unit, height = 300, forecast, scenario, indiLabel }: {
  lines: Line_[]; unit: string; height?: number
  forecast?: { color: string; points: [string, number, number | null, number | null][] }
  scenario?: [string, number][]
  indiLabel?: string
}) {
  const f = useFocus()
  const dim = (k: string) => (f && f !== k ? 0.15 : 1)
  const rows = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    const row = (m: string) => map.get(m) ?? (map.set(m, { m }), map.get(m)!)
    lines.forEach((l) => l.points.forEach(([m, v, c]) => Object.assign(row(m), { [l.id]: v, [`${l.id}_c`]: c })))
    forecast?.points.forEach(([m, v, lo, hi]) => Object.assign(row(m), { fc: v, band: lo != null && hi != null ? [lo, hi] : null }))
    scenario?.forEach(([m, v]) => Object.assign(row(m), { sc: v }))
    // join forecast to the last observed point so the dashed line is continuous
    if (forecast && lines.length === 1) {
      const last = lines[0].points.filter((p) => p[1] != null).at(-1)
      if (last) Object.assign(row(last[0]), { fc: last[1], sc: scenario ? last[1] : undefined })
    }
    return [...map.values()].sort((a, b) => String(a.m).localeCompare(String(b.m)))
  }, [lines, forecast, scenario])
  const lastObs = lines.flatMap((l) => l.points.filter((p) => p[1] != null).map((p) => p[0])).sort().at(-1)
  const flagged = lines.reduce((n, l) => n + l.points.filter((p) => p[1] == null).length, 0)
  return (
    <div style={{ height }} role="img" aria-label={`${indiLabel ?? 'Monthly'} chart, ${unit}`} data-indi="chart" data-indi-label={indiLabel} data-indi-value={String(flagged)}>
      <ResponsiveContainer debounce={120} width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height }}>
        <ComposedChart data={rows} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="rgba(232,227,250,.08)" vertical={false} />
          <XAxis dataKey="m" tickFormatter={(m: string) => monthLabel(m)} tick={{ fill: '#b8b2d2', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#3b3677' }} minTickGap={28} />
          <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fill: '#b8b2d2', fontSize: 11 }} tickLine={false} axisLine={false} width={56} label={{ value: unit, angle: -90, position: 'insideLeft', fill: '#918baf', fontSize: 11, offset: 2 }} />
          {forecast && lastObs && <ReferenceLine x={lastObs} stroke="#918baf" strokeDasharray="2 4" label={{ value: 'Latest', position: 'insideTopLeft', fill: '#918baf', fontSize: 10 }} />}
          <Tooltip content={<Tip lines={lines} unit={unit} />} cursor={{ stroke: '#a99bff', strokeOpacity: 0.5 }} isAnimationActive={false} />
          {forecast && <Area dataKey="band" stroke="none" fill="#a99bff" fillOpacity={0.14 * dim('band')} isAnimationActive={false} activeDot={false} connectNulls={false} />}
          {lines.map((l) => (
            <Line key={l.id} dataKey={l.id} stroke={l.color} strokeOpacity={dim(l.id)} strokeWidth={f === l.id ? 3 : 2.1} dot={{ r: 2.2, fill: l.color, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#315ce8', stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          ))}
          {forecast && <Line dataKey="fc" stroke={forecast.color} strokeOpacity={dim('forecast')} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />}
          {scenario && <Line dataKey="sc" stroke="#f5b84b" strokeWidth={2.25} dot={{ r: 2.5, fill: '#f5b84b', strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function Tip({ active, payload, label, lines, unit }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; label?: string; lines: Line_[]; unit: string }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="float-glass tip-in min-w-52 rounded-xl px-3 py-2.5 text-xs">
      <div className="num mb-1.5 text-[11px] text-mute">{monthLabel(String(label))}</div>
      {lines.map((l) => r[`${l.id}_c`] !== undefined && (
        <div key={l.id} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-mute"><span className="size-2 rounded-full" style={{ background: l.color }} />{l.label}</span>
          <span className="flex items-center gap-1.5"><span className="num font-semibold text-white">{fmt(r[l.id] as number | null, unit)}</span><ClassBadge cls={r[`${l.id}_c`] as Classification} /></span>
        </div>
      ))}
      {r.fc != null && r[`${lines[0]?.id}_c`] === undefined && <Row k="Baseline forecast" v={fmt(r.fc as number, unit)} />}
      {Array.isArray(r.band) && <Row k="Empirical range" v={`${fmt((r.band as number[])[0])} – ${fmt((r.band as number[])[1])}`} />}
      {r.sc != null && r[`${lines[0]?.id}_c`] === undefined && <Row k="Scenario · hypothetical" v={fmt(r.sc as number, unit)} tone="text-med" />}
    </div>
  )
}
const Row = ({ k, v, tone = 'text-white' }: { k: string; v: string; tone?: string }) => (
  <div className="flex justify-between gap-6 py-0.5"><span className="text-mute">{k}</span><span className={`num font-medium ${tone}`}>{v}</span></div>
)

export const areaLines = (areas: AreaId[], key: string, pts: (a: AreaId) => Point[]): Line_[] =>
  areas.map((a) => ({ id: a, label: areaName(a), color: AREA_COLOR[a], points: pts(a) }))

/* ---------------------------------------------------------------- Map */

export { StationMap } from './stationMap'

export function ExecKpi({ label, value, unit, detail, badge, accent = '#315ce8' }: { label: string; value: string; unit: string; detail: string; badge: string; accent?: string }) {
  return (
    <Panel fx="light" attrs={{ 'data-indi': 'kpi', 'data-indi-label': label, 'data-indi-value': `${value} ${unit}`.trim(), 'data-indi-desc': `${detail}. Evidence: ${badge}.` }} className="relative overflow-hidden p-4">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} aria-hidden />
      <div className="text-xs leading-snug font-medium text-mute">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5"><span className="num font-display text-[28px] leading-none font-semibold text-white">{value}</span><span className="text-[11px] text-mute">{unit}</span></div>
      <div className="mt-2.5 text-[11px] leading-snug text-mute">{detail}</div>
      <span className="mt-3 inline-block rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-mute">{badge}</span>
    </Panel>
  )
}
