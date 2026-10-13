import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { UsersRound, BarChart3, BookOpenCheck, ChevronDown, FileText, MessageSquareWarning, Receipt, Sun, ChevronsLeft, ChevronsRight, FlaskConical, IndianRupee, Layers, LayoutDashboard, ListChecks, Map as MapIcon, Settings, TrendingUp, Upload as UploadIcon } from 'lucide-react'
import { AREAS, DOMAINS, DOMAIN_ACCENT, YEARS, areaName, type Selection } from './eiq'
import CommandCenter from './pages/CommandCenter'
import Geo from './pages/Geo'
import Domain from './pages/Domain'
import Forecasts from './pages/Forecasts'
import Scenario from './pages/Scenario'
import Recommendations from './pages/Recommendations'
import Methodology from './pages/Methodology'
import Indi from './Indi'
import UploadPage from './pages/Upload'
import Savings from './pages/Savings'
import Admin from './pages/Admin'
import Today from './pages/Today'
import Benchmarks from './pages/Benchmarks'
import Bills from './pages/Bills'
import Reports from './pages/Reports'
import Complaints from './pages/Complaints'
import Staff from './pages/Staff'
import { AlertsBell, UserMenu } from './HeaderTools'
import { useSession } from './Session'
import { api, can } from './api'
import { FlowLines } from './ui'
import ScrollRail from './ScrollRail'
import { initSmoothScroll, scrollMain } from './smoothScroll'

export type Page = 'today' | 'command' | 'geo' | 'domain' | 'forecast' | 'scenario' | 'recs' | 'method' | 'upload' | 'savings' | 'admin' | 'complaints' | 'bills' | 'benchmarks' | 'reports' | 'staff'
export type Go = (p: Page, o?: { domain?: string; metric?: string }) => void
export interface PageProps { sel: Selection; years: number[]; setSel: (s: Selection) => void; go: Go; domain: string; setDomain: (d: string) => void; metric: string | null; setMetric: (m: string | null) => void }

const NAV: { id: Page; label: string; icon: typeof Layers }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'command', label: 'Command Center', icon: LayoutDashboard },
  { id: 'geo', label: 'Geographic Intelligence', icon: MapIcon },
  { id: 'domain', label: 'Domain Intelligence', icon: Layers },
  { id: 'forecast', label: 'Forecasts & Anomalies', icon: TrendingUp },
  { id: 'scenario', label: 'Scenario Lab', icon: FlaskConical },
  { id: 'recs', label: 'Recommendations', icon: ListChecks },
  { id: 'method', label: 'Data & Methodology', icon: BookOpenCheck },
]
const OPS: { id: Page; label: string; icon: typeof Layers; role: 'viewer' | 'manager' | 'admin' }[] = [
  { id: 'upload', label: 'Data upload', icon: UploadIcon, role: 'viewer' },
  { id: 'complaints', label: 'Staff complaints', icon: MessageSquareWarning, role: 'viewer' },
  { id: 'bills', label: 'Bills & tariff', icon: Receipt, role: 'viewer' },
  { id: 'benchmarks', label: 'Benchmarking', icon: BarChart3, role: 'viewer' },
  { id: 'reports', label: 'Reports', icon: FileText, role: 'viewer' },
  { id: 'savings', label: 'Savings tracker', icon: IndianRupee, role: 'viewer' },
  { id: 'staff', label: 'Staff & access', icon: UsersRound, role: 'admin' },
  { id: 'admin', label: 'Admin & alerts', icon: Settings, role: 'admin' },
]
const ALL_NAV = [...NAV, ...OPS]

export default function App() {
  const { user, version } = useSession()
  // Job profile: only the pages this person's job needs are shown (and the server enforces the same list).
  const allowedPage = (p: Page) => user.pages.includes(p) && (!OPS.find((o) => o.id === p) || can(user, OPS.find((o) => o.id === p)!.role))
  const firstPage = (): Page => (allowedPage('today') ? 'today' : (ALL_NAV.find((n) => allowedPage(n.id))?.id ?? 'today'))
  const [page, setPage] = useState<Page>(firstPage)
  const [sel, setSel] = useState<Selection>('all')
  useEffect(() => { if (!allowedPage(page)) setPage(firstPage()) }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  const [years, setYears] = useState<number[]>(YEARS)
  const [domain, setDomain] = useState(DOMAINS[0].name)
  const [metric, setMetric] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)')
    const apply = () => mq.matches && setCollapsed(true)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--px', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3))
        root.style.setProperty('--py', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3))
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])

  const go: Go = (p, o) => {
    if (!allowedPage(p)) return
    if (o?.domain) setDomain(o.domain)
    setMetric(o?.metric ?? null)
    setPage(p)
    scrollMain(0, { immediate: true })
  }
  // New years arriving from uploads are switched on automatically.
  const knownYears = useRef<number[]>([...YEARS])
  useEffect(() => {
    const fresh = YEARS.filter((y) => !knownYears.current.includes(y))
    knownYears.current = [...YEARS]
    if (fresh.length) setYears((ys) => [...ys, ...fresh].sort())
  }, [version])
  // Smooth, eased scrolling for the main page.
  useEffect(() => {
    const main = document.getElementById('main')
    const content = document.getElementById('main-content')
    if (main && content) return initSmoothScroll(main, content)
  }, [])
  // Admins see how many access requests are waiting for the head.
  const [pendingReq, setPendingReq] = useState(0)
  useEffect(() => {
    if (!allowedPage('staff')) return
    const poll = () => api<{ pending: number }>('/access-requests/count').then((r) => setPendingReq(r.pending)).catch(() => {})
    poll()
    const t = setInterval(poll, 60_000)
    return () => clearInterval(t)
  }, [user, page]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleYear = (y: number) => setYears((ys) => (ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y].sort()))

  const navRef = useRef<HTMLElement>(null)
  const [ind, setInd] = useState<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    setInd(el ? { top: el.offsetTop, height: el.offsetHeight } : null)
  }, [page, domain, collapsed])

  const navBtn = (on: boolean) => `nav-item relative flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-[13px] transition-[background-color,border-color,color] duration-200 ${collapsed ? 'justify-center' : ''} ${on ? 'nav-active font-medium text-fg' : 'border-transparent text-mute hover:border-lav/15 hover:bg-white/[0.04] hover:text-fg'}`
  const props: PageProps = { sel, years, setSel, go, domain, setDomain, metric, setMetric }

  return (
    <div className="flex h-full text-fg">
      <div className="ambient" aria-hidden><span className="blob-a" /><span className="blob-b" /><FlowLines /></div>
      <aside className={`relative z-10 flex shrink-0 flex-col overflow-hidden border-r border-line/60 bg-[#141134]/80 whitespace-nowrap transition-[width] duration-300 [contain:layout_paint] ${collapsed ? 'w-[68px]' : 'w-64'}`} aria-label="Primary">
        <div className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-line/60 ${collapsed ? 'justify-center' : 'px-5'}`}>
          <button type="button" data-indi-home onClick={() => window.dispatchEvent(new Event('indi:toggle'))} aria-label="Open or close Indi, your assistant (Ctrl + /)" className="indi-home grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/5 transition-transform hover:scale-105"><img src="/nexora-mark.png" alt="Nexora" className="h-full w-full object-contain p-0.5" /><span className="indi-peek" aria-hidden /></button>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">Nexora</div>
              <div className="text-[10px] font-medium tracking-[0.16em] text-mute uppercase">Monitoring intelligence</div>
            </div>
          )}
        </div>
        <nav ref={navRef} className="relative flex-1 overflow-y-auto px-3 py-5">
          {ind && <span aria-hidden className="nav-indicator" style={{ transform: `translateY(${ind.top + 8}px)`, height: Math.max(ind.height - 16, 0) }} />}
          {allowedPage('command') && (
          <button onClick={() => go('command')} title={collapsed ? 'Command Center' : undefined} aria-current={page === 'command' ? 'page' : undefined} className={`main-board-link relative mb-6 flex w-full items-center gap-3 rounded-xl border text-left transition-[background-color,border-color] duration-200 ${collapsed ? 'justify-center p-2.5' : 'px-3 py-3'} ${page === 'command' ? 'is-on' : ''}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold"><LayoutDashboard size={17} /></span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block text-[10px] font-semibold tracking-[0.16em] text-gold/80 uppercase">Main dashboard</span>
                <span className="block text-sm font-semibold text-fg">Command Center</span>
              </span>
            )}
          </button>
          )}
          <ul className="space-y-1">
            {!collapsed && NAV.some((n) => n.id !== 'command' && allowedPage(n.id)) && <li className="mb-1 px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute/80 uppercase">Workspace</li>}
            {NAV.filter((n) => n.id !== 'command' && allowedPage(n.id)).map((n) => {
              const I = n.icon
              const on = page === n.id
              return (
                <li key={n.id}>
                  <button onClick={() => go(n.id)} title={collapsed ? n.label : undefined} data-active={on} aria-current={on ? 'page' : undefined} className={navBtn(on)}>
                    <span className="nav-inner flex items-center gap-3"><I size={17} className="shrink-0" />{!collapsed && n.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <ul className="mt-6 space-y-1">
            {!collapsed && OPS.some((n) => allowedPage(n.id)) && <li className="mb-1 px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute/80 uppercase">Operations</li>}
            {OPS.filter((n) => allowedPage(n.id)).map((n) => {
              const I = n.icon
              const on = page === n.id
              return (
                <li key={n.id}>
                  <button onClick={() => go(n.id)} title={collapsed ? n.label : undefined} data-active={on} aria-current={on ? 'page' : undefined} className={navBtn(on)}>
                    <span className="nav-inner flex items-center gap-3"><I size={17} className="shrink-0" />{!collapsed && n.label}{n.id === 'staff' && pendingReq > 0 && <span className="ml-auto rounded-full bg-crit px-1.5 text-[10px] font-bold text-white" aria-label={`${pendingReq} access requests waiting`}>{pendingReq}</span>}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {!collapsed && allowedPage('domain') && (
            <ul className="mt-6 space-y-0.5">
              <li className="mb-1 px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute/80 uppercase">Domains</li>
              {DOMAINS.map((d) => (
                <li key={d.name}>
                  <button onClick={() => go('domain', { domain: d.name })} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${page === 'domain' && domain === d.name ? 'text-white' : 'text-mute hover:text-fg'}`}>
                    <span className="size-1.5 rounded-full" style={{ background: DOMAIN_ACCENT[d.name] }} />{d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="border-t border-line/60 p-3">
          <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`flex w-full items-center gap-2 rounded-lg border border-line/70 px-2.5 py-2 text-xs text-mute hover:text-fg ${collapsed ? 'justify-center' : ''}`}>
            {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} />Collapse</>}
          </button>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <main id="main" className="no-native-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div id="main-content">
          <header className="sticky top-0 z-20 border-b border-line/60 bg-ink/85 backdrop-blur">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 md:px-10">
              <div className="text-sm font-medium">{ALL_NAV.find((n) => n.id === page)!.label}</div>
              <div className="ml-auto flex flex-wrap items-center gap-4">
                <label className="relative flex items-center gap-2 text-xs text-mute">
                  Area
                  <select value={sel} onChange={(e) => setSel(e.target.value as Selection)} className="h-8 appearance-none rounded-full border border-line bg-panel pr-8 pl-3 text-xs font-medium text-fg hover:border-lav/40">
                    <option value="all">All Areas</option>
                    {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 text-mute" />
                </label>
                <div className="flex items-center gap-2 text-xs text-mute" role="group" aria-label="Reporting years">
                  Reporting years
                  {YEARS.map((y) => (
                    <button key={y} onClick={() => toggleYear(y)} aria-pressed={years.includes(y)} className={`num rounded-full border px-2.5 py-1 font-medium transition-colors ${years.includes(y) ? 'border-sapphire bg-sapphire/25 text-white' : 'border-line text-dim hover:text-fg'}`}>{y}</button>
                  ))}
                </div>
                <span className="hidden text-[11px] text-dim 2xl:block" title="Monthly evidence; measured uploads included.">{areaName(sel)} · monthly · {years.length ? years.join(', ') : 'no years'}</span>
                <AlertsBell go={go} />
                <UserMenu />
              </div>
            </div>
          </header>
          <div key={page + (page === 'domain' ? domain : '')} data-page-body className="page-in mx-auto max-w-[1440px] px-5 py-8 md:px-10">
            {!years.length && !['method', 'upload', 'savings', 'admin', 'complaints', 'bills', 'benchmarks', 'reports', 'staff'].includes(page) ? (
              <div className="surface rounded-2xl p-10 text-center text-sm text-mute">Select at least one reporting year to view monitoring evidence.</div>
            ) : (
              <>
                {page === 'today' && <Today sel={sel} years={years} go={go} />}
                {page === 'command' && <CommandCenter sel={sel} years={years} setSel={setSel} go={go} />}
                {page === 'geo' && <Geo {...props} />}
                {page === 'domain' && <Domain {...props} />}
                {page === 'forecast' && <Forecasts {...props} />}
                {page === 'scenario' && <Scenario {...props} />}
                {page === 'recs' && <Recommendations {...props} />}
                {page === 'method' && <Methodology {...props} />}
                {page === 'upload' && <UploadPage />}
                {page === 'savings' && <Savings sel={sel} />}
                {page === 'admin' && can(user, 'admin') && <Admin go={go} />}
                {page === 'staff' && can(user, 'admin') && <Staff />}
                {page === 'complaints' && <Complaints sel={sel} go={go} />}
                {page === 'bills' && <Bills sel={sel} go={go} />}
                {page === 'benchmarks' && <Benchmarks sel={sel} go={go} />}
                {page === 'reports' && <Reports sel={sel} />}
              </>
            )}
          </div>
          </div>
        </main>
        <ScrollRail watch={page + domain + sel + years.join()} />
      </div>
      <Indi page={page} domain={page === 'domain' ? domain : null} domainName={domain} go={(p) => go(p as Page)} sel={sel} years={years} />
    </div>
  )
}
