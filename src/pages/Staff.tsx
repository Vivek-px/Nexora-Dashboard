/**
 * Staff & access (Part 1C, admins only): approve people who asked to join with Google, create staff IDs with a
 * one-time password, register emails, and edit job profiles – which pages and domains each job sees.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ClipboardCopy, Copy, KeyRound, MailPlus, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'
import { api, type AccessRequest, type JobProfile, type JobProfiles, type StaffMember } from '../api'
import { areaName, type AreaId } from '../eiq'
import { PAGE_NAME } from '../Indi'
import { SectionTitle } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'
import { Sites } from './Admin'

type Tab = 'requests' | 'staff' | 'profiles'
const field = 'h-9 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none'
const LEVEL = { admin: { label: 'Admin', tone: 'border-orchid/50 text-orchid-soft' }, manager: { label: 'Can change', tone: 'border-sapphire/50 text-sapphire-soft' }, viewer: { label: 'Read-only', tone: 'border-line text-mute' } } as const
const SIGN_IN = { both: 'Google or password', google: 'Google only', password: 'Password only' } as const
const blankStaff = { id: 0, name: '', email: '', phone: '', job_profile_id: 0, areas: '*', sign_in: 'both' as keyof typeof SIGN_IN, active: true }
const blankProfile = { id: 0, name: '', description: '', level: 'viewer' as JobProfile['level'], pages: ['today'] as string[], domains: [] as string[] }

type Cred = { name: string; staff_id: string | null; email: string; password: string | null; own?: boolean }
function Credentials({ c, onClose }: { c: Cred; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Nexora sign-in for ${c.name}\nAddress: ${location.origin}\nStaff ID: ${c.staff_id}\nEmail: ${c.email}\n${c.password ? `One-time password: ${c.password}\n(You will choose your own password at first sign-in.)` : c.own ? 'Sign in with this email and the password you chose when you asked for access.' : 'Sign in with Google using this email.'}`
  return (
    <div className="indi-msg-in mb-4 rounded-2xl border border-ok/40 bg-ok/[0.07] p-4" role="status">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-ok" size={20} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">Give these sign-in details to {c.name}</div>
          <div className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
            <div><span className="text-dim">Staff ID</span><div className="num font-semibold text-white">{c.staff_id}</div></div>
            <div className="min-w-0"><span className="text-dim">Email</span><div className="truncate text-white">{c.email}</div></div>
            <div><span className="text-dim">{c.password ? 'One-time password' : 'Sign-in'}</span><div className="num font-semibold text-gold">{c.password ?? (c.own ? 'Their own password' : 'Google only')}</div></div>
          </div>
          {c.password && <p className="mt-2 text-[11.5px] text-mute">Shown only once. They must choose their own password at first sign-in. Share it privately (in person or a direct message).</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="eiq-btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { /* blocked */ } }}>{copied ? <Check size={13} /> : <ClipboardCopy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" aria-label="Close" className="eiq-btn !px-2" onClick={onClose}><X size={13} /></button>
        </div>
      </div>
    </div>
  )
}

export default function Staff() {
  const { user: me, reload } = useSession()
  const [tab, setTab] = useState<Tab>('staff')
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [reqs, setReqs] = useState<AccessRequest[]>([])
  const [jp, setJp] = useState<JobProfiles | null>(null)
  const [google, setGoogle] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cred, setCred] = useState<Cred | null>(null)
  const [headEmail, setHeadEmail] = useState('')
  const isHead = !!me.is_head
  const [f, setF] = useState(blankStaff)
  const [pf, setPf] = useState(blankProfile)
  const [find, setFind] = useState('')
  const [approve, setApprove] = useState<Record<number, { job_profile_id: number; areas: string; sign_in: 'google' | 'both' | 'password' }>>({})

  const load = () => {
    api<StaffMember[]>('/staff').then(setStaff).catch(() => {})
    api<AccessRequest[]>('/access-requests').then(setReqs).catch(() => {})
    api<JobProfiles>('/job-profiles').then((x) => { setJp(x); setF((s) => (s.job_profile_id ? s : { ...s, job_profile_id: x.profiles.find((p) => p.name === 'Field staff')?.id ?? x.profiles[0].id })) }).catch(() => {})
    api<{ google_client_id: string; head_email: string }>('/auth/config').then((c) => { setGoogle(c.google_client_id); setHeadEmail(c.head_email) }).catch(() => {})
  }
  useEffect(load, [])
  const pending = reqs.filter((r) => r.status === 'pending')
  useEffect(() => { if (pending.length) setTab((t) => (t === 'staff' && !staff.length ? 'requests' : t)) }, [pending.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 5000) }
  const fail = (e: unknown) => flash(false, e instanceof Error ? e.message : 'Failed')
  const profiles = jp?.profiles ?? []
  // What the person asked for (or the admin proposed) is pre-selected for the head.
  const defaults = (r: AccessRequest) => ({
    job_profile_id: r.requested_profile_id ?? profiles.find((p) => p.name === (r.access === 'admin' ? 'Administrator' : 'Field staff'))?.id ?? profiles[0]?.id ?? 0,
    areas: r.proposed_areas || '*',
    sign_in: (r.source === 'google' ? 'google' : r.source === 'signup' ? 'both' : (r.proposed_sign_in || 'both')) as 'google' | 'both' | 'password',
  })
  const prof = (id: number | null) => profiles.find((p) => p.id === id)

  const saveStaff = async (e: FormEvent) => {
    e.preventDefault()
    const { id, ...body } = f
    try {
      const r = await api<StaffMember & { status?: string; message?: string }>(id ? `/staff/${id}` : '/staff', { method: id ? 'PATCH' : 'POST', json: body })
      if (r.status === 'pending') { flash(true, r.message ?? 'Sent to the head for approval'); setF({ ...blankStaff, job_profile_id: f.job_profile_id }); return load() }
      if (!id) setCred({ name: r.name, staff_id: r.staff_id, email: r.email, password: r.temp_password ?? null })
      flash(true, id ? `${r.name} updated` : `${r.name} added as ${r.staff_id}`)
      setF({ ...blankStaff, job_profile_id: f.job_profile_id })
      load()
      if (id === me.id) await reload()
    } catch (err) { fail(err) }
  }
  const resetPw = async (s: StaffMember) => {
    if (!confirm(`Create a new one-time password for ${s.name}? Their current password stops working and they are signed out.`)) return
    try { const r = await api<{ temp_password: string; staff_id: string }>(`/staff/${s.id}/reset-password`, { method: 'POST' }); setCred({ name: s.name, staff_id: r.staff_id, email: s.email, password: r.temp_password }); load() } catch (err) { fail(err) }
  }
  const decide = async (r: AccessRequest, ok: boolean) => {
    try {
      if (!ok) { await api(`/access-requests/${r.id}/reject`, { method: 'POST' }); flash(true, `Request from ${r.email} rejected`); return load() }
      const a = approve[r.id] ?? defaults(r)
      const u = await api<StaffMember & { own_password?: boolean }>(`/access-requests/${r.id}/approve`, { json: a })
      setCred({ name: u.name, staff_id: u.staff_id, email: u.email, password: u.temp_password ?? null, own: u.own_password })
      flash(true, `${u.email} approved as ${prof(u.job_profile_id)?.name ?? 'staff'}`)
      load()
    } catch (err) { fail(err) }
  }
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    const { id, ...body } = pf
    try {
      await api(id ? `/job-profiles/${id}` : '/job-profiles', { method: id ? 'PATCH' : 'POST', json: { ...body, domains: body.domains.length ? body.domains : jp!.domains } })
      flash(true, `Job profile “${pf.name}” saved`); setPf(blankProfile); load()
      if (prof(me.job_profile_id)?.id === id) await reload()
    } catch (err) { fail(err) }
  }
  const delProfile = async (p: JobProfile) => { if (confirm(`Delete the job profile “${p.name}”?`)) { try { await api(`/job-profiles/${p.id}`, { method: 'DELETE' }); load() } catch (err) { fail(err) } } }

  const shown = useMemo(() => staff.filter((s) => !find || `${s.name} ${s.email} ${s.staff_id} ${s.job_profile}`.toLowerCase().includes(find.toLowerCase())), [staff, find])
  const tabBtn = (t: Tab, label: string, n?: number) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${tab === t ? 'bg-sapphire/30 text-white shadow-[inset_0_0_0_1px_rgba(106,140,240,.5)]' : 'text-mute hover:text-fg'}`}>
      {label}{n ? <span className="ml-1.5 rounded-full bg-crit px-1.5 py-px text-[10px] font-bold text-white">{n}</span> : null}
    </button>
  )
  const pageGroups = jp ? [{ title: 'Workspace', ids: jp.workspace }, { title: 'Operations', ids: jp.operations }] : []

  return (
    <>
      <PageHeader eyebrow="Operations" title="Staff & access" desc="Only registered emails can sign in. Create staff IDs, decide what each job sees, and approve people who asked to join with Google." accent="#b65cb9" />
      {msg && <div role="status" className={`sticky top-16 z-30 mb-3 rounded-lg border px-4 py-2 text-sm ${msg.ok ? 'border-ok/40 bg-panel text-ok' : 'border-crit/40 bg-panel text-crit'}`}>{msg.text}</div>}
      <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-[12.5px] ${isHead ? 'border-gold/40 bg-gold/[0.06] text-soft' : 'border-line bg-white/[0.02] text-mute'}`}>
        <ShieldCheck size={18} className={isHead ? 'text-gold' : 'text-mute'} />
        {isHead ? <span><b className="text-gold">You are the head.</b> Every new staff or admin access – sign-ups, Google requests, staff proposed by admins and promotions to admin – waits for your approval.</span>
          : <span>New staff and admin access are approved by the head, <b className="text-soft">{headEmail}</b>. You can propose staff; they appear under Access requests until the head approves.</span>}
      </div>
      {cred && <Credentials c={cred} onClose={() => setCred(null)} />}
      {!google && (
        <div className="mb-4 rounded-xl border border-med/35 bg-med/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-soft">
          <b className="text-med">Sign in with Google is off.</b> Staff can still use their email or staff ID and password. To turn it on: Google Cloud Console → APIs & Services → Credentials → <i>OAuth client ID</i> (Web application), add <code className="rounded bg-white/10 px-1">http://localhost:8000</code> as an authorised JavaScript origin, then put the Client ID in <code className="rounded bg-white/10 px-1">GOOGLE_CLIENT_ID</code> (Nexora.bat → 5) and restart.
        </div>
      )}
      <div role="tablist" className="mb-4 inline-flex gap-1 rounded-xl border border-line bg-ink/40 p-1">
        {tabBtn('requests', 'Access requests', pending.length)}
        {tabBtn('staff', `Staff directory · ${staff.length}`)}
        {tabBtn('profiles', `Job profiles · ${profiles.length}`)}
      </div>

      {tab === 'requests' && (
        <Panel className="overflow-hidden">
          <SectionTitle title="People asking for access" sub={isHead ? 'You are the head: choose each person’s job profile and sites, then approve or reject.' : `Only the head (${headEmail}) can approve. Requests you add as an admin wait here for the head.`} />
          <ul className="divide-y divide-line/50">
            {pending.map((r) => {
              const a = approve[r.id] ?? defaults(r)
              const set = (x: Partial<typeof a>) => setApprove({ ...approve, [r.id]: { ...a, ...x } })
              return (
                <li key={r.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-start">
                  <div className="flex min-w-0 items-center gap-3">
                    {r.picture ? <img src={r.picture} alt="" referrerPolicy="no-referrer" className="size-10 rounded-full" /> : <span className="grid size-10 place-items-center rounded-full bg-lav/20 text-sm font-bold text-white">{(r.name || r.email)[0].toUpperCase()}</span>}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[13.5px] font-semibold text-white">{r.name || '—'}</span>
                        <span className={`rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase ${r.access === 'admin' ? 'border-orchid/50 text-orchid-soft' : 'border-sapphire/50 text-sapphire-soft'}`}>{r.access === 'admin' ? 'Admin access' : 'Staff access'}</span></div>
                      <div className="truncate text-[12px] text-mute">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div>
                      <div className="text-[10.5px] text-dim">{r.source === 'signup' ? 'Create access ID form' : r.source === 'google' ? 'Sign in with Google (email verified by Google)' : `Proposed by ${r.proposed_by_name ?? 'an admin'}`} · {r.created_at.slice(0, 16).replace('T', ' ')}</div>
                      {(r.job_title || r.requested_profile || r.note) && <div className="mt-1 text-[11.5px] text-soft">{[r.job_title, r.requested_profile && `asked for: ${r.requested_profile}`, r.note && `“${r.note}”`].filter(Boolean).join(' · ')}</div>}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-mute">Job profile<select className={field} value={a.job_profile_id} onChange={(e) => set({ job_profile_id: Number(e.target.value) })}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label className="text-[11px] text-mute">Sign-in<select className={field} value={a.sign_in} onChange={(e) => set({ sign_in: e.target.value as 'google' | 'both' | 'password' })}>{Object.entries(SIGN_IN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <div className="sm:col-span-2"><div className="mb-1 text-[11px] text-mute">Sites</div><Sites value={a.areas} onChange={(v) => set({ areas: v })} /></div>
                    <p className="text-[11px] text-dim sm:col-span-2">{prof(a.job_profile_id)?.description}</p>
                  </div>
                  <div className="flex gap-2 lg:flex-col" title={isHead ? undefined : `Only the head (${headEmail}) can approve`}><button className="eiq-btn eiq-btn-primary" disabled={!isHead} onClick={() => decide(r, true)}><Check size={13} />Approve</button><button className="eiq-btn" disabled={!isHead} onClick={() => decide(r, false)}><X size={13} />Reject</button></div>
                </li>
              )
            })}
            {!pending.length && <li className="p-8 text-center text-sm text-mute">No pending requests.{google ? '' : ' (Requests appear here once Sign in with Google is turned on.)'}</li>}
          </ul>
          {reqs.some((r) => r.status !== 'pending') && <p className="border-t border-line/50 px-5 py-3 text-[11.5px] text-dim">Recently decided: {reqs.filter((r) => r.status !== 'pending').slice(0, 6).map((r) => `${r.email} (${r.status})`).join(' · ')}</p>}
        </Panel>
      )}

      {tab === 'staff' && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel className="overflow-hidden">
            <SectionTitle title="Staff directory" sub="Everyone who can sign in, their job profile and sites" right={<label className="relative w-60"><Search size={13} className="absolute top-2.5 left-2.5 text-dim" /><input className={`${field} pl-8`} placeholder="Search name, email, ID…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search staff" /></label>} />
            <div className="overflow-x-auto"><table className="eiq-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Email</th><th>Job profile</th><th>Sites</th><th>Sign-in</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>{shown.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                  <td className="num whitespace-nowrap text-white">{s.staff_id}</td>
                  <td className="whitespace-nowrap text-white">{s.name}{s.is_head ? <span className="ml-1.5 rounded border border-gold/50 px-1 text-[9.5px] font-semibold text-gold">HEAD</span> : null}{s.id === me.id && <span className="ml-1.5 text-[10px] text-dim">(you)</span>}{s.must_change ? <span className="ml-1.5 rounded border border-med/40 px-1 text-[9.5px] text-med">first sign-in pending</span> : null}</td>
                  <td className="text-[12px]">{s.email || <span className="text-med">no email</span>}</td>
                  <td className="whitespace-nowrap"><span className={`mr-1.5 rounded border px-1 text-[9.5px] ${LEVEL[s.role].tone}`}>{LEVEL[s.role].label}</span>{s.job_profile}</td>
                  <td className="text-[11px]">{s.areas === '*' ? 'All' : s.area_list.map((a) => areaName(a as AreaId)).join(', ')}</td>
                  <td className="text-[11px] whitespace-nowrap">{SIGN_IN[s.sign_in]}{s.google_linked ? ' · linked' : ''}</td>
                  <td className="num text-[11px] whitespace-nowrap">{s.last_login?.slice(0, 16) ?? 'never'}</td>
                  <td className="whitespace-nowrap"><button className="eiq-btn !px-2 !py-1" onClick={() => setF({ id: s.id, name: s.name, email: s.email, phone: s.phone, job_profile_id: s.job_profile_id ?? 0, areas: s.areas, sign_in: s.sign_in, active: !!s.active })}><Pencil size={12} />Edit</button> {s.sign_in !== 'google' && <button className="eiq-btn !px-2 !py-1" title="New one-time password" onClick={() => resetPw(s)}><KeyRound size={12} /></button>}</td>
                </tr>))}
                {!shown.length && <tr><td colSpan={8} className="py-6 text-center text-mute">No staff match.</td></tr>}</tbody></table></div>
          </Panel>
          <Panel>
            <SectionTitle title={f.id ? `Edit ${f.name}` : 'Add staff'} sub={f.id ? 'Changes apply at their next page load. Giving or removing admin access needs the head.' : isHead ? 'A staff ID and a one-time password are generated' : `Sent to the head (${headEmail}) for approval first`} />
            <form onSubmit={saveStaff} className="space-y-3 p-5" aria-label="Staff member">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[11.5px] text-mute">Full name<input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
                <label className="text-[11.5px] text-mute">Email (registered for sign-in)<input type="email" className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required placeholder="name@gmail.com or work email" /></label>
                <label className="text-[11.5px] text-mute">Phone<input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
                <label className="text-[11.5px] text-mute">Sign-in<select className={field} value={f.sign_in} onChange={(e) => setF({ ...f, sign_in: e.target.value as keyof typeof SIGN_IN })}>{Object.entries(SIGN_IN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              </div>
              <label className="block text-[11.5px] text-mute">Job profile<select className={field} value={f.job_profile_id} onChange={(e) => setF({ ...f, job_profile_id: Number(e.target.value) })}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {prof(f.job_profile_id) && (
                <div className="rounded-lg border border-line/60 bg-white/[0.02] p-3 text-[11.5px] text-mute">
                  <div className="text-soft">{prof(f.job_profile_id)!.description}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">{prof(f.job_profile_id)!.pages.map((p) => <span key={p} className="rounded bg-sapphire/15 px-1.5 py-px text-[10.5px] text-sapphire-soft">{PAGE_NAME[p] ?? p}</span>)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">{prof(f.job_profile_id)!.domains.map((d) => <span key={d} className="rounded bg-gold/10 px-1.5 py-px text-[10.5px] text-gold">{d}</span>)}</div>
                </div>
              )}
              <div><div className="mb-1 text-[11.5px] text-mute">Sites</div><Sites value={f.areas} onChange={(v) => setF({ ...f, areas: v })} /></div>
              {f.id > 0 && <label className="flex items-center gap-2 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active (can sign in)</label>}
              <div className="flex gap-2"><button className="eiq-btn eiq-btn-primary flex-1">{f.id ? <><Check size={13} />Save changes</> : isHead ? <><UserPlus size={13} />Create staff ID</> : <><UserPlus size={13} />Send to head for approval</>}</button>{f.id > 0 && <button type="button" className="eiq-btn" onClick={() => setF({ ...blankStaff, job_profile_id: f.job_profile_id })}>Cancel</button>}</div>
            </form>
          </Panel>
        </div>
      )}

      {tab === 'profiles' && jp && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3 md:grid-cols-2">
            {profiles.map((p) => (
              <Panel key={p.id} className="p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold text-white">{p.name}</div><div className="mt-0.5 text-[11.5px] text-mute">{p.description}</div></div>
                  <span className={`shrink-0 rounded border px-1.5 py-px text-[10px] ${LEVEL[p.level].tone}`}>{LEVEL[p.level].label}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">{p.pages.map((x) => <span key={x} className="rounded bg-sapphire/15 px-1.5 py-px text-[10.5px] text-sapphire-soft">{PAGE_NAME[x] ?? x}</span>)}</div>
                <div className="mt-1 flex flex-wrap gap-1">{p.domains.length === jp.domains.length ? <span className="rounded bg-gold/10 px-1.5 py-px text-[10.5px] text-gold">All 8 domains</span> : p.domains.map((d) => <span key={d} className="rounded bg-gold/10 px-1.5 py-px text-[10.5px] text-gold">{d}</span>)}</div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-dim">{p.staff} staff{p.builtin ? ' · built-in' : ''}
                  <span className="ml-auto flex gap-1">
                    <button className="eiq-btn !px-2 !py-1" onClick={() => setPf({ id: p.id, name: p.name, description: p.description, level: p.level, pages: p.pages, domains: p.domains })}><Pencil size={12} />Edit</button>
                    <button className="eiq-btn !px-2 !py-1" title="Copy as a new profile" onClick={() => setPf({ id: 0, name: `${p.name} (copy)`, description: p.description, level: p.level, pages: p.pages, domains: p.domains })}><Copy size={12} /></button>
                    {!p.builtin && <button className="eiq-btn !px-2 !py-1" aria-label="Delete" onClick={() => delProfile(p)}><Trash2 size={12} /></button>}
                  </span>
                </div>
              </Panel>
            ))}
          </div>
          <Panel className="self-start">
            <SectionTitle title={pf.id ? `Edit “${pf.name}”` : 'New job profile'} sub="What this job sees in the menus – the server enforces the same rules" right={pf.id ? <button className="eiq-btn !px-2 !py-1" onClick={() => setPf(blankProfile)}><Plus size={12} />New</button> : undefined} />
            <form onSubmit={saveProfile} className="space-y-3 p-5" aria-label="Job profile">
              <label className="block text-[11.5px] text-mute">Name<input className={field} value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} required minLength={2} placeholder="e.g. Pump house operator" /></label>
              <label className="block text-[11.5px] text-mute">Description<input className={field} value={pf.description} onChange={(e) => setPf({ ...pf, description: e.target.value })} maxLength={300} /></label>
              <label className="block text-[11.5px] text-mute">Permission level<select className={field} value={pf.level} onChange={(e) => setPf({ ...pf, level: e.target.value as JobProfile['level'] })}><option value="viewer">Read-only – can view and file complaints</option><option value="manager">Can change – upload data, manage actions, alerts, savings</option><option value="admin" disabled={!isHead}>Admin – also staff, alerts and site settings{isHead ? '' : ' (head only)'}</option></select></label>
              {pageGroups.map((g) => (
                <fieldset key={g.title}><legend className="mb-1 text-[11.5px] text-mute">{g.title} pages</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">{g.ids.map((id) => {
                    const adminOnly = jp.admin_only.includes(id) && pf.level !== 'admin'
                    return <label key={id} className={`flex items-center gap-1.5 text-[12px] ${adminOnly ? 'text-disabled' : 'text-soft'}`} title={adminOnly ? 'Admin level only' : undefined}><input type="checkbox" className="eiq-toggle" disabled={adminOnly} checked={pf.pages.includes(id) && !adminOnly} onChange={(e) => setPf({ ...pf, pages: e.target.checked ? [...pf.pages, id] : pf.pages.filter((x) => x !== id) })} />{PAGE_NAME[id] ?? id}</label>
                  })}</div>
                </fieldset>
              ))}
              <fieldset><legend className="mb-1 flex w-full items-center text-[11.5px] text-mute">Domains<button type="button" className="ml-auto text-[11px] text-lav underline" onClick={() => setPf({ ...pf, domains: pf.domains.length === jp.domains.length ? [] : jp.domains })}>{pf.domains.length === jp.domains.length ? 'Clear' : 'All domains'}</button></legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">{jp.domains.map((d) => <label key={d} className="flex items-center gap-1.5 text-[12px] text-soft"><input type="checkbox" className="eiq-toggle" checked={pf.domains.includes(d)} onChange={(e) => setPf({ ...pf, domains: e.target.checked ? [...pf.domains, d] : pf.domains.filter((x) => x !== d) })} />{d}</label>)}</div>
                {!pf.domains.length && <p className="mt-1 text-[11px] text-dim">None ticked = all domains.</p>}
              </fieldset>
              <p className="text-[11px] text-dim">Tip: domain-limited jobs usually skip <i>Command Center</i> and <i>Geographic Intelligence</i>, which show all eight domains at once.</p>
              <button className="eiq-btn eiq-btn-primary w-full"><MailPlus size={13} />{pf.id ? 'Save job profile' : 'Create job profile'}</button>
            </form>
          </Panel>
        </div>
      )}
    </>
  )
}
