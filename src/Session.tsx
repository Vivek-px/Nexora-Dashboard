/** Sign-in gate: backend check, first-run admin setup, login, and the session shared with every page. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Loader2, LogIn, MailCheck, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { api, ApiError, getToken, setToken, setUnauthorizedHandler, type User } from './api'
import { applySession, type Reading } from './eiq'

interface Session { user: User; version: number; reload: () => Promise<void>; logout: () => void }
const Ctx = createContext<Session | null>(null)
export const useSession = () => useContext(Ctx)!

type Phase = 'checking' | 'offline' | 'setup' | 'login' | 'change' | 'ready'
interface AuthConfig { google_client_id: string; needs_setup: boolean; head_email: string; profiles: { id: number; name: string; level: string; description: string }[] }

export function SessionGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [user, setUser] = useState<User | null>(null)
  const [version, setVersion] = useState(0)
  const [config, setConfig] = useState<AuthConfig>({ google_client_id: '', needs_setup: false, head_email: '', profiles: [] })

  const load = useCallback(async () => {
    const [me, readings] = await Promise.all([api<User>('/me'), api<Reading[]>('/readings')])
    applySession(me.area_list, readings, me.domains)
    setUser(me)
    setVersion((v) => v + 1)
    setPhase(me.must_change ? 'change' : 'ready')
  }, [])

  const logout = useCallback(() => {
    api('/logout', { method: 'POST' }).catch(() => {})
    setToken(''); setUser(null); setPhase('login')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(''); setUser(null); setPhase('login') })
    ;(async () => {
      try {
        const s = await api<AuthConfig>('/auth/config')
        setConfig(s)
        if (s.needs_setup) return setPhase('setup')
        if (!getToken()) return setPhase('login')
        await load()
      } catch (e) {
        setPhase(e instanceof ApiError && e.status === 401 ? 'login' : 'offline')
      }
    })()
  }, [load])

  if (phase === 'checking') return <Center><Loader2 className="animate-spin text-lav" /></Center>
  if (phase === 'offline') return <Offline />
  if (phase === 'setup' || phase === 'login') return <SignIn setup={phase === 'setup'} config={config} onDone={async (t) => { setToken(t); await load() }} />
  if (phase === 'change') return <FirstPassword name={user!.name} onDone={load} onCancel={logout} />
  return <Ctx.Provider value={{ user: user!, version, reload: load, logout }}>{children}</Ctx.Provider>
}

const Center = ({ children }: { children: ReactNode }) => <div className="grid min-h-full place-items-center p-6">{children}</div>

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-white/5"><img src="/nexora-mark.png" alt="Nexora" className="h-full w-full object-contain p-0.5" /></span>
      <div className="leading-tight"><div className="text-sm font-semibold">Nexora</div><div className="text-[10px] font-medium tracking-[0.16em] text-mute uppercase">Monitoring intelligence</div></div>
    </div>
  )
}

declare global {
  interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void; disableAutoSelect: () => void } } } }
}

/** "Sign in with Google": Google's own button; the server checks the token and the registered email. */
function GoogleButton({ clientId, onToken, onPending, onError }: { clientId: string; onToken: (t: string) => void; onPending: (m: string) => void; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const render = () => {
      if (!alive || !box.current || !window.google) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: async (r: { credential: string }) => {
          try {
            const res = await api<{ token?: string; status?: string; message?: string }>('/auth/google', { json: { credential: r.credential } })
            if (res.token) onToken(res.token)
            else onPending(res.message ?? 'Your request was sent to the administrator.')
          } catch (e) { onError(e instanceof Error ? e.message : 'Google sign-in failed') }
        },
      })
      window.google.accounts.id.renderButton(box.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 316, logo_alignment: 'left' })
    }
    if (window.google) render()
    else {
      const id = 'gsi-client'
      let tag = document.getElementById(id) as HTMLScriptElement | null
      if (!tag) { tag = document.createElement('script'); tag.id = id; tag.src = 'https://accounts.google.com/gsi/client'; tag.async = true; document.head.appendChild(tag) }
      tag.addEventListener('load', render)
      tag.addEventListener('error', () => setFailed(true))
    }
    return () => { alive = false }
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  return failed ? <p className="text-center text-[11.5px] text-dim">Google sign-in needs an internet connection.</p> : <div ref={box} className="flex min-h-11 justify-center" data-google-button />
}

function SignIn({ setup, config, onDone }: { setup: boolean; config: AuthConfig; onDone: (token: string) => Promise<void> }) {
  const googleId = config.google_client_id
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [job, setJob] = useState('')
  const [access, setAccess] = useState<'staff' | 'admin'>('staff')
  const [profile, setProfile] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const switchTo = (m: 'signin' | 'signup') => { setMode(m); setErr(''); setPassword(''); setConfirm('') }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if ((setup || mode === 'signup') && password !== confirm) return setErr('Passwords do not match')
    setBusy(true)
    try {
      if (!setup && mode === 'signup') {
        const r = await api<{ message: string }>('/auth/signup', { json: { name, email, phone, job_title: job, access, requested_profile_id: access === 'staff' && profile ? profile : null, password, note } })
        setPending(r.message)
      } else {
        const r = await api<{ token: string }>(setup ? '/setup' : '/login', { json: { username, password, name, email } })
        await onDone(r.token)
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }
  const field = 'h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg focus:border-sapphire focus:outline-none'
  const head = config.head_email
  if (pending) return (
    <Center>
      <div className="surface w-full max-w-md rounded-2xl p-7" role="status">
        <Brand />
        <MailCheck className="text-ok" size={28} />
        <h1 className="mt-3 text-xl font-semibold text-white">Request sent for approval</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-soft">{pending}</p>
        <p className="mt-2 text-[12px] text-mute">The head chooses your job profile and sites. You get a staff ID when approved.</p>
        <button onClick={() => { setPending(''); switchTo('signin') }} className="eiq-btn mt-5 w-full">Back to sign in</button>
      </div>
    </Center>
  )
  const google = !setup && googleId ? (
    <>
      <GoogleButton clientId={googleId} onToken={(t) => onDone(t)} onPending={setPending} onError={setErr} />
      <div className="my-4 flex items-center gap-3 text-[11px] text-dim"><span className="h-px flex-1 bg-line" />{mode === 'signin' ? 'or with your access ID' : 'or fill in the form'}<span className="h-px flex-1 bg-line" /></div>
    </>
  ) : null
  return (
    <Center>
      <form onSubmit={submit} className="surface w-full max-w-md rounded-2xl p-7" aria-label={setup ? 'First start' : mode === 'signin' ? 'Sign in' : 'Create access ID'}>
        <Brand />
        {setup ? (
          <>
            <h1 className="text-xl font-semibold text-white">Create the first account</h1>
            <p className="mt-1 mb-5 text-[12.5px] text-mute">First start on this computer. Use the head’s email <b className="text-soft">{head}</b> if you are the head – the head approves every staff and admin access.</p>
          </>
        ) : (
          <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-line bg-ink/40 p-1">
            <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => switchTo('signin')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium ${mode === 'signin' ? 'bg-sapphire/30 text-white shadow-[inset_0_0_0_1px_rgba(106,140,240,.5)]' : 'text-mute hover:text-fg'}`}><LogIn size={14} />Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchTo('signup')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium ${mode === 'signup' ? 'bg-sapphire/30 text-white shadow-[inset_0_0_0_1px_rgba(106,140,240,.5)]' : 'text-mute hover:text-fg'}`}><UserPlus size={14} />Create access ID</button>
          </div>
        )}
        {!setup && mode === 'signin' && <p className="mb-4 text-[12.5px] text-mute">Only approved staff can sign in. Use your email or staff ID.</p>}
        {!setup && mode === 'signup' && <p className="mb-4 text-[12.5px] text-mute">Request a staff or admin access ID. The head (<b className="text-soft">{head}</b>) approves every request.</p>}
        {google}
        <div className="space-y-3">
          {(setup || mode === 'signup') && <label className="block text-[11.5px] text-mute">Full name<input className={field} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" /></label>}
          {(setup || mode === 'signup') && <label className="block text-[11.5px] text-mute">Email<input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>}
          {!setup && mode === 'signup' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[11.5px] text-mute">Phone<input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="98765 43210" /></label>
                <label className="block text-[11.5px] text-mute">Job / department<input className={field} value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. Pump operator" /></label>
              </div>
              <fieldset><legend className="mb-1 text-[11.5px] text-mute">Access you need</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([['staff', 'Staff', 'Work with your job’s pages', UsersRound], ['admin', 'Admin', 'Manage staff, alerts, settings', ShieldCheck]] as const).map(([v, t, d, I]) => (
                    <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 ${access === v ? 'border-sapphire bg-sapphire/15' : 'border-line hover:border-lav/40'}`}>
                      <input type="radio" name="access" className="sr-only" checked={access === v} onChange={() => setAccess(v)} />
                      <I size={16} className={access === v ? 'mt-0.5 text-white' : 'mt-0.5 text-mute'} /><span><span className="block text-[13px] font-medium text-white">{t}</span><span className="text-[11px] text-dim">{d}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {access === 'staff' && config.profiles.length > 0 && (
                <label className="block text-[11.5px] text-mute">Your job (optional – the head confirms it)<select className={field} value={profile} onChange={(e) => setProfile(e.target.value ? Number(e.target.value) : '')}><option value="">Not sure – let the head choose</option>{config.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              )}
            </>
          )}
          {(setup || mode === 'signin') && <label className="block text-[11.5px] text-mute">{setup ? 'Username' : 'Email or staff ID'}<input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} placeholder={setup ? 'e.g. admin' : 'name@example.org or EIQ-0007'} /></label>}
          <label className="block text-[11.5px] text-mute">{mode === 'signup' && !setup ? 'Choose a password' : 'Password'}<input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup || mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} /></label>
          {(setup || mode === 'signup') && <label className="block text-[11.5px] text-mute">Confirm password<input className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} /></label>}
          {!setup && mode === 'signup' && <label className="block text-[11.5px] text-mute">Note for the head (optional)<input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Which site you work at, who referred you…" /></label>}
        </div>
        {err && <p role="alert" className="mt-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{err}</p>}
        <button disabled={busy} className="eiq-btn eiq-btn-primary mt-5 h-10 w-full">{busy ? 'Please wait…' : setup ? 'Create account and continue' : mode === 'signin' ? 'Sign in' : 'Send request to the head'}</button>
        {!setup && mode === 'signin' && <p className="mt-4 text-center text-[11.5px] text-dim">No access ID yet? <button type="button" className="text-lav underline" onClick={() => switchTo('signup')}>Create access ID</button></p>}
      </form>
    </Center>
  )
}

/** First sign-in with a one-time password: choose your own before continuing. */
function FirstPassword({ name, onDone, onCancel }: { name: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const field = 'h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg focus:border-sapphire focus:outline-none'
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (pw !== confirm) return setErr('The new passwords do not match')
    setBusy(true)
    try { await api('/me/password', { json: { old, new: pw } }); await onDone() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not change the password') } finally { setBusy(false) }
  }
  return (
    <Center>
      <form onSubmit={submit} className="surface w-full max-w-sm rounded-2xl p-7" aria-label="Choose your password">
        <Brand />
        <KeyRound className="text-gold" size={26} />
        <h1 className="mt-3 text-xl font-semibold text-white">Welcome, {name.split(' ')[0]}</h1>
        <p className="mt-1 mb-5 text-[12.5px] text-mute">You signed in with a one-time password. Choose your own to continue (at least 8 characters).</p>
        <div className="space-y-3">
          <label className="block text-[11.5px] text-mute">One-time password<input className={field} type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" required /></label>
          <label className="block text-[11.5px] text-mute">New password<input className={field} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required minLength={8} /></label>
          <label className="block text-[11.5px] text-mute">Confirm new password<input className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} /></label>
        </div>
        {err && <p role="alert" className="mt-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{err}</p>}
        <button disabled={busy} className="eiq-btn eiq-btn-primary mt-5 h-10 w-full">{busy ? 'Saving…' : 'Save and continue'}</button>
        <button type="button" onClick={onCancel} className="mt-2 w-full text-center text-[12px] text-mute hover:text-fg">Sign out</button>
      </form>
    </Center>
  )
}

function Offline() {
  return (
    <Center>
      <div className="surface max-w-lg rounded-2xl p-7">
        <Brand />
        <h1 className="text-lg font-semibold text-white">The Nexora server is not running</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mute">The dashboard needs its Python server for sign-in, uploads, alerts, actions and savings.</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-soft">
          <li>Easiest: close this tab, double-click <b>Nexora.bat</b> in the project folder and choose <b>1</b>.</li>
          <li>In VS Code: run <code className="rounded bg-ink px-1">npm run dev</code> – it now starts the server and the dashboard together.</li>
        </ul>
        <button onClick={() => location.reload()} className="eiq-btn mt-5">Try again</button>
      </div>
    </Center>
  )
}
