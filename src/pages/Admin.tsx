/** Feature 5 + alert settings: users, roles and sites; WhatsApp/SMS recipients; escalation. Admins only. */
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Pencil, Send, Trash2, UsersRound } from 'lucide-react'
import { api, type IndiStatus, type Profile, type Recipient } from '../api'
import type { Go } from '../App'
import { AREAS, areaName, type AreaId } from '../eiq'
import { SectionTitle } from '../eui'
import { PageHeader, Panel } from '../ui'

const input = 'h-9 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none'

export function Sites({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const all = value === '*'
  const picked = all ? AREAS.map((a) => a.id) : value.split(',').filter(Boolean)
  const toggle = (id: AreaId) => { const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; onChange(next.length === AREAS.length ? '*' : next.join(',')) }
  return (
    <div className="flex flex-wrap gap-2">
      <label className="flex items-center gap-1.5 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={all} onChange={(e) => onChange(e.target.checked ? '*' : AREAS[0].id)} />All sites</label>
      {!all && AREAS.map((a) => <label key={a.id} className="flex items-center gap-1.5 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />{a.name}</label>)}
    </div>
  )
}

const blankRec = { id: 0, name: '', channel: 'whatsapp' as 'whatsapp' | 'sms', phone: '', min_level: 'Watch' as 'Watch' | 'High deviation', areas: '*', escalation: false, active: true }

export default function Admin({ go }: { go: Go }) {
  const [recs, setRecs] = useState<Recipient[]>([])
  const [status, setStatus] = useState<{ whatsapp: boolean; whatsapp_mode: string; sms: boolean; sms_provider: string; escalation_hours: number } | null>(null)
  const [r, setR] = useState(blankRec)
  const [hours, setHours] = useState('24')
  const [msg, setMsg] = useState('')
  const [indi, setIndi] = useState<IndiStatus | null>(null)
  const load = () => {
    api<Recipient[]>('/recipients').then(setRecs)
    api<IndiStatus>('/indi/status').then(setIndi).catch(() => {})
    api<typeof status>('/notify/status').then((s) => { setStatus(s); setHours(String(s?.escalation_hours ?? 24)) })
  }
  useEffect(load, [])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }
  const fail = (e: unknown) => flash(e instanceof Error ? e.message : 'Failed')

  const saveRec = async (e: FormEvent) => {
    e.preventDefault()
    const { id, ...body } = r
    try { await api(id ? `/recipients/${id}` : '/recipients', { method: id ? 'PATCH' : 'POST', json: body }); flash('Recipient saved'); setR(blankRec); load() } catch (err) { fail(err) }
  }
  const test = async (id: number) => {
    try { const t = await api<{ status: string; detail: string }>('/notify/test', { json: { recipient_id: id } }); flash(`Test message: ${t.status.replace('_', ' ')}${t.status !== 'sent' ? ' – ' + t.detail : ''}`) } catch (err) { fail(err) }
  }
  const delRec = async (id: number) => { if (confirm('Remove this recipient?')) { await api(`/recipients/${id}`, { method: 'DELETE' }); load() } }
  const saveHours = async () => { try { await api('/settings/escalation', { method: 'PUT', json: { hours: Number(hours) } }); flash('Escalation time saved') } catch (err) { fail(err) } }

  return (
    <>
      <PageHeader eyebrow="Operations" title="Admin & alerts" desc="Who receives WhatsApp/SMS alerts, connections (Groq, data.gov.in, Google), escalation and each site’s profile and tariff." accent="#b65cb9" />
      {msg && <div className="sticky top-16 z-30 mb-3 rounded-lg border border-lav/40 bg-panel px-4 py-2 text-sm text-soft">{msg}</div>}

      <Panel className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-11 place-items-center rounded-xl bg-lav/15 text-lav"><UsersRound size={20} /></span>
        <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold text-white">Staff, job profiles and access requests</div>
          <p className="text-[12px] text-mute">Create staff IDs, register emails, decide what each job can see, and approve people who asked to join with Google.</p></div>
        <button className="eiq-btn eiq-btn-primary" onClick={() => go('staff')}>Open Staff & access<ArrowRight size={13} /></button>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle title="Alert delivery and connections" sub="Credentials live only in backend/.env (Nexora.bat → 5) – never in the dashboard" />
        <div className="grid gap-4 p-5 lg:grid-cols-2 2xl:grid-cols-4">
          <Channel ok={!!status?.whatsapp} name="WhatsApp (Meta Cloud API)" detail={status?.whatsapp ? `Configured · ${status.whatsapp_mode === 'template' ? 'approved template' : 'text messages (24-hour window only)'}` : 'Not configured. In backend/.env set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE, then restart.'} />
          <Channel ok={!!status?.sms} name={`SMS${status && status.sms_provider !== 'none' ? ` (${status.sms_provider})` : ''}`} detail={status?.sms ? 'Configured' : 'Not configured. In backend/.env set SMS_PROVIDER=twilio (TWILIO_*) or msg91 (MSG91_*), then restart. Indian SMS needs DLT registration.'} />
          <Channel ok={!!indi?.enabled} name="Indi assistant (Groq)" detail={indi?.enabled ? `On · model ${indi.model}. Answers use only this dashboard’s data.` : 'Guide mode only. Get a free key at console.groq.com → API Keys, put it in backend/.env as GROQ_API_KEY, then restart.'} />
          <div className="summary-card">
            <div className="text-[12.5px] font-semibold text-white">Escalation</div>
            <p className="mt-1 text-[11.5px] text-mute">If an alert is still open after this many hours, it is re-sent once to recipients marked “escalation”.</p>
            <div className="mt-2 flex gap-2"><input type="number" min={0.1} step={0.5} className={input} value={hours} onChange={(e) => setHours(e.target.value)} /><button className="eiq-btn" onClick={saveHours}>Save</button></div>
          </div>
        </div>
        <div className="grid gap-4 px-5 pb-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-lg border border-line/60"><table className="eiq-table"><thead><tr><th>Name</th><th>Channel</th><th>Phone</th><th>Alerts</th><th>Sites</th><th>Escalation</th><th /></tr></thead>
            <tbody>{recs.map((x) => <tr key={x.id} className={x.active ? '' : 'opacity-50'}><td className="text-white">{x.name}</td><td>{x.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</td><td className="num">{x.phone}</td><td>{x.min_level === 'Watch' ? 'Watch + High' : 'High only'}</td><td className="text-[11px]">{x.areas === '*' ? 'All' : x.areas.split(',').map((a) => areaName(a as AreaId)).join(', ')}</td><td>{x.escalation ? 'Yes' : '—'}</td>
              <td className="whitespace-nowrap"><button className="eiq-btn !px-2 !py-1" onClick={() => test(x.id)}><Send size={12} />Test</button> <button className="eiq-btn !px-2 !py-1" onClick={() => setR({ ...x, escalation: !!x.escalation, active: !!x.active })}><Pencil size={12} /></button> <button aria-label="Remove" className="eiq-btn !px-2 !py-1" onClick={() => delRec(x.id)}><Trash2 size={12} /></button></td></tr>)}
              {!recs.length && <tr><td colSpan={7} className="py-6 text-center text-mute">No recipients yet – alerts will only show in the dashboard.</td></tr>}</tbody></table></div>
          <form onSubmit={saveRec} className="space-y-3 rounded-lg border border-line/60 p-4">
            <div className="text-[13px] font-semibold text-white">{r.id ? 'Edit recipient' : 'Add recipient'}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[11.5px] text-mute">Name<input className={input} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required /></label>
              <label className="text-[11.5px] text-mute">Mobile number<input className={input} value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} placeholder="98765 43210 or +91…" required minLength={8} /></label>
              <label className="text-[11.5px] text-mute">Channel<select className={input} value={r.channel} onChange={(e) => setR({ ...r, channel: e.target.value as 'whatsapp' | 'sms' })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select></label>
              <label className="text-[11.5px] text-mute">Send for<select className={input} value={r.min_level} onChange={(e) => setR({ ...r, min_level: e.target.value as 'Watch' | 'High deviation' })}><option value="Watch">Watch and High deviation</option><option value="High deviation">High deviation only</option></select></label>
            </div>
            <div><div className="mb-1 text-[11.5px] text-mute">Sites</div><Sites value={r.areas} onChange={(v) => setR({ ...r, areas: v })} /></div>
            <label className="flex items-center gap-2 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={r.escalation} onChange={(e) => setR({ ...r, escalation: e.target.checked })} />Escalation contact (gets unacknowledged alerts)</label>
            <label className="flex items-center gap-2 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} />Active</label>
            <div className="flex gap-2"><button className="eiq-btn eiq-btn-primary flex-1">Save recipient</button>{r.id > 0 && <button type="button" className="eiq-btn" onClick={() => setR(blankRec)}>Cancel</button>}</div>
          </form>
        </div>
      </Panel>

      <SiteProfiles flash={flash} />
    </>
  )
}

const PF: { k: keyof Profile; label: string; help: string; group: 'site' | 'tariff' | 'target' }[] = [
  { k: 'population', label: 'People served', help: 'Residents, staff or beds × occupancy. Used for per-person figures.', group: 'site' },
  { k: 'floor_area_m2', label: 'Built-up floor area (m²)', help: 'Needed for kWh/m² and the Energy Performance Index.', group: 'site' },
  { k: 'contract_demand_kw', label: 'Contract demand (kW)', help: 'Sanctioned load on the electricity bill (kVA × power factor).', group: 'tariff' },
  { k: 'energy_rate', label: 'Energy charge (₹/kWh)', help: 'From your current tariff order or last bill.', group: 'tariff' },
  { k: 'demand_rate', label: 'Demand charge (₹/kW/month)', help: 'Leave blank if your tariff has no demand charge.', group: 'tariff' },
  { k: 'min_billing_pct', label: 'Minimum billing demand (%)', help: 'Billed demand is at least this share of contract demand (often 80%).', group: 'tariff' },
  { k: 'excess_multiplier', label: 'Excess-demand multiplier', help: 'Demand above contract is charged at this multiple (often 2×).', group: 'tariff' },
  { k: 'fixed_charge', label: 'Fixed / meter charge (₹/month)', help: 'Any flat monthly charge.', group: 'tariff' },
  { k: 'water_rate_per_kl', label: 'Water tariff (₹/kL)', help: 'Optional, for the water bill estimate.', group: 'tariff' },
  { k: 'epi_target', label: 'EPI target (kWh/m²/year)', help: 'Your own or the BEE star-rating band for the building type.', group: 'target' },
  { k: 'lpcd_target', label: 'Water target (L/person/day)', help: 'CPHEEO norm is 135; campuses and hospitals may set their own.', group: 'target' },
  { k: 'waste_target', label: 'Waste target (kg/person/day)', help: 'Optional.', group: 'target' },
]

function SiteProfiles({ flash }: { flash: (m: string) => void }) {
  const [all, setAll] = useState<Record<string, Profile>>({})
  const [area, setArea] = useState<AreaId>(AREAS[0].id)
  const [f, setF] = useState<Record<string, string>>({})
  const fill = (p?: Profile) => setF(Object.fromEntries(PF.map(({ k }) => [k, p == null || p[k] == null || (k === 'population' && p.population_source.startsWith('MVP')) ? '' : String(p[k])])))
  useEffect(() => { api<Record<string, Profile>>('/profiles').then((x) => { setAll(x); fill(x[area]) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (a: AreaId) => { setArea(a); fill(all[a]) }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const body = Object.fromEntries(PF.map(({ k }) => [k, f[k] === '' ? null : Number(f[k])]))
    try { const p = await api<Profile>(`/profiles/${area}`, { method: 'PUT', json: body }); setAll({ ...all, [area]: p }); flash(`${areaName(area)} profile saved`) } catch (err) { flash(err instanceof Error ? err.message : 'Failed') }
  }
  const group = (g: 'site' | 'tariff' | 'target', title: string) => (
    <fieldset className="space-y-2.5"><legend className="mb-1 text-[12px] font-semibold text-white">{title}</legend>
      {PF.filter((x) => x.group === g).map(({ k, label, help }) => (
        <label key={k} className="block text-[11.5px] text-mute">{label}
          <input type="number" step="any" min={0} className={input} value={f[k] ?? ''} placeholder={k === 'population' && all[area]?.population_source.startsWith('MVP') ? 'Not set – using MVP’s 1,000' : ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          <span className="text-[10.5px] text-dim">{help}</span></label>
      ))}
    </fieldset>
  )
  return (
    <Panel className="mt-4">
      <SectionTitle title="Site profiles" sub="Used by Benchmarking, Bills & tariff and the reports. Enter figures from your own records and current bill." right={<div className="flex gap-1.5" role="tablist" aria-label="Site">{AREAS.map((a) => <button key={a.id} role="tab" aria-selected={a.id === area} className={`eiq-btn !py-1 ${a.id === area ? 'eiq-btn-primary' : ''}`} onClick={() => pick(a.id)}>{a.name}</button>)}</div>} />
      <form onSubmit={save} className="p-5" aria-label="Site profile">
        <div className="grid gap-5 lg:grid-cols-3">{group('site', 'Site')}{group('tariff', 'Electricity & water tariff')}{group('target', 'Targets')}</div>
        <div className="mt-4 flex items-center gap-3"><button className="eiq-btn eiq-btn-primary">Save {areaName(area)} profile</button><span className="text-[11px] text-dim">{all[area]?.updated_at ? `Last saved ${all[area].updated_at}` : 'Not saved yet'}</span></div>
      </form>
    </Panel>
  )
}

const Channel = ({ ok, name, detail }: { ok: boolean; name: string; detail: string }) => (
  <div className="summary-card"><div className="flex items-center gap-2 text-[12.5px] font-semibold text-white"><span className={`size-2 rounded-full ${ok ? 'bg-ok' : 'bg-med'}`} />{name}</div><p className="mt-1 text-[11.5px] leading-snug text-mute">{detail}</p></div>
)
