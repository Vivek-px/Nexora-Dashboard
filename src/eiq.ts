/**
 * Nexora data layer. Values come from `nexora.json`, exported by `scripts/export_nexora.py`
 * using the repository's own engine (Vivek-px/Nexora-Bhubaneswar-MVP). Nothing here invents readings;
 * helpers below are direct ports of the repo's presentation utilities.
 */
import raw from './nexora.json'

export type Classification = 'OBSERVED_OFFICIAL' | 'VERIFIED_RESEARCH' | 'MODELLED_AREA_SCENARIO' | 'SHARED_SYNTHETIC_BASELINE' | 'MISSING' | 'MEASURED_FACILITY' | 'STAFF_REPORT'
export type AreaId = 'palasuni' | 'irc_nayapalli' | 'khandagiri'
export type Selection = AreaId | 'all'
export type Point = [month: string, value: number | null, cls: Classification]
/** Per-month source ledger row: [month, raw value, measurement status, source url, source ref, geographic scope] */
export type LedgerRow = [month: string, raw: string, status: string, url: string, ref: string, scope: string]
export interface Series { points: Point[]; source: string; scope: string; status: string; ledger?: LedgerRow[] }
export interface Score { Model: string; 'Chronological MAE': number | null; 'Validation predictions': number; 'Evaluated leads': number; Selected: boolean }
export interface Metric { name: string; unit: string; mode: string; domain: string; lower: number | null; upper: number | null }
export interface Forecast { available: boolean; reason?: string; method?: string; mae?: number; selection_end?: string; limitations?: string; points?: [string, number, number | null, number | null][]; scores?: Score[] }
export interface Finding {
  area_id: AreaId; Area: string; Domain: string; Metric: string; metric_key: string; 'Measurement period': string
  Value: number | null; Unit: string; 'Expected reference': number | null; Deviation: number | null; 'Robust deviation': number | null
  'Screening result': string; 'Evidence kind': string; Classification: Classification; Source: string; Reason: string; Limitation: string; 'Reference method'?: string
}
export interface Action {
  Priority: string; area_id: AreaId; Area: string; Domain: string; 'Action type': string; 'Triggering evidence': string
  'Recommended action': string; 'Responsible function': string; 'Expected direction': string; Limitations: string; Source: string; Classification: Classification
}
export interface Station { station_id: string; name: string; medium: string; latitude: number | null; longitude: number | null; coordinate_status: string }
export interface Area { id: AreaId; name: string; reference: Station & { coordinate_source: string; scope: string }; stations: Station[] }
export interface WaterSample {
  id: string; site: string; site_reported: string; type: string; parameter: string; value: string; unit: string; exact: number | null; comparator: string
  measurement_status: string; period: string; start: string; end: string; sample_date: string; sample_period: string; date_precision: string
  status: string; limit: string; verification: string; source: string; source_page: string; lat: number | null; lon: number | null; notes: string
  classification: Classification; scope: string; station_code: string
}

interface Raw {
  class_labels: Record<Classification, string>; years: number[]
  domains: { name: string; default: string; metrics: string[] }[]; metrics: Record<string, Metric>; areas: Area[]
  series: Record<AreaId, Record<string, Series>>; forecasts: Record<AreaId, Record<string, Record<string, Forecast>>>
  findings: Record<AreaId, Record<string, Finding[]>>; actions: Record<AreaId, Record<string, Action[]>>
  water_samples: Record<AreaId, WaterSample[]>; water_population: Record<AreaId, number>
  coverage_report: string; missing: Record<string, unknown>; canonical_sha256: string; water_evidence_records: number
}
export const E = raw as unknown as Raw

// Display wording: the MVP's "Shared synthetic baseline" class is shown as "Demonstration data".
// Applied at load, so a fresh export from the MVP keeps this wording. The underlying class code is unchanged.
const DEMO = 'Demonstration data'
E.class_labels.SHARED_SYNTHETIC_BASELINE = DEMO
E.class_labels.MEASURED_FACILITY = 'Measured (facility upload)'
E.class_labels.STAFF_REPORT = 'Staff report (complaint)'
E.coverage_report = E.coverage_report.replace(/SHARED_SYNTHETIC_BASELINE/g, DEMO)
for (const byYears of Object.values(E.actions))
  for (const list of Object.values(byYears))
    for (const a of list) a['Triggering evidence'] = a['Triggering evidence'].replace(/shared synthetic baselines/gi, 'demonstration data')

export const CLASS_LABELS = E.class_labels
export const YEARS = E.years
export const DOMAINS = E.domains
export const METRICS = E.metrics
export const AREAS = E.areas
export const AREA_IDS = AREAS.map((a) => a.id)
export const areaName = (s: Selection | undefined) => AREAS.find((a) => a.id === s)?.name ?? 'All Areas'
export const areasOf = (s: Selection | undefined): AreaId[] => (s && AREAS.some((a) => a.id === s) ? [s as AreaId] : AREAS.map((a) => a.id))
/** Findings/actions were pre-computed by the MVP for its own reporting years; uploaded later years have no pre-computed screening. */
const BASE_YEARS = [...E.years]
const yearKey = (years: number[]) => { const y = years.filter((v) => BASE_YEARS.includes(v)); return (y.length ? y : BASE_YEARS).sort().join(',') }

/** Display tone per evidence class: official evidence reads strongest, demonstration data reads quietest. */
export const CLASS_TONE: Record<Classification, { short: string; cls: string }> = {
  OBSERVED_OFFICIAL: { short: 'Official', cls: 'border-ok/40 bg-ok/10 text-ok' },
  VERIFIED_RESEARCH: { short: 'Research', cls: 'border-sapphire-soft/40 bg-sapphire/15 text-sapphire-soft' },
  MODELLED_AREA_SCENARIO: { short: 'Modelled', cls: 'border-lav/40 bg-lav/10 text-lav' },
  SHARED_SYNTHETIC_BASELINE: { short: 'Demo', cls: 'border-line text-mute' },
  MEASURED_FACILITY: { short: 'Measured', cls: 'border-cyan/40 bg-cyan/10 text-cyan' },
  STAFF_REPORT: { short: 'Staff report', cls: 'border-orchid/40 bg-orchid/10 text-orchid-soft' },
  MISSING: { short: 'Missing', cls: 'border-high/40 bg-high/10 text-high' },
}

/** Port of dashboard.monthly_analytics.fmt */
export function fmt(num: number | null | undefined, unit = '', short = true) {
  if (num == null || !Number.isFinite(num)) return '—'
  const v = Number(num)
  const g = (d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  let r: string
  if (short && Math.abs(v) >= 1_000_000) r = `${(v / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
  else if (short && Math.abs(v) >= 10_000) r = `${(v / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
  else if (Math.abs(v) >= 100) r = g(0)
  else if (Math.abs(v) >= 10) r = g(1)
  else r = g(2)
  return `${r} ${unit}`.trim()
}

export const series = (area: AreaId, key: string) => E.series[area][key]
export const history = (area: AreaId, key: string, years?: number[]) =>
  series(area, key).points.filter((p) => !years || years.includes(Number(p[0].slice(0, 4))))
export const forecast = (area: AreaId, key: string, horizon: number) => E.forecasts[area][key][String(horizon)]
/** Domains the signed-in user's job profile may see (null = all). 'Operations' rows (data coverage) are always shown. */
let seenDomains: Set<string> | null = null
export const domainVisible = (d: string) => !seenDomains || seenDomains.has(d) || d === 'Operations'
export const findings = (s: Selection, years: number[]) => (years.length ? areasOf(s).flatMap((a) => E.findings[a][yearKey(years)] ?? []).filter((f) => domainVisible(f.Domain)) : [])
const PRIORITY_ORDER = (p: string) => (p.startsWith('P1') ? 0 : p.startsWith('P2') ? 1 : 2)
export const actions = (s: Selection, years: number[]) =>
  (years.length ? areasOf(s).flatMap((a) => E.actions[a][yearKey(years)] ?? []) : areasOf(s).flatMap((a) => (E.actions[a][yearKey(YEARS)] ?? []).filter((x) => x.Priority === 'P3 · coverage work'))).filter((x) => domainVisible(x.Domain))
    .sort((a, b) => PRIORITY_ORDER(a.Priority) - PRIORITY_ORDER(b.Priority) || a.area_id.localeCompare(b.area_id) || a.Domain.localeCompare(b.Domain))

/** Port of DashboardData.comparison: one row per area at the same last selected calendar month; no pooling. */
export function comparison(s: Selection, key: string, years: number[]) {
  const months = areasOf(s).flatMap((a) => history(a, key, years).map((p) => p[0]))
  const period = months.length ? months.sort().at(-1)! : null
  return areasOf(s).map((a) => {
    const p = period ? history(a, key, years).find((x) => x[0] === period) : undefined
    const ser = series(a, key)
    return { area: a, name: areaName(a), period: period ?? 'No selected period', value: p?.[1] ?? null, cls: (p?.[2] ?? 'MISSING') as Classification, source: ser.source, scope: ser.scope }
  })
}

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
export const lastMonth = (years: number[]) => (years.length ? `${Math.max(...years)}-12` : null)

/** Port of facility.intelligence.scenarios.project_scenario (no historical mutation or causality). */
export function projectScenario(baseline: number[], latest: number, changePct: number, carryover: number, affected: number, lower: number | null, upper: number | null) {
  const clip = (v: number) => Math.min(upper ?? Infinity, Math.max(lower ?? -Infinity, v))
  const injected = clip(latest * (1 + changePct / 100))
  const projected = baseline.map((b, i) => {
    const lead = i + 1
    const impact = lead > affected ? 0 : (injected - latest) * carryover ** lead
    return clip(b + impact)
  })
  return { injected, projected }
}

export const SCREEN_TONE: Record<string, string> = {
  'High deviation': 'border-crit/40 bg-crit/10 text-crit',
  Watch: 'border-med/40 bg-med/10 text-med',
  'Within typical variation': 'border-ok/30 bg-ok/10 text-ok',
  'Missing latest observation': 'border-high/40 bg-high/10 text-high',
  'Insufficient history': 'border-line text-mute',
  'Outside empirical baseline range': 'border-med/40 bg-med/10 text-med',
  'Within empirical baseline range': 'border-ok/30 bg-ok/10 text-ok',
  'Uncertainty unavailable': 'border-line text-mute',
}

/** Per-domain accents (Royal Indigo system). */
export const DOMAIN_ACCENT: Record<string, string> = {
  Energy: '#42d9f5', Water: '#7fb0c5', 'Air Quality': '#43d6a0', Mobility: '#6a8cf0',
  'Buildings & Assets': '#e6c477', Waste: '#43d6a0', Carbon: '#5fc7d8', 'Climate & Resilience': '#a99bff',
}
export const AREA_COLOR: Record<AreaId, string> = { palasuni: '#42d9f5', irc_nayapalli: '#a99bff', khandagiri: '#e6c477' }

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob([[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}


/* ---------------------------------------------------------------- MVP ports added for feature parity */

/** Port of dashboard.environmental_map.sample_label */
export const sampleLabel = (w: WaterSample) => (w.date_precision === 'day' ? w.sample_date : `${w.sample_period} (month only)`)

/** Port of facility.intelligence.scenarios.scenario_findings */
export interface ScenarioFinding {
  area_id: AreaId; Area: string; Domain: string; metric_key: string; 'Measurement period': string; Baseline: number; 'Scenario value': number; Difference: number
  'Evidence kind': string; Classification: Classification; 'Baseline classification': Classification; Source: string; 'Screening result': string
  'Expected reference': number; 'Lower reference': number | null; 'Upper reference': number | null; Reason: string
}
const g = (v: number) => Number(v.toPrecision(6)).toString()
const sg = (v: number) => (v >= 0 ? '+' : '') + g(v)
export function scenarioFindings(area: AreaId, key: string, f: Forecast, projected: number[], changePct: number, carryover: number, affected: number): ScenarioFinding[] {
  if (!f.available || !f.points) return []
  const ser = series(area, key)
  const last = ser.points.at(-1)
  const rows: ScenarioFinding[] = []
  f.points.forEach(([month, baseline, lo, hi], i) => {
    const actual = projected[i]
    const difference = actual - baseline
    if (Math.abs(difference) <= 1e-9) return
    const band = lo != null && hi != null
    const outside = band && (actual < lo! || actual > hi!)
    rows.push({
      area_id: area, Area: areaName(area), Domain: METRICS[key].domain, metric_key: key, 'Measurement period': month,
      Baseline: baseline, 'Scenario value': actual, Difference: difference, 'Evidence kind': 'Hypothetical scenario outcome',
      Classification: 'MODELLED_AREA_SCENARIO', 'Baseline classification': (last?.[2] ?? 'MISSING') as Classification, Source: ser.source,
      'Screening result': outside ? 'Outside empirical baseline range' : band ? 'Within empirical baseline range' : 'Uncertainty unavailable',
      'Expected reference': baseline, 'Lower reference': band ? lo : null, 'Upper reference': band ? hi : null,
      Reason: `Lead ${i + 1}: ${sg(difference)} versus baseline under a ${sg(changePct)}% injection, ${g(carryover)} carryover and ${affected} affected months. This compares a user assumption with an empirical range; it is not a probability or operational incident.`,
    })
  })
  return rows
}

/** Port of facility.intelligence.scenarios.water_equivalents (unit conversion only). */
export function waterEquivalents(f: Forecast, projected: number[], population: number) {
  return (f.points ?? []).map(([month, baseline], i) => {
    const [y, m] = month.split('-').map(Number)
    const days = new Date(y, m, 0).getDate()
    return { 'Forecast month': month, 'Baseline volume kL': baseline / 1000, 'Scenario volume kL': projected[i] / 1000,
      'Volume difference kL': (projected[i] - baseline) / 1000, 'Equivalent scenario LPCD': projected[i] / (population * days) }
  })
}

const OWNERS: Record<string, string> = {
  energy: 'Facilities / electrical operations', 'water demand': 'Facilities / water operations', water: 'Facilities / water operations',
  'air quality': 'Environmental monitoring liaison', mobility: 'Transport / site operations', 'buildings & assets': 'Facilities / asset management',
  waste: 'Waste operations', carbon: 'Sustainability / reporting', 'climate & resilience': 'Facilities / resilience planning',
}
/** Port of facility.intelligence.recommendations.scenario_actions */
export function scenarioActions(rows: ScenarioFinding[]): Action[] {
  if (!rows.length) return []
  const r = rows[0]
  return [{
    Priority: 'P3 · scenario planning', area_id: r.area_id, Area: r.Area, Domain: r.Domain, 'Action type': 'Hypothetical scenario outcome',
    'Triggering evidence': rows.map((x) => `${x['Measurement period']}: ${sg(x.Difference)} versus baseline (${x['Screening result']})`).join('; '),
    'Recommended action': 'Review scenario assumptions and compare capacity/planning options with the baseline; obtain operational evidence before acting.',
    'Responsible function': OWNERS[r.Domain.toLowerCase()] ?? 'Data stewardship', 'Expected direction': 'Improve contingency planning under the stated hypothetical change',
    Limitations: 'User-defined perturbation, not an observed incident or established causal effect. ' + r.Reason, Source: r.Source, Classification: 'MODELLED_AREA_SCENARIO',
  }]
}

/* Saved scenarios: each area/metric keeps its own settings for the session, like the MVP's scenario_settings. */
export interface ScenarioSettings { change: number; carryover: number; horizon: number; affected: number }
export const SCENARIO_DEFAULT: ScenarioSettings = { change: 0, carryover: 0.8, horizon: 6, affected: 6 }
type ScenarioStore = Record<string, ScenarioSettings>
const SKEY = 'eiq-scenarios'
let store: ScenarioStore = (() => { try { return JSON.parse(sessionStorage.getItem(SKEY) ?? '{}') } catch { return {} } })()
const subs = new Set<() => void>()
export const scenarioStore = {
  get: (area: AreaId, key: string): ScenarioSettings => store[`${area}|${key}`] ?? SCENARIO_DEFAULT,
  set: (area: AreaId, key: string, v: ScenarioSettings) => {
    store = { ...store, [`${area}|${key}`]: v }
    try { sessionStorage.setItem(SKEY, JSON.stringify(store)) } catch { /* private mode: keep in memory */ }
    subs.forEach((f) => f())
  },
  all: () => store,
  subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
}
/** Actions from every saved non-zero scenario in the selected areas (MVP render_recommendations). */
export function savedScenarioActions(s: Selection): Action[] {
  const out: Action[] = []
  for (const [k, v] of Object.entries(store)) {
    const [area, key] = k.split('|') as [AreaId, string]
    if (!areasOf(s).includes(area) || !v.change || !METRICS[key]) continue
    const f = forecast(area, key, v.horizon)
    if (!f?.available) {
      out.push({ Priority: 'P3 · coverage work', area_id: area, Area: areaName(area), Domain: METRICS[key].domain, 'Action type': 'Data coverage warning',
        'Triggering evidence': `Scenario cannot be projected: ${METRICS[key].name}. ${f?.reason ?? ''}`, 'Recommended action': 'Obtain sufficient exact monthly history; do not fill gaps to force a forecast.',
        'Responsible function': 'Data stewardship', 'Expected direction': 'Improve forecast eligibility', Limitations: 'No scenario outcome was manufactured.',
        Source: 'data_three_area/monthly_metric_ledger.csv', Classification: 'MISSING' })
      continue
    }
    const latest = history(area, key).filter((p) => p[1] != null).at(-1)
    if (!latest) continue
    const { projected } = projectScenario(f.points!.map((p) => p[1]), latest[1]!, v.change, v.carryover, v.affected, METRICS[key].lower, METRICS[key].upper)
    out.push(...scenarioActions(scenarioFindings(area, key, f, projected, v.change, v.carryover, v.affected)))
  }
  return out
}

/** All monthly rows for the selected areas/years (MVP 'historical records' view). */
export function historicalRows(s: Selection, years: number[]) {
  return areasOf(s).flatMap((a) => {
    const months = history(a, Object.keys(METRICS)[0], years).map((p) => p[0])
    return months.map((m) => ({ area_id: a, area: areaName(a), date: m, ...Object.fromEntries(Object.keys(METRICS).map((k) => [k, series(a, k).points.find((p) => p[0] === m)?.[1] ?? ''])) }))
  })
}

/** Provenance ledger rows for one area across all indicators (MVP provenance download). */
export function provenanceRows(area: AreaId, years?: number[], keys = Object.keys(METRICS)) {
  return keys.flatMap((k) => {
    const ser = series(area, k)
    return (ser.ledger ?? []).map((l, i) => ({ area_id: area, area_name: areaName(area), date: l[0], metric: k, value: ser.points[i]?.[1] ?? '', raw_value: l[1], unit: METRICS[k].unit,
      classification: ser.points[i]?.[2] ?? '', measurement_status: l[2], source_url: l[3], source_ref: l[4], geographic_scope: l[5] }))
      .filter((r) => !years || years.includes(Number(String(r.date).slice(0, 4))))
  })
}

/** Lazily fetch the 12-month backtest predictions (kept out of the main bundle). */
let backtests: Promise<Record<string, Record<string, [string, string, string, number, number, number, number][]>>> | null = null
export async function backtestRows(area: AreaId, key: string) {
  backtests ??= fetch(`${import.meta.env.BASE_URL}data/backtests.json`).then((r) => r.json())
  const rows = (await backtests)[area]?.[key] ?? []
  return rows.map(([method, train_end, target_date, lead, actual, prediction, error]) => ({ method, train_end, target_date, lead, actual, prediction, error }))
}


/* ---------------------------------------------------------------- measured readings from the backend */

export interface Reading { id: number; area: AreaId; metric: string; month: string; value: number; note: string; upload_id: number | null; user_name: string | null; created_at: string }
const BASE_SERIES: Raw['series'] = JSON.parse(JSON.stringify(E.series))
const ALL_AREAS = [...E.areas]
export let measuredCount = 0

/** Reset to the MVP export, keep only the user's sites, then overlay uploaded measured readings. */
const ALL_DOMAINS = [...E.domains]
export function applySession(allowed: AreaId[], readings: Reading[], domains?: string[]) {
  E.areas.splice(0, E.areas.length, ...ALL_AREAS.filter((a) => allowed.includes(a.id)))
  // Job profile: hide the domains this person does not work with (every page reads this shared list).
  const keep = domains?.length ? ALL_DOMAINS.filter((d) => domains.includes(d.name)) : ALL_DOMAINS
  E.domains.splice(0, E.domains.length, ...(keep.length ? keep : ALL_DOMAINS))
  seenDomains = keep.length && keep.length < ALL_DOMAINS.length ? new Set(keep.map((d) => d.name)) : null
  E.series = JSON.parse(JSON.stringify(BASE_SERIES))
  E.years.splice(0, E.years.length, ...BASE_YEARS)
  for (const r of readings) {
    const ser = E.series[r.area]?.[r.metric]
    if (!ser) continue
    const i = ser.points.findIndex((p) => p[0] === r.month)
    const point: Point = [r.month, r.value, 'MEASURED_FACILITY']
    const ledger: LedgerRow = [r.month, String(r.value), 'Measured', '', `Dashboard upload${r.user_name ? ' by ' + r.user_name : ''}${r.note ? ' · ' + r.note : ''}`, 'Facility measurement uploaded to the dashboard']
    if (i >= 0) { ser.points[i] = point; if (ser.ledger) ser.ledger[i] = ledger }
    else {
      ser.points.push(point); ser.ledger?.push(ledger)
      const order = ser.points.map((p, k) => [p[0], k] as const).sort((a, b) => a[0].localeCompare(b[0])).map(([, k]) => k)
      ser.points = order.map((k) => ser.points[k]); if (ser.ledger) ser.ledger = order.map((k) => ser.ledger![k])
    }
    const y = Number(r.month.slice(0, 4))
    if (!E.years.includes(y)) E.years.push(y)
  }
  E.years.sort()
  measuredCount = readings.length
}

/** Uploaded months newer than the MVP export (not yet included in pre-computed forecasts). */
export const uploadedBeyondExport = (area: AreaId, key: string) => {
  const lastBase = BASE_SERIES[area][key].points.at(-1)?.[0] ?? ''
  return series(area, key).points.filter((p) => p[2] === 'MEASURED_FACILITY' && p[0] > lastBase).length
}

/** Stable id for an action, so its status/owner survive re-exports. */
export function actionId(a: Pick<Action, 'area_id' | 'Domain' | 'Action type' | 'Triggering evidence'>) {
  const text = [a.area_id, a.Domain, a['Action type'], a['Triggering evidence']].join('|')
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519) }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
