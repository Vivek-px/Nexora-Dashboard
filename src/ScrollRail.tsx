/**
 * A slim, separate scroll rail for the main page: gradient thumb that can be dragged, click-to-jump track,
 * dots marking each section (hover for its name, click to glide there) and a back-to-top button.
 * The native scrollbar of the page is hidden; keyboard, wheel and touch scrolling keep working as usual.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { getLenis, scrollMain } from './smoothScroll'

interface Mark { top: number; label: string; el: HTMLElement }
const HEADER = 64

export default function ScrollRail({ watch }: { watch: unknown }) {
  const [m, setM] = useState({ ratio: 1, pos: 0, max: 0, track: 0 })
  const [marks, setMarks] = useState<Mark[]>([])
  const [active, setActive] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; start: number } | null>(null)
  const idle = useRef(0)

  const measure = useCallback(() => {
    const main = document.getElementById('main')
    const t = track.current
    if (!main || !t) return
    const max = main.scrollHeight - main.clientHeight
    setM({ ratio: main.clientHeight / Math.max(main.scrollHeight, 1), pos: main.scrollTop, max, track: t.clientHeight })
    const heads = Array.from(main.querySelectorAll<HTMLElement>('[data-page-body] h1, [data-page-body] h2')).filter((h) => h.offsetParent)
    const base = main.getBoundingClientRect().top - main.scrollTop
    setMarks(max > 0 ? heads.map((h) => ({ el: h, label: h.innerText.trim().slice(0, 60), top: Math.min(1, Math.max(0, (h.getBoundingClientRect().top - base - HEADER - 12) / max)) })) : [])
  }, [])

  useEffect(() => {
    const main = document.getElementById('main')
    if (!main) return
    const onScroll = () => {
      measure()
      setActive(true)
      clearTimeout(idle.current)
      idle.current = window.setTimeout(() => setActive(false), 900)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => measure())
    ro.observe(main)
    if (main.firstElementChild) ro.observe(main.firstElementChild)
    window.addEventListener('resize', measure)
    const t = setTimeout(measure, 350)
    return () => { main.removeEventListener('scroll', onScroll); ro.disconnect(); window.removeEventListener('resize', measure); clearTimeout(t) }
  }, [measure, watch])

  if (m.max <= 4 || !m.track) return <div ref={track} className="scroll-rail pointer-events-none opacity-0" aria-hidden />
  const thumbH = Math.max(44, m.ratio * m.track)
  const thumbTop = (m.pos / m.max) * (m.track - thumbH)
  const toScroll = (clientY: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(Math.max((clientY - r.top - thumbH / 2) / (r.height - thumbH), 0), 1) * m.max
  }
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, start: m.pos }
    setActive(true)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const top = Math.min(Math.max(d.start + ((e.clientY - d.y) / (m.track - thumbH)) * m.max, 0), m.max)
    const l = getLenis()
    if (l) l.scrollTo(top, { immediate: true })
    else document.getElementById('main')!.scrollTop = top
  }
  const up = () => { drag.current = null }

  return (
    <>
      <div ref={track} className={`scroll-rail ${active || drag.current ? 'is-active' : ''}`} aria-hidden onPointerDown={(e) => { if (e.target === e.currentTarget) scrollMain(toScroll(e.clientY)) }}>
        {marks.map((k, i) => (
          <button key={i} type="button" tabIndex={-1} className="scroll-mark" style={{ top: `calc(${k.top * 100}% - 3px)` }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => scrollMain(k.el, { offset: -HEADER - 16 })}>
            {hover === i && <span className="scroll-mark-tip">{k.label}</span>}
          </button>
        ))}
        <div className="scroll-thumb" style={{ height: thumbH, transform: `translateY(${thumbTop}px)` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
      <button type="button" aria-label="Back to top" onClick={() => scrollMain(0)} className={`scroll-top ${m.pos > 600 ? 'is-shown' : ''}`}><ArrowUp size={15} /></button>
    </>
  )
}
