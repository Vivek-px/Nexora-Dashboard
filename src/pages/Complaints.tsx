/** Feature 11: staff complaints with photo and map pin. Every complaint becomes a tracked action. */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArchiveRestore, ArrowRight, Ban, Camera, ImageIcon, MapPin, Trash2, X } from 'lucide-react'
import { api, can, fileUrl, type ActionState, type Complaint } from '../api'
import { AREAS, actionId, areaName, areasOf, type AreaId, type Selection } from '../eiq'
import { complaintAction } from '../complaints'
import { STATUS_TONE } from '../ActionTracker'
import { SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'
import { PinPicker } from '../stationMap'
import LocationPicker, { type Spot } from '../LocationPicker'
import type { Go } from '../App'

const input = 'h-9 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-fg focus:border-sapphire focus:outline-none'
const SEV_TONE = { High: 'border-crit/50 text-crit', Medium: 'border-med/50 text-med', Low: 'border-line text-mute' } as const

export default function Complaints({ sel, go }: { sel: Selection; go: Go }) {
  const { version, user } = useSession()
  const allowed = user.areas === '*' ? AREAS.map((a) => a.id) : (user.area_list as AreaId[])
  const choices = areasOf(sel).filter((a) => allowed.includes(a))
  const [meta, setMeta] = useState<{ categories: string[]; severities: string[] }>({ categories: [], severities: ['Low', 'Medium', 'High'] })
  const [list, setList] = useState<Complaint[]>([])
  const [states, setStates] = useState<Record<string, ActionState>>({})
  const [area, setArea] = useState<AreaId>(choices[0] ?? allowed[0])
  const [category, setCategory] = useState('')
  const [severity, setSeverity] = useState('Medium')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [pin, setPin] = useState<Spot | null>(null)
  const [photoErr, setPhotoErr] = useState('')
  // Browsers can preview most photos; HEIC/TIFF are converted to JPEG by the server after upload.
  const preview = useMemo(() => (photo && /^image\/(jpeg|png|webp|gif|avif|bmp|svg\+xml)$/.test(photo.type) ? URL.createObjectURL(photo) : ''), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const pickPhoto = (f: File | undefined) => {
    setPhotoErr('')
    if (!f) return
    if (f.size > 8 * 1024 * 1024) { setPhoto(null); return setPhotoErr(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB – the limit is 8 MB. Use a smaller photo.`) }
    if (f.type && !f.type.startsWith('image/') && !/\.(heic|heif|jfif|avif|tiff?|bmp|webp)$/i.test(f.name)) { setPhoto(null); return setPhotoErr('Please choose a photo or picture file.') }
    setPhoto(f)
  }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'open' | 'dismissed'>('open')
  const [dismissing, setDismissing] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [listMsg, setListMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const canManage = can(user, 'manager')
  const isAdmin = can(user, 'admin')

  const load = () => {
    api<Complaint[]>('/complaints').then(setList).catch(() => {})
    api<Record<string, ActionState>>('/actions').then(setStates).catch(() => {})
  }
  useEffect(() => { api<typeof meta>('/complaints/meta').then((m) => { setMeta(m); setCategory((c) => c || m.categories[0]) }).catch(() => {}) }, [])
  useEffect(load, [version])
  useEffect(() => { if (choices.length && !choices.includes(area)) { setArea(choices[0]); setPin(null) } }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const f = new FormData()
    f.append('area', area); f.append('category', category); f.append('severity', severity); f.append('title', title.trim()); f.append('description', desc.trim())
    if (pin) { f.append('lat', String(pin.lat)); f.append('lon', String(pin.lon)); f.append('place', pin.place.slice(0, 300)); f.append('loc_source', pin.source) }
    if (photo) f.append('photo', photo)
    setBusy(true)
    try {
      const c = await api<Complaint>('/complaints', { form: f })
      setMsg({ ok: true, text: `Complaint #${c.id} logged. It is now an action in Recommendations → action tracker.` })
      setTitle(''); setDesc(''); setPhoto(null); setPin(null); setSeverity('Medium'); setPhotoErr('')
      load()
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save the complaint' }) } finally { setBusy(false) }
  }

  const inSel = list.filter((c) => areasOf(sel).includes(c.area))
  const openList = inSel.filter((c) => c.status !== 'dismissed')
  const dismissedList = inSel.filter((c) => c.status === 'dismissed')
  const shown = view === 'open' ? openList : dismissedList
  const note = (ok: boolean, text: string) => { setListMsg({ ok, text }); setTimeout(() => setListMsg(null), 4000) }
  const dismiss = async (c: Complaint) => {
    try { await api(`/complaints/${c.id}/dismiss`, { json: { reason: reason.trim(), action_id: actionId(complaintAction(c)) } }); note(true, `Complaint #${c.id} dismissed – removed from Today, Recommendations and Indi. Find it under Dismissed.`); setDismissing(null); setReason(''); load() } catch (e) { note(false, e instanceof Error ? e.message : 'Failed') }
  }
  const restore = async (c: Complaint) => {
    try { await api(`/complaints/${c.id}/restore`, { json: { action_id: actionId(complaintAction(c)) } }); note(true, `Complaint #${c.id} restored to Open.`); load() } catch (e) { note(false, e instanceof Error ? e.message : 'Failed') }
  }
  const remove = async (c: Complaint) => {
    if (!confirm(`Delete complaint #${c.id} “${c.title}” permanently?\n\nThis removes it from every page and report, with its photo and its action history and proof files. It cannot be undone.`)) return
    try { await api(`/complaints/${c.id}?action_id=${encodeURIComponent(actionId(complaintAction(c)))}`, { method: 'DELETE' }); note(true, `Complaint #${c.id} deleted permanently.`); load() } catch (e) { note(false, e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <>
      <PageHeader eyebrow="Operations" title="Staff complaints" desc="Anyone on site can report a problem with a photo and a map pin. Each complaint becomes an action with an owner, a due date and proof of fix in the action tracker." accent="#ff8f6b" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel>
          <SectionTitle title="Report a problem" sub="Mark where it is, describe it, add a photo – the team gets it as a tracked action" />
          {!choices.length ? <p className="p-5 text-sm text-mute">You don’t have access to the selected site.</p> : (
            <form onSubmit={submit} className="space-y-3 p-5" aria-label="Report a problem">
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label="Site" value={area} options={choices} onChange={(v) => setArea(v)} format={(v) => areaName(v)} />
                <Select label="Category" value={category} options={meta.categories} onChange={setCategory} />
                <Select label="Severity" value={severity} options={meta.severities} onChange={setSeverity} format={(s) => (s === 'High' ? 'High – urgent' : s)} />
              </div>
              <LocationPicker area={area} sites={choices} value={pin} onChange={setPin} onSuggestSite={setArea} />
              <label className="block text-[11px] font-medium text-mute">What is the problem?<input className={input} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={150} placeholder="e.g. Pipe leaking near Block C pump room" /></label>
              <label className="block text-[11px] font-medium text-mute">Details (optional)<textarea className={`${input} h-20 py-2`} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={3000} placeholder="Since when, how bad, anything already tried" /></label>
              <div>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-[12.5px] text-soft transition-colors hover:border-lav/50 hover:bg-white/[0.02]">
                  {preview ? <img src={preview} alt="Selected photo" className="size-12 shrink-0 rounded-md border border-line object-cover" /> : photo ? <span className="grid size-12 shrink-0 place-items-center rounded-md border border-line text-lav"><ImageIcon size={18} /></span> : <Camera size={16} className="shrink-0 text-lav" />}
                  <span className="min-w-0 flex-1">{photo ? <><span className="block truncate text-white">{photo.name}</span><span className="text-[11px] text-dim">{(photo.size / 1024 / 1024).toFixed(1)} MB{preview ? '' : ' · preview not available here, it will be converted to JPEG'}</span></> : <>Add a photo<span className="block text-[11px] text-dim">Any image type – JPG, PNG, HEIC (phone), WebP, GIF, BMP, TIFF, AVIF – up to 8 MB</span></>}</span>
                  <input type="file" accept="image/*,.heic,.heif,.jfif,.avif,.tif,.tiff,.bmp" className="sr-only" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
                  {photo && <button type="button" aria-label="Remove photo" className="ml-auto text-dim hover:text-fg" onClick={(e) => { e.preventDefault(); setPhoto(null) }}><X size={14} /></button>}
                </label>
                {photoErr && <p role="alert" className="mt-1.5 text-[12px] text-crit">{photoErr}</p>}
              </div>
              {msg && <p role="status" className={`rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-crit/40 bg-crit/10 text-crit'}`}>{msg.text}</p>}
              <button className="eiq-btn eiq-btn-primary w-full" disabled={busy || !category}>{busy ? 'Saving…' : 'Submit complaint'}</button>
            </form>
          )}
        </Panel>
        <Panel className="overflow-hidden">
          <SectionTitle title="Logged complaints" sub={view === 'open' ? 'Status comes from the action tracker' : 'Dismissed complaints are hidden from Today, Recommendations and Indi'} right={user.pages.includes('recs') ? <button className="eiq-btn" onClick={() => go('recs')}>Action tracker<ArrowRight size={12} /></button> : undefined} />
          <div className="flex items-center gap-1 border-b border-line/50 px-4 py-2" role="tablist" aria-label="Complaint lists">
            {([['open', `Open · ${openList.length}`], ['dismissed', `Dismissed · ${dismissedList.length}`]] as const).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${view === v ? 'bg-sapphire/30 text-white shadow-[inset_0_0_0_1px_rgba(106,140,240,.5)]' : 'text-mute hover:text-fg'}`}>{label}</button>
            ))}
          </div>
          {listMsg && <p role="status" className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-[12px] ${listMsg.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-crit/40 bg-crit/10 text-crit'}`}>{listMsg.text}</p>}
          <ul className="divide-y divide-line/50">
            {shown.map((c) => {
              const st = states[actionId(complaintAction(c))]
              const status = st?.status ?? 'Open'
              const k = String(c.id)
              return (
                <li key={c.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {c.photo ? <a href={fileUrl(c.photo)} target="_blank" rel="noopener"><img src={fileUrl(c.photo)} alt={`Photo for complaint ${c.id}`} className="size-16 shrink-0 rounded-lg border border-line object-cover" /></a>
                      : <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-line text-dim"><Camera size={18} /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-white">#{c.id} · {c.title}</span>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${SEV_TONE[c.severity]}`}>{c.severity}</span>
                        {c.status === 'dismissed' ? <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-dim">Dismissed</span> : <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[status] ?? ''}`}>{status}</span>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-mute">{areaName(c.area)} · {c.category} · {c.reporter ?? 'staff'} · {c.created_at.slice(0, 16).replace('T', ' ')}{st?.owner_name ? ` · owner ${st.owner_name}` : ''}{st?.due_date ? ` · due ${st.due_date}` : ''}</div>
                      {c.description && <p className="mt-1 text-[12px] text-soft">{c.description}</p>}
                      {c.place && <p className="mt-1 line-clamp-1 text-[11.5px] text-mute" title={c.place}>📍 {c.place}</p>}
                      {c.status === 'dismissed' && <p className="mt-1 text-[11.5px] text-dim">Dismissed {c.dismissed_at?.slice(0, 16)}{c.dismiss_reason ? ` – “${c.dismiss_reason}”` : ''}</p>}
                      {c.lat != null && (
                        <button className="mt-1 flex items-center gap-1 text-[11.5px] text-lav underline" onClick={() => setOpen(open === k ? null : k)}><MapPin size={12} />{open === k ? 'Hide map' : `Pin ${c.lat.toFixed(5)}, ${c.lon!.toFixed(5)}`}</button>
                      )}
                    </div>
                    {(canManage || isAdmin) && (
                      <div className="flex shrink-0 flex-col gap-1.5">
                        {c.status !== 'dismissed' && canManage && <button type="button" className="eiq-btn !px-2 !py-1" onClick={() => { setDismissing(dismissing === c.id ? null : c.id); setReason('') }}><Ban size={12} />Dismiss</button>}
                        {c.status === 'dismissed' && canManage && <button type="button" className="eiq-btn !px-2 !py-1" onClick={() => restore(c)}><ArchiveRestore size={12} />Restore</button>}
                        {isAdmin && <button type="button" className="eiq-btn !border-crit/40 !px-2 !py-1 !text-crit hover:!bg-crit/10" onClick={() => remove(c)} title="Delete permanently from everywhere"><Trash2 size={12} />Delete</button>}
                      </div>
                    )}
                  </div>
                  {dismissing === c.id && (
                    <form onSubmit={(e) => { e.preventDefault(); dismiss(c) }} className="indi-msg-in mt-3 flex gap-2 rounded-lg border border-line/70 bg-white/[0.02] p-2.5" aria-label={`Dismiss complaint ${c.id}`}>
                      <input autoFocus className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (optional) – e.g. duplicate, not our site, already fixed" aria-label="Reason for dismissing" />
                      <button className="eiq-btn eiq-btn-primary shrink-0">Dismiss everywhere</button>
                      <button type="button" className="eiq-btn shrink-0 !px-2" aria-label="Cancel" onClick={() => setDismissing(null)}><X size={13} /></button>
                    </form>
                  )}
                  {open === k && c.lat != null && <div className="mt-3"><PinPicker area={c.area} value={{ lat: c.lat, lon: c.lon! }} onChange={() => {}} height={220} /></div>}
                </li>
              )
            })}
            {!shown.length && <li className="p-8 text-center text-sm text-mute">{view === 'open' ? 'No open complaints for this selection.' : 'No dismissed complaints.'}</li>}
          </ul>
        </Panel>
      </div>
    </>
  )
}
