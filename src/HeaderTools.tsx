/** Header: alert bell (in-app alerts + WhatsApp/SMS delivery status) and the signed-in user's menu. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, Check, CheckCheck, KeyRound, LogOut, UserRound, X } from 'lucide-react'
import { api, can, type Alert } from './api'
import { METRICS, areaName } from './eiq'
import { ScreenBadge } from './eui'
import { useSession } from './Session'
import type { Go } from './App'

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k) }
  }, [open, close])
  return ref
}

const DELIVERY_TONE: Record<string, string> = { sent: 'text-ok', failed: 'text-crit', not_configured: 'text-med' }

export function AlertsBell({ go }: { go: Go }) {
  const { user, version } = useSession()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useOutside(open, close)
  const load = useCallback(() => api<Alert[]>('/alerts').then(setAlerts).catch(() => {}), [])
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load, version])
  const openCount = alerts.filter((a) => a.status === 'open').length
  const shown = showAll ? alerts : alerts.filter((a) => a.status !== 'resolved')
  const set = async (a: Alert, status: string) => { await api(`/alerts/${a.id}`, { method: 'PATCH', json: { status } }); load() }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-label={`Alerts, ${openCount} open`} aria-expanded={open} className="relative grid size-8 place-items-center rounded-full border border-line text-mute hover:border-lav/40 hover:text-white">
        <Bell size={15} />
        {openCount > 0 && <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-crit px-1 text-[10px] font-semibold text-white">{openCount}</span>}
      </button>
      {open && (
        <div className="float-glass absolute right-0 z-50 mt-2 w-[420px] max-w-[90vw] rounded-xl p-3" role="dialog" aria-label="Alerts">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Alerts</span>
            <label className="flex items-center gap-1.5 text-[11px] text-mute"><input type="checkbox" className="eiq-toggle" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show resolved</label>
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {!shown.length && <p className="py-6 text-center text-xs text-mute">No alerts. Alerts appear when an uploaded measured reading screens as Watch or High deviation.</p>}
            {shown.map((a) => (
              <div key={a.id} className={`rounded-lg border p-2.5 text-xs ${a.status === 'open' ? 'border-crit/40 bg-crit/5' : 'border-line'}`}>
                <div className="flex flex-wrap items-center gap-2"><ScreenBadge s={a.level} /><span className="text-mute">{areaName(a.area)} · {METRICS[a.metric]?.name ?? a.metric} · {a.month}</span><span className="ml-auto text-[10.5px] text-dim">{a.created_at.slice(0, 16)} UTC</span></div>
                <p className="mt-1.5 leading-snug text-soft">{a.message}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
                  {a.deliveries.length ? a.deliveries.map((d, i) => <span key={i} className={DELIVERY_TONE[d.status] ?? 'text-mute'} title={d.detail}>{d.kind === 'escalation' ? 'Escalated · ' : ''}{d.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} → {d.recipient}: {d.status.replace('_', ' ')}</span>) : <span className="text-dim">No recipients matched this alert (add them in Admin & alerts).</span>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10.5px] text-dim">{a.status === 'open' ? (a.escalated_at ? 'Open · escalated' : 'Open') : `${a.status} by ${a.ack_name ?? '—'}`}</span>
                  <span className="ml-auto flex gap-1.5">
                    {can(user, 'manager') && a.status === 'open' && <button className="eiq-btn !px-2 !py-1" onClick={() => set(a, 'acknowledged')}><Check size={12} />Acknowledge</button>}
                    {can(user, 'manager') && a.status !== 'resolved' && <button className="eiq-btn !px-2 !py-1" onClick={() => set(a, 'resolved')}><CheckCheck size={12} />Resolve</button>}
                    <button className="eiq-btn !px-2 !py-1" onClick={() => { setOpen(false); go('domain', { domain: METRICS[a.metric]?.domain, metric: a.metric }) }}>View</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function UserMenu() {
  const { user, logout } = useSession()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState(false)
  const close = useCallback(() => { setOpen(false); setPw(false) }, [])
  const ref = useOutside(open, close)
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-8 items-center gap-2 rounded-full border border-line pr-3 pl-1 text-xs text-soft hover:border-lav/40">
        <span className="grid size-6 place-items-center rounded-full bg-sapphire/30 text-white"><UserRound size={13} /></span>{user.name}
      </button>
      {open && (
        <div className="float-glass absolute right-0 z-50 mt-2 w-72 rounded-xl p-3 text-xs" role="dialog" aria-label="Account">
          <div className="font-semibold text-white">{user.name}</div>
          <div className="mt-0.5 text-mute">{user.staff_id ?? `@${user.username}`} · {user.job_profile}</div>{user.email && <div className="truncate text-[11px] text-dim">{user.email}</div>}
          <div className="mt-1 text-dim">Sites: {user.areas === '*' ? 'all sites' : user.area_list.map(areaName).join(', ')}</div>
          {pw ? <PasswordForm done={() => setPw(false)} /> : (
            <div className="mt-3 flex gap-2">
              {user.sign_in !== 'google' && <button className="eiq-btn flex-1" onClick={() => setPw(true)}><KeyRound size={12} />Change password</button>}
              <button className="eiq-btn flex-1" onClick={logout}><LogOut size={12} />Sign out</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PasswordForm({ done }: { done: () => void }) {
  const [old, setOld] = useState('')
  const [nw, setNw] = useState('')
  const [msg, setMsg] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try { await api('/me/password', { json: { old, new: nw } }); setMsg('Password changed'); setTimeout(done, 900) } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed') }
  }
  const f = 'mt-1 h-8 w-full rounded-md border border-line bg-panel px-2 text-xs text-fg focus:border-sapphire focus:outline-none'
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label className="block text-mute">Current password<input type="password" className={f} value={old} onChange={(e) => setOld(e.target.value)} required /></label>
      <label className="block text-mute">New password (min 8)<input type="password" className={f} value={nw} onChange={(e) => setNw(e.target.value)} minLength={8} required /></label>
      {msg && <p className="text-[11px] text-lav">{msg}</p>}
      <div className="flex gap-2"><button className="eiq-btn eiq-btn-primary flex-1">Save</button><button type="button" className="eiq-btn" onClick={done}><X size={12} /></button></div>
    </form>
  )
}
