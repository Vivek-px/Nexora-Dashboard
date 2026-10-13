/** Small client for the Nexora Python backend (backend/app.py). */
import type { AreaId } from './eiq'

export type Role = 'admin' | 'manager' | 'viewer'
export interface User {
  id: number; username: string; name: string; role: Role; areas: string; phone: string; email: string; active: number; area_list: AreaId[]
  staff_id: string | null; must_change: number; sign_in: 'both' | 'google' | 'password'; last_login: string | null
  job_profile_id: number | null; job_profile: string; pages: string[]; domains: string[]; is_head: number
}
export interface UserBrief { id: number; name: string; role: Role }
export interface Delivery { channel: string; recipient: string; kind: string; status: string; detail: string; created_at: string }
export interface Alert { id: number; created_at: string; area: AreaId; metric: string; month: string; level: string; message: string; status: string; ack_name: string | null; ack_at: string | null; escalated_at: string | null; deliveries: Delivery[] }
export interface ActionEvent { id: number; kind: string; text: string; file: string; created_at: string; user_name: string | null }
export interface ActionState { action_id: string; area: AreaId; title: string; status: 'Open' | 'In progress' | 'Done' | 'Dismissed'; owner_id: number | null; owner_name: string | null; due_date: string | null; updated_at: string; events: ActionEvent[] }
export interface Saving { id: number; action_id: string | null; action_title: string; area: AreaId; metric: string; baseline_from: string; baseline_to: string; after_from: string; after_to: string; baseline_avg: number; after_avg: number; months: number; unit: string; tariff: number; units_saved: number; rupees_saved: number; evidence: string; note: string; user_name: string | null; created_at: string }
export interface Recipient { id: number; name: string; channel: 'whatsapp' | 'sms'; phone: string; min_level: 'Watch' | 'High deviation'; areas: string; escalation: number; active: number }
export interface Upload { id: number; filename: string; rows: number; user_name: string | null; created_at: string; summary: string }

const KEY = 'eiq-token'
let token = (() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })()
export const getToken = () => token
export function setToken(t: string) {
  token = t
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* private mode: keep in memory */ }
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f }

export async function api<T>(path: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(`/api${path}`, { method: opts.method ?? (opts.json !== undefined || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined) })
  if (r.status === 401 && path !== '/login') onUnauthorized()
  if (!r.ok) {
    let msg = r.statusText
    try { const j = await r.json(); msg = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join('; ') : msg } catch { /* not JSON */ }
    throw new ApiError(r.status, msg)
  }
  return r.json() as Promise<T>
}

export const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}?t=${encodeURIComponent(token)}`
export const can = (u: User | null, role: Role) => !!u && ({ viewer: 0, manager: 1, admin: 2 }[u.role] >= { viewer: 0, manager: 1, admin: 2 }[role])

/* ---------------------------------------------------------------- Part 1B */
export interface AirNow { kind: 'official' | 'modelled' | 'unavailable'; source?: string; station?: string | null; match?: string; time?: string; pollutants?: Record<string, number>; sub_indices?: Record<string, number>; aqi?: number | null; lead?: string | null; category?: string | null; valid?: boolean; fetched_at?: string; stale?: boolean; error?: string; official_error?: string }
export interface WeatherNow { source?: string; current?: { temperature_2m?: number; relative_humidity_2m?: number; apparent_temperature?: number; precipitation?: number; wind_speed_10m?: number; weather_code?: number; time?: string }; daily?: { date: string; tmax: number; tmin: number; rain_mm: number; rain_prob: number | null }[]; error?: string; fetched_at?: string; stale?: boolean }
export type LiveData = Record<string, { air: AirNow; weather: WeatherNow }>
export interface Profile { area: AreaId; population: number | null; population_source: string; floor_area_m2: number | null; contract_demand_kw: number | null; energy_rate: number | null; demand_rate: number | null; min_billing_pct: number; excess_multiplier: number; fixed_charge: number; water_rate_per_kl: number | null; epi_target: number | null; lpcd_target: number; waste_target: number | null; updated_at: string | null }
export interface BenchRow { month: string; kwh_per_person: number | null; kwh_per_m2: number | null; lpcd: number | null; waste_kg_pp_day: number | null; co2e_kg_per_person: number | null; peak_vs_contract_pct: number | null; evidence: string }
export interface Benchmark { area: AreaId; profile: Profile; monthly: BenchRow[]; epi_kwh_m2_year: number | null; epi_period: string; epi_evidence: string | null; references: Record<'lpcd' | 'epi' | 'waste', { value: number | null; label: string }> }
export interface BillParts { energy: number | null; demand: number | null; excess_penalty: number | null; fixed: number; demand_basis: string | null; electricity_total: number | null; water: number | null }
export interface Bills { area: AreaId; profile: Profile; configured: boolean; history: { month: string; kwh: number; peak_kw: number | null; water_l: number | null; evidence: string; bill: BillParts | null }[]; forecast: { month: string; kwh: number; kwh_hi: number | null; peak_kw: number | null; bill: BillParts | null; bill_hi: BillParts | null }[]; avg_last3: number | null; warnings: string[]; note: string }
export interface Complaint { id: number; area: AreaId; category: string; title: string; description: string; severity: 'Low' | 'Medium' | 'High'; lat: number | null; lon: number | null; photo: string; reporter: string | null; created_at: string; place?: string; loc_source?: string; status?: 'open' | 'dismissed'; dismissed_at?: string | null; dismiss_reason?: string }

/* ---------------------------------------------------------------- Part 1C: Indi (Groq) */
export interface IndiStatus { enabled: boolean; model: string; provider: string }
export interface IndiMsg { role: 'user' | 'assistant'; content: string }
export interface IndiAsk { messages: IndiMsg[]; page: string; area: string; years: number[]; focus: string; screen: string }

/** Streams Indi's answer; calls onText with the growing text. The Groq key never leaves the server. */
export async function indiChat(body: IndiAsk, onText: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await fetch('/api/indi/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  if (r.status === 401) onUnauthorized()
  if (!r.ok || !r.body) {
    let msg = r.statusText
    try { const j = await r.json(); msg = typeof j.detail === 'string' ? j.detail : msg } catch { /* not JSON */ }
    throw new ApiError(r.status, msg)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += dec.decode(value, { stream: true })
    onText(text)
  }
  return text + dec.decode()
}

export interface GeoHit { name: string; lat: number; lon: number; type: string }
export interface JobProfile { id: number; name: string; description: string; level: Role; pages: string[]; domains: string[]; builtin: number; staff: number }
export interface JobProfiles { profiles: JobProfile[]; workspace: string[]; operations: string[]; domains: string[]; admin_only: string[] }
export interface StaffMember extends User { created_at: string; google_linked: boolean; temp_password?: string | null }
export interface AccessRequest { id: number; email: string; name: string; picture: string; status: 'pending' | 'approved' | 'rejected'; created_at: string; decided_at: string | null; phone: string; job_title: string; access: 'staff' | 'admin'; requested_profile_id: number | null; requested_profile: string | null; source: 'signup' | 'google' | 'admin'; proposed_by_name: string | null; proposed_areas: string; proposed_sign_in: string; note: string }
