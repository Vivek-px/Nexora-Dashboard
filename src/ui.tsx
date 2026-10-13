import { useRef, useSyncExternalStore, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { SearchX } from 'lucide-react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Panel({ children, className = '', style, fx, attrs }: { children: ReactNode; className?: string; style?: CSSProperties; fx?: 'tilt' | 'light'; attrs?: Record<string, string | undefined> }) {
  const ref = useRef<HTMLElement>(null)
  const move = (e: RPointerEvent<HTMLElement>) => {
    const el = ref.current
    if (!el || reduced()) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    el.style.setProperty('--mx', `${x}px`)
    el.style.setProperty('--my', `${y}px`)
    if (fx === 'tilt') {
      el.style.setProperty('--ry', `${((x / r.width - 0.5) * 3).toFixed(2)}deg`)
      el.style.setProperty('--rx', `${(-(y / r.height - 0.5) * 3).toFixed(2)}deg`)
    }
  }
  const leave = () => {
    ref.current?.style.setProperty('--rx', '0deg')
    ref.current?.style.setProperty('--ry', '0deg')
  }
  return (
    <section {...attrs} ref={ref} style={style} onPointerMove={fx ? move : undefined} onPointerLeave={fx ? leave : undefined} className={`surface rounded-2xl ${fx ? 'fx' : ''} ${className}`}>
      {children}
    </section>
  )
}

export function PanelHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
      <div>
        <h3 className="font-display text-[15px] font-semibold text-fg">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-mute">{sub}</p>}
      </div>
      {right}
    </header>
  )
}

export function PageHeader({ eyebrow, title, desc, right, accent }: { eyebrow: string; title: string; desc: string; right?: ReactNode; accent?: string }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-lav/25 bg-lav/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lav" style={accent ? { color: accent, borderColor: `${accent}55`, background: `${accent}14` } : undefined}><span className="size-1.5 rounded-full bg-lav" style={accent ? { background: accent } : undefined} />{eyebrow}</div>
        <h1 className="font-display mt-2 text-4xl font-semibold leading-[1.05] md:text-5xl">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-mute">{desc}</p>
      </div>
      {right}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-ink/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${value === o.id ? 'grad-active shadow-sm' : 'text-mute hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full border border-line bg-raised text-mute">
        <SearchX size={18} />
      </div>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 max-w-sm text-xs text-mute">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Sparkline({ data, color = '#42d9f5' }: { data: number[]; color?: string }) {
  const d = data.map((v, i) => ({ i, v }))
  const id = `sp${color.replace('#', '')}`
  return (
    <ResponsiveContainer debounce={120} width="100%" height={36} minWidth={0} initialDimension={{ width: 120, height: 36 }}>
      <AreaChart data={d} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

let focusKey: string | null = null
const listeners = new Set<() => void>()
const setFocus = (k: string | null) => {
  focusKey = k
  listeners.forEach((l) => l())
}
export const useFocus = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => focusKey)

export function Legend({ items }: { items: { key?: string; label: string; swatch: 'line' | 'dash' | 'band' | 'dot'; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
      {items.map((it) => (
        <li key={it.label} tabIndex={0} onMouseEnter={() => setFocus(it.key ?? null)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(it.key ?? null)} onBlur={() => setFocus(null)} className="flex cursor-default items-center gap-1.5 rounded px-1 transition-colors hover:text-fg focus-visible:text-fg">
          <svg width="18" height="10" aria-hidden>
            {it.swatch === 'line' && <line x1="0" y1="5" x2="18" y2="5" stroke={it.color} strokeWidth="2" />}
            {it.swatch === 'dash' && <line x1="0" y1="5" x2="18" y2="5" stroke={it.color} strokeWidth="2" strokeDasharray="4 3" />}
            {it.swatch === 'band' && <rect x="0" y="1" width="18" height="8" rx="2" fill={it.color} fillOpacity="0.25" />}
            {it.swatch === 'dot' && <circle cx="9" cy="5" r="4" fill={it.color} stroke="#252249" strokeWidth="1.5" />}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  )
}


/** Domain palette: accent, soft glow and tinted base for gradient cards. */
export const HUES: Record<string, { accent: string; glow: string; base: string }> = {
  Energy: { accent: '#42d9f5', glow: 'rgba(66,217,245,.16)', base: '#1d3159' },
  Water: { accent: '#7fb0c5', glow: 'rgba(127,176,197,.16)', base: '#1f3360' },
  'Air Quality': { accent: '#43d6a0', glow: 'rgba(67,214,160,.14)', base: '#1b3350' },
  Mobility: { accent: '#6a8cf0', glow: 'rgba(106,140,240,.18)', base: '#222a5c' },
  'Buildings & Assets': { accent: '#e6c477', glow: 'rgba(230,196,119,.15)', base: '#2b2550' },
  Waste: { accent: '#43d6a0', glow: 'rgba(67,214,160,.12)', base: '#1f2c4f' },
  Carbon: { accent: '#5fc7d8', glow: 'rgba(95,199,216,.14)', base: '#1e2f58' },
  'Climate & Resilience': { accent: '#a99bff', glow: 'rgba(182,92,185,.18)', base: '#2c1a48' },
}
export const hueStyle = (domain: string): CSSProperties => {
  const h = HUES[domain] ?? HUES.Energy
  return { ['--hue-a' as string]: h.glow, ['--hue-b' as string]: h.base }
}

/** Faint white contour lines drifting behind the workspace, each carrying a soft light pulse. */
export function FlowLines() {
  const paths = [
    'M-50 180 C 300 80, 520 320, 860 210 S 1400 120, 1650 260',
    'M-50 420 C 260 340, 600 560, 920 430 S 1380 330, 1650 470',
    'M-50 660 C 340 600, 640 760, 980 640 S 1420 560, 1650 700',
    'M-50 880 C 300 820, 700 960, 1040 860 S 1460 800, 1650 900',
    'M200 -40 C 260 260, 120 520, 300 1000',
  ]
  return (
    <svg className="flow-lines" viewBox="0 0 1600 960" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d) => (
        <g key={d}>
          <path className="base" d={d} />
          <path className="flow-pulse" d={d} pathLength={100} />
        </g>
      ))}
    </svg>
  )
}
