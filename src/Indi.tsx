/**
 * Indi – the dashboard assistant, docked on the right side of the screen (Part 1C).
 * Answers come from Groq through the Nexora server (the key never reaches the browser) and are grounded in the
 * page on screen plus the user's own site data. Collapsed, Indi waits in a slim rail; the sidebar logo toggles it.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronsRight, Copy, Crosshair, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { api, ApiError, indiChat, type IndiMsg, type IndiStatus } from './api'
import { areaName, type Selection } from './eiq'
import { useSession } from './Session'

type Mood = 'idle' | 'curious' | 'thinking' | 'investigate' | 'concerned' | 'point' | 'celebrate'
type Pt = { x: number; y: number }

export const PAGE_NAME: Record<string, string> = { today: 'Today', command: 'Command Center', geo: 'Geographic Intelligence', domain: 'Domain Intelligence', forecast: 'Forecasts & Anomalies', scenario: 'Scenario Lab', recs: 'Recommendations', method: 'Data & Methodology', upload: 'Data upload', savings: 'Savings tracker', admin: 'Admin & alerts', complaints: 'Staff complaints', bills: 'Bills & tariff', benchmarks: 'Benchmarking', reports: 'Reports', staff: 'Staff & access' }

const PROMPTS: Record<string, string[]> = {
  today: ['What should I fix first today?', 'Summarise today in three lines'],
  command: ['Which site needs attention most, and why?', 'Give me a 30-second summary of all sites'],
  geo: ['Which monitoring stations cover each area?', 'How far is each station from its area?'],
  domain: ['Explain the latest trend on this page', 'Which numbers here are real measurements?'],
  forecast: ['Explain the high deviations', 'How reliable are these forecasts?'],
  scenario: ['How do I test a 20% cut in electricity?', 'What does the scenario band mean?'],
  recs: ['What are the top 3 actions to do first?', 'Which actions are overdue?'],
  method: ['What is demonstration data?', 'Which figures are official?'],
  upload: ['What file format should I upload?', 'What happens after I upload readings?'],
  savings: ['How is a saving calculated?', 'How do I prove a saving to finance?'],
  admin: ['How do I set up WhatsApp alerts?', 'What can each role do?'],
  complaints: ['Which complaints are urgent?', 'How do I report a problem with a photo?'],
  bills: ['Why did my electricity bill change?', 'Am I paying contract-demand penalties?'],
  benchmarks: ['How does our water use compare with 135 L/person/day?', 'Which site is least efficient?'],
  reports: ['What goes into the BRSR data pack?', 'Can I file this report as-is?'],
  staff: ['Which job profile fits a pump operator?', 'How does Sign in with Google work here?'],
}
const HIST = 'indi-chat'
const OPEN = 'indi-open'
const store = {
  get: (s: Storage, k: string) => { try { return s.getItem(k) } catch { return null } },
  set: (s: Storage, k: string, v: string) => { try { s.setItem(k, v) } catch { /* private mode */ } },
}
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tiny, safe formatter for Indi's replies: paragraphs, "-" bullets, numbered steps, **bold** and `code`. */
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i} className="rounded bg-white/10 px-1 text-[11.5px]">{part.slice(1, -1)}</code>
        : <Fragment key={i}>{part}</Fragment>)
}
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={blocks.length} className={`my-1.5 space-y-1 pl-4 ${list.ordered ? 'list-decimal' : 'list-disc'} marker:text-lav`}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</L>)
    list = null
  }
  for (const raw of text.replace(/^#{1,6}\s+/gm, '').split('\n')) {
    const line = raw.trimEnd()
    const b = line.match(/^\s*[-*•]\s+(.*)$/)
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (b || n) {
      const ordered = !!n
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((b ?? n)![1])
    } else if (line.trim()) {
      flush()
      blocks.push(<p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">{inline(line)}</p>)
    } else flush()
  }
  flush()
  return <>{blocks}</>
}

export default function Indi({ page, domain, domainName, go, sel, years }: { page: string; domain: string | null; domainName: string; go: (p: string) => void; sel: Selection; years: number[] }) {
  const { user } = useSession()
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1280px)').matches)
  const [open, setOpen] = useState(() => { const v = store.get(localStorage, OPEN); return v == null ? window.matchMedia('(min-width: 1280px)').matches : v === '1' })
  const [status, setStatus] = useState<IndiStatus | null>(null)
  const [msgs, setMsgs] = useState<IndiMsg[]>(() => { try { return JSON.parse(store.get(sessionStorage, HIST) ?? '[]') } catch { return [] } })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [focus, setFocus] = useState<{ label: string; value: string } | null>(null)
  const [toast, setToast] = useState('')
  const [mood, setMood] = useState<Mood>('idle')
  const [look, setLook] = useState<Pt>({ x: 0, y: 0 })
  const [copied, setCopied] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const avatar = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => { api<IndiStatus>('/indi/status').then(setStatus).catch(() => setStatus(null)) }, [])
  useEffect(() => { store.set(localStorage, OPEN, open ? '1' : '0') }, [open])
  useEffect(() => { if (!busy) store.set(sessionStorage, HIST, JSON.stringify(msgs.slice(-30))) }, [msgs, busy])
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const f = () => setWide(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  // The sidebar logo (and Ctrl + /) open or close Indi.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o)
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggle() } }
    window.addEventListener('indi:toggle', toggle)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('indi:toggle', toggle); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => { if (open) setTimeout(() => input.current?.focus({ preventScroll: true }), 220) }, [open])
  useEffect(() => { setFocus(null) }, [page, domain])
  // On smaller screens the panel slides over the page: Esc closes it.
  useEffect(() => {
    if (!open || wide) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, wide])

  // What the user points at on the dashboard becomes context Indi can be asked about.
  useEffect(() => {
    const pick = (e: Event) => {
      const el = (e.target as Element).closest?.('[data-indi]')
      if (!el || (e.target as Element).closest('[data-indi-self]')) return
      const label = el.getAttribute('data-indi-label')
      if (!label) return
      setFocus({ label, value: el.getAttribute('data-indi-value') ?? '' })
      setMood('curious')
      setTimeout(() => setMood((m) => (m === 'curious' ? 'idle' : m)), 1800)
    }
    const success = (e: Event) => {
      setToast((e as CustomEvent<string>).detail)
      setMood('celebrate')
      setTimeout(() => { setToast(''); setMood('idle') }, 2800)
    }
    document.addEventListener('click', pick)
    window.addEventListener('indi:success', success)
    return () => { document.removeEventListener('click', pick); window.removeEventListener('indi:success', success) }
  }, [])

  // Eyes follow the pointer.
  useEffect(() => {
    let raf = 0
    const mv = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = avatar.current?.getBoundingClientRect()
        if (!r) return
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy) || 1
        const k = Math.min(1, d / 220)
        setLook({ x: (dx / d) * 2.4 * k, y: (dy / d) * 1.8 * k })
      })
    }
    window.addEventListener('pointermove', mv, { passive: true })
    return () => { window.removeEventListener('pointermove', mv); cancelAnimationFrame(raf) }
  }, [])

  // Keep the newest words in view while streaming, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: busy || reduced() ? 'auto' : 'smooth' })
  }, [msgs, busy, open])
  const onScroll = () => {
    const el = list.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const send = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    setErr('')
    stick.current = true
    const history: IndiMsg[] = [...msgs, { role: 'user', content: t }]
    setMsgs([...history, { role: 'assistant', content: '' }])
    if (!status?.enabled) {
      setMsgs([...history, { role: 'assistant', content: 'My AI answers are switched off on this server, so I can only guide you around.\n- An admin can add a **GROQ_API_KEY** to `backend/.env` (Nexora.bat → 5), then restart.\n- Meanwhile, the **Today** page lists what needs attention, and **Data & Methodology** explains every evidence label.' }])
      return
    }
    setBusy(true)
    setMood('thinking')
    const ctl = new AbortController()
    abort.current = ctl
    const screen = (document.querySelector('#main [data-page-body]') as HTMLElement | null)?.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000) ?? ''
    try {
      const final = await indiChat({
        messages: history.slice(-12), page: (PAGE_NAME[page] ?? page) + (domain ? ` · ${domainName}` : ''), area: sel, years,
        focus: focus ? `${focus.label}${focus.value ? ` · ${focus.value}` : ''}` : '', screen,
      }, (txt) => setMsgs([...history, { role: 'assistant', content: txt }]), ctl.signal)
      setMsgs([...history, { role: 'assistant', content: final.trim() || 'I could not find an answer in the dashboard data.' }])
      setMood('idle')
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMsgs((m) => { const last = m.at(-1); return last && !last.content ? m.slice(0, -1) : m })
      } else {
        setMsgs(history)
        setErr(e instanceof ApiError ? e.message : 'Indi could not reach the Nexora server.')
        setMood('concerned')
        setTimeout(() => setMood('idle'), 2500)
      }
    } finally {
      setBusy(false)
      abort.current = null
    }
  }, [busy, msgs, status, page, domain, domainName, sel, years, focus])

  const reset = () => { abort.current?.abort(); setMsgs([]); setErr(''); setFocus(null) }
  const copy = async (i: number, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard blocked */ } }
  const prompts = [...(PROMPTS[page] ?? PROMPTS.command)].map((p) => (page === 'domain' ? p.replace('on this page', `for ${domainName}`) : p))
  const where = `${PAGE_NAME[page] ?? page}${domain ? ` · ${domainName}` : ''} · ${areaName(sel)}${years.length ? ` · ${years[0]}${years.length > 1 ? `–${years.at(-1)}` : ''}` : ''}`
  const overlay = open && !wide

  return (
    <aside data-indi-self aria-label="Indi assistant" className="indi-dock relative z-30 shrink-0" style={{ width: open && wide ? 384 : 64 }}>
      {/* Collapsed rail: Indi waits here. */}
      <div className={`indi-rail absolute inset-0 flex flex-col items-center gap-4 border-l border-line/60 py-4 transition-opacity duration-200 ${open && wide ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open Indi assistant (Ctrl + /)" title="Ask Indi  (Ctrl + /)" className="indi-rail-btn group relative grid place-items-center rounded-2xl p-1">
          <div className={reduced() ? '' : 'indi-float'}><Robot mood={mood} look={look} quiet={false} size={44} /></div>
          {(toast || focus) && <span className="indi-ping absolute top-0 right-0 size-2.5 rounded-full bg-cyan" />}
        </button>
        <span className="indi-rail-label select-none text-[10.5px] font-semibold tracking-[0.22em] text-mute uppercase">Ask Indi</span>
      </div>

      {/* Open panel – in the layout on wide screens, sliding over the page on narrower ones. */}
      <section
        aria-hidden={!open}
        className={`indi-panel flex flex-col border-l border-lav/20 ${overlay ? 'absolute top-0 right-0 bottom-0 shadow-[-24px_0_60px_-20px_rgba(6,4,30,.85)]' : 'absolute inset-0'} ${open ? 'indi-panel-open' : 'indi-panel-closed'}`}
        style={{ width: 384 }}
      >
        <header className="flex items-center gap-3 border-b border-line/60 px-4 py-3">
          <div ref={avatar} className={`indi-avatar grid size-12 shrink-0 place-items-center rounded-2xl ${mood === 'celebrate' ? 'indi-celebrate' : ''}`}>
            <div className={reduced() ? '' : 'indi-float'}><Robot mood={busy ? 'thinking' : mood} look={look} quiet={false} size={42} /></div>
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-white">Indi
              <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase ${status?.enabled ? 'border-ok/40 text-ok' : 'border-med/40 text-med'}`}>{status?.enabled ? 'AI on' : 'Guide mode'}</span>
            </div>
            <div className="truncate text-[11px] text-mute" title={status?.enabled ? `Groq · ${status.model}` : 'Add GROQ_API_KEY to enable AI answers'}>{status?.enabled ? `Groq · ${status.model.replace(/^openai\//, '')}` : 'Your Nexora guide'}</div>
          </div>
          <button type="button" onClick={reset} disabled={!msgs.length && !err} aria-label="New conversation" title="New conversation" className="indi-icon-btn"><RotateCcw size={15} /></button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Collapse Indi" title="Collapse (Ctrl + /)" className="indi-icon-btn"><ChevronsRight size={17} /></button>
        </header>

        <div className="flex items-center gap-1.5 border-b border-line/40 px-4 py-2 text-[11px] text-dim"><span className="size-1.5 shrink-0 rounded-full bg-lav/70" /><span className="truncate" title={where}>Looking at {where}</span></div>

        <div ref={list} onScroll={onScroll} className="indi-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {toast && <div className="indi-msg-in flex items-center gap-2 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-[12.5px] text-ok"><Check size={14} />{toast}</div>}
          {msgs.length === 0 && (
            <div className="indi-msg-in space-y-3">
              <div className="rounded-2xl border border-lav/20 bg-gradient-to-br from-lav/[0.08] to-orchid/[0.06] p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-white"><Sparkles size={14} className="text-gold" />Hi {user.name.split(' ')[0]}, I’m Indi.</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-soft">Ask me about anything on this dashboard – your sites’ readings, alerts, bills, actions or complaints. I only use your dashboard’s data and I always say whether a number is measured, official, modelled or demonstration.</p>
              </div>
              {status && !status.enabled && (
                <div className="rounded-xl border border-med/35 bg-med/[0.07] p-3 text-[12px] leading-relaxed text-soft">
                  <b className="text-med">Guide mode.</b> AI answers need a free Groq key: {user.role === 'admin' ? <>double-click <b>Nexora.bat</b> → <b>5</b>, paste it after <code className="rounded bg-white/10 px-1">GROQ_API_KEY=</code>, then restart.</> : 'ask your admin to add one.'}
                  <div className="mt-2 flex gap-1.5"><button type="button" onClick={() => go('today')} className="indi-chip">Open Today</button><button type="button" onClick={() => go('method')} className="indi-chip">Evidence labels</button></div>
                </div>
              )}
              <div className="text-[10.5px] font-semibold tracking-[0.16em] text-dim uppercase">Try asking</div>
              <div className="flex flex-col gap-1.5">
                {prompts.map((p) => <button key={p} type="button" onClick={() => send(p)} className="indi-suggest">{p}<ArrowUp size={12} className="rotate-45 opacity-60" /></button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} className="indi-msg-in flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-sapphire to-violet px-3.5 py-2 text-[13px] leading-relaxed text-white shadow-[0_6px_18px_-10px_rgba(49,92,232,.9)]">{m.content}</div></div>
          ) : (
            <div key={i} className="indi-msg-in group flex gap-2.5">
              <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-lav/30 to-orchid/25 text-[10px] font-bold text-white">i</div>
              <div className="min-w-0 flex-1">
                <div className="rounded-2xl rounded-tl-md border border-line/70 bg-white/[0.035] px-3.5 py-2.5 text-[13px] leading-relaxed text-soft">
                  {m.content ? <Rich text={m.content} /> : <span className="indi-typing" aria-label="Indi is thinking"><i /><i /><i /></span>}
                  {busy && i === msgs.length - 1 && m.content && <span className="indi-caret" aria-hidden />}
                </div>
                {m.content && !(busy && i === msgs.length - 1) && (
                  <button type="button" onClick={() => copy(i, m.content)} className="mt-1 flex items-center gap-1 text-[10.5px] text-dim opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:text-fg">{copied === i ? <><Check size={11} />Copied</> : <><Copy size={11} />Copy</>}</button>
                )}
              </div>
            </div>
          ))}
          {err && <div role="alert" className="indi-msg-in rounded-xl border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</div>}
        </div>

        <footer className="border-t border-line/60 p-3">
          {focus && (
            <div className="indi-msg-in mb-2 flex items-center gap-2 rounded-xl border border-cyan/30 bg-cyan/[0.07] px-2.5 py-1.5 text-[11.5px] text-soft">
              <Crosshair size={13} className="shrink-0 text-cyan" />
              <span className="min-w-0 flex-1 truncate" title={`${focus.label} ${focus.value}`}>{focus.label}{focus.value ? ` · ${focus.value}` : ''}</span>
              <button type="button" onClick={() => send(`Explain “${focus.label}”${focus.value ? ` (${focus.value})` : ''}: what does it show and what should I do?`)} className="shrink-0 rounded-md bg-cyan/15 px-2 py-0.5 font-medium text-cyan hover:bg-cyan/25">Ask about this</button>
              <button type="button" onClick={() => setFocus(null)} aria-label="Clear" className="text-dim hover:text-fg"><X size={13} /></button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(q) }} className="indi-composer flex items-end gap-2 rounded-2xl border border-line bg-ink/70 p-1.5 pl-3 focus-within:border-lav/60">
            <textarea
              ref={input}
              rows={1}
              value={q}
              maxLength={2000}
              onChange={(e) => { setQ(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px` }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q) } }}
              placeholder={status?.enabled ? 'Ask Indi about your sites…' : 'Ask Indi (guide mode)…'}
              aria-label="Message Indi"
              className="indi-scroll max-h-[140px] min-h-[34px] flex-1 resize-none bg-transparent py-1.5 focus-visible:outline-none text-[13px] leading-snug text-fg outline-none placeholder:text-dim"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 text-fg hover:bg-white/15"><Square size={12} fill="currentColor" /></button>
            ) : (
              <button type="submit" disabled={!q.trim()} aria-label="Send" className="grad-active grid size-8 shrink-0 place-items-center rounded-xl disabled:opacity-40"><ArrowUp size={15} /></button>
            )}
          </form>
          <p className="mt-1.5 px-1 text-[10px] text-dim">Enter to send · Shift + Enter for a new line · Indi can be wrong – check figures on the page before acting.</p>
        </footer>
      </section>
    </aside>
  )
}

function Robot({ mood, look, quiet, size = 56 }: { mood: Mood; look: Pt; quiet: boolean; size?: number }) {
  const happy = mood === 'celebrate'
  const squint = mood === 'investigate'
  return (
    <svg viewBox="0 0 56 60" width={size} height={Math.round((size * 60) / 56)} aria-hidden className="overflow-visible">
      <defs>
        <radialGradient id="indiBody" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#ece8ff" />
          <stop offset="100%" stopColor="#bdb2f5" />
        </radialGradient>
        <linearGradient id="indiVisor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d3159" />
          <stop offset="100%" stopColor="#0d0b33" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <line x1="28" y1="9" x2="28" y2="3.5" stroke="#7767d9" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="28" cy="3" r="2.2" fill={quiet ? '#918baf' : mood === 'celebrate' ? '#43d6a0' : mood === 'concerned' ? '#ff6b7a' : mood === 'investigate' ? '#f5b84b' : '#42d9f5'} className={quiet ? '' : 'indi-blink-light'} />
      {/* floating arms */}
      <g className="indi-arm-l"><ellipse cx="7" cy="36" rx="3.2" ry="5" fill="url(#indiBody)" stroke="#a99bff" strokeWidth=".6" transform={happy ? 'rotate(-40 7 36)' : undefined} /></g>
      <g className={mood === 'point' ? 'indi-point' : ''}>
        <ellipse cx="49" cy="36" rx="3.2" ry="5" fill="url(#indiBody)" stroke="#a99bff" strokeWidth=".6" transform={happy ? 'rotate(40 49 36)' : mood === 'point' ? 'rotate(-70 49 36)' : undefined} />
      </g>
      {squint && (
        <g>
          <circle cx="49" cy="26" r="4" fill="none" stroke="#42d9f5" strokeWidth="1.6" />
          <line x1="46.5" y1="29" x2="44" y2="32.5" stroke="#7767d9" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}
      {mood === 'thinking' && (
        <g className="indi-think" fill="#b65cb9">
          <circle cx="40" cy="5" r="1.4" /><circle cx="45" cy="2.5" r="1.8" /><circle cx="51" cy="-0.5" r="2.2" />
        </g>
      )}
      {/* body */}
      <ellipse cx="28" cy="46" rx="13" ry="9" fill="url(#indiBody)" stroke="#a99bff" strokeWidth=".6" />
      <circle cx="28" cy="46" r="2.6" fill="#b65cb9" />
      <circle cx="28" cy="46" r="1" fill="#e6c477" />
      {/* head */}
      <rect x="9" y="9" width="38" height="30" rx="15" fill="url(#indiBody)" stroke="#a99bff" strokeWidth=".6" />
      <rect x="9" y="22" width="3" height="7" rx="1.5" fill="#7767d9" />
      <rect x="44" y="22" width="3" height="7" rx="1.5" fill="#7767d9" />
      <rect x="14" y="15" width="28" height="18" rx="9" fill="url(#indiVisor)" />
      {/* eyes */}
      <g transform={`translate(${look.x} ${look.y})`}>
        {happy ? (
          <>
            <path d="M18.5 25.5 q3 -4 6 0" stroke="#315ce8" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M31.5 25.5 q3 -4 6 0" stroke="#315ce8" strokeWidth="2" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse className="indi-eye" cx="21.5" cy="24" rx="3.2" ry={squint ? 1.4 : quiet ? 1 : 3.6} fill="#315ce8" />
            <ellipse className="indi-eye" cx="34.5" cy="24" rx="3.2" ry={quiet ? 1 : 3.6} fill="#315ce8" />
            {!quiet && <circle cx="22.6" cy="22.6" r="1" fill="#a5f3fc" />}
            {!quiet && <circle cx="35.6" cy="22.6" r="1" fill="#a5f3fc" />}
          </>
        )}
      </g>
      <circle cx="16.5" cy="30.5" r="1.6" fill="#b65cb9" opacity=".55" />
      <circle cx="39.5" cy="30.5" r="1.6" fill="#b65cb9" opacity=".55" />
      {mood === 'concerned' && (
        <g stroke="#e8e3fa" strokeWidth="1.2" strokeLinecap="round">
          <line x1="18" y1="18.5" x2="24" y2="20" /><line x1="38" y1="18.5" x2="32" y2="20" />
        </g>
      )}
      <path d={mood === 'concerned' ? 'M25.5 30.5 q2.5 -1.6 5 0' : mood === 'curious' ? 'M26 29.5 q2 1.2 4 0' : 'M25.5 29.3 q2.5 1.8 5 0'} stroke="#42d9f5" strokeWidth="1" fill="none" strokeLinecap="round" opacity=".8" />
    </svg>
  )
}
