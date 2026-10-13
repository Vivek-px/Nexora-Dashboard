/** Feature 3: turn a recommendation into tracked work – owner, due date, status, comments and closing proof. */
import { useState } from 'react'
import { History, Paperclip } from 'lucide-react'
import { api, can, fileUrl, type ActionState, type UserBrief } from './api'
import type { Action } from './eiq'
import { useSession } from './Session'

export const STATUSES = ['Open', 'In progress', 'Done', 'Dismissed'] as const
export const STATUS_TONE: Record<string, string> = {
  Open: 'border-line text-mute', 'In progress': 'border-sapphire/50 bg-sapphire/15 text-sapphire-soft', Done: 'border-ok/40 bg-ok/10 text-ok', Dismissed: 'border-line text-dim', Overdue: 'border-crit/40 bg-crit/10 text-crit',
}
const today = () => new Date().toISOString().slice(0, 10)
export const isOverdue = (s?: ActionState) => !!s?.due_date && s.due_date < today() && !['Done', 'Dismissed'].includes(s.status)

export function ActionTracker({ id, action, state, users, onChange }: { id: string; action: Action; state?: ActionState; users: UserBrief[]; onChange: (s: ActionState) => void }) {
  const { user } = useSession()
  const editable = can(user, 'manager')
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // A staff complaint's action carries its complaint number, so dismissing here dismisses the complaint everywhere.
  const complaintId = action['Action type'] === 'Staff complaint' ? Number(action.Source.match(/^Complaint #(\d+)/)?.[1]) || undefined : undefined
  const base = { area: action.area_id, title: action['Recommended action'].slice(0, 300), ...(complaintId ? { complaint_id: complaintId } : {}) }
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErr('')
    try { onChange(await api<ActionState>(`/actions/${id}`, { method: 'PATCH', json: { ...base, ...body } })) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  const proof = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) return setErr(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB – the limit is 8 MB.`)
    const form = new FormData(); form.append('file', f); form.append('area', base.area); form.append('title', base.title); form.append('text', comment || f.name)
    setBusy(true); setErr('')
    try { onChange(await api<ActionState>(`/actions/${id}/proof`, { form })); setComment('') } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(false) }
  }
  const status = state?.status ?? 'Open'
  const sel = 'h-8 rounded-md border border-line bg-panel px-2 text-[11.5px] text-fg focus:border-sapphire focus:outline-none disabled:opacity-60'
  return (
    <div className="mt-3 border-t border-line/60 pt-3 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${STATUS_TONE[isOverdue(state) ? 'Overdue' : status]}`}>{isOverdue(state) ? 'Overdue' : status}</span>
        <select aria-label="Status" className={sel} disabled={!editable || busy} value={status} onChange={(e) => patch({ status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Owner" className={sel} disabled={!editable || busy} value={state?.owner_id ?? ''} onChange={(e) => (e.target.value ? patch({ owner_id: Number(e.target.value) }) : patch({ clear_owner: true }))}>
          <option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input aria-label="Due date" type="date" className={`${sel} [color-scheme:dark]`} disabled={!editable || busy} value={state?.due_date ?? ''} onChange={(e) => patch({ due_date: e.target.value })} />
        <button className="ml-auto flex items-center gap-1 text-lav hover:text-white" onClick={() => setOpen(!open)} aria-expanded={open}><History size={12} />{state?.events.length ?? 0} updates</button>
      </div>
      {editable && (
        <div className="mt-2 flex gap-2">
          <input className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-[11.5px] text-fg focus:border-sapphire focus:outline-none" placeholder="Add a comment or what was done…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) { patch({ comment }); setComment('') } }} />
          <button className="eiq-btn !py-1" disabled={busy || !comment.trim()} onClick={() => { patch({ comment }); setComment('') }}>Add</button>
          <label className="eiq-btn cursor-pointer !py-1" title="Attach closing proof: any photo or a PDF, up to 8 MB"><Paperclip size={12} />Proof<input type="file" accept="image/*,.heic,.heif,.jfif,.avif,.tif,.tiff,.bmp,.pdf" className="sr-only" onChange={(e) => { proof(e.target.files?.[0]); e.target.value = "" }} /></label>
        </div>
      )}
      {err && <p className="mt-1 text-crit">{err}</p>}
      {open && (
        <ul className="mt-2 space-y-1 border-l border-line pl-3">
          {(state?.events ?? []).slice().reverse().map((e) => (
            <li key={e.id} className="text-mute"><span className="text-dim">{e.created_at.slice(0, 16)} · {e.user_name}:</span> {e.kind === 'proof'
              ? <a className="text-lav hover:text-white" href={fileUrl(e.file)} target="_blank" rel="noreferrer">📎 {e.text}</a> : <span className="text-soft">{e.text}</span>}</li>
          ))}
          {!state?.events.length && <li className="text-dim">No updates yet.</li>}
        </ul>
      )}
    </div>
  )
}
