/** Smooth, eased wheel scrolling for the main page (Lenis). Maps, the Indi panel and nested scroll areas keep native scrolling. */
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

let lenis: Lenis | null = null
export const getLenis = () => lenis

export function initSmoothScroll(wrapper: HTMLElement, content: HTMLElement) {
  lenis = new Lenis({
    wrapper,
    content,
    autoRaf: true,
    lerp: 0.11,
    wheelMultiplier: 0.95,
    smoothWheel: true,
    allowNestedScroll: true,
    // Let maps zoom, and let any element marked data-lenis-prevent scroll on its own.
    prevent: (node) => !!node.closest?.('[data-station-map], .maplibregl-map, [data-lenis-prevent], select'),
  })
  return () => { lenis?.destroy(); lenis = null }
}

/** Scroll the main page to a position or element: eased when smooth scrolling is on, native otherwise. */
export function scrollMain(to: number | HTMLElement, opts: { immediate?: boolean; offset?: number } = {}) {
  const main = document.getElementById('main')
  if (lenis) return lenis.scrollTo(to, { offset: opts.offset ?? 0, immediate: opts.immediate, duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4) })
  if (!main) return
  const top = typeof to === 'number' ? to : to.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop + (opts.offset ?? 0)
  main.scrollTo({ top, behavior: opts.immediate ? 'auto' : 'smooth' })
}
