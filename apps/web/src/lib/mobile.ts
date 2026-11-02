import { useSyncExternalStore } from 'react'

/**
 * Phone layout: viewports up to 767px wide (phpMyAdmin's own breakpoint, navigation.ts collapses the
 * panel below 768). Everything mobile hangs off this one query, in CSS (`@media (max-width: 767px)`,
 * styles/mobile-*.css) or in components (useIsMobile), so a desktop viewport never takes a mobile
 * code path.
 */
export const MOBILE_MAX_WIDTH = 767
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(MOBILE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True while the viewport is phone-sized; follows rotation and resizing. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY).matches
    : false
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false)
}

/**
 * The on-screen keyboard. iOS Safari (and Android Chrome by default) lays the keyboard over the page
 * without resizing it, so whatever is pinned to the bottom of the screen (the SQL page's Go bar, a
 * dialog's Save / Cancel, the console's input) ends up under it. The visual viewport is the part
 * left visible: its offsets are published as CSS variables, which styles/mobile-*.css use:
 *   --bma-kb      how much of the bottom of the layout viewport is covered (0 with no keyboard)
 *   --bma-vv-top  how far the visible part starts below the top of the layout viewport (iOS
 *                 scrolls the page up to show a focused field)
 * Small changes (a collapsing address bar) are ignored.
 */
export function installKeyboardInset(win: Window = window): () => void {
  const vv = win.visualViewport
  if (vv === null || vv === undefined) return () => {}
  const root = win.document.documentElement
  let frame = 0
  const update = () => {
    frame = 0
    // the layout viewport's height: iOS Safari changes innerHeight with pinch / focus zoom, clientHeight
    // stays the layout height (what position: fixed and sticky offsets are measured against)
    const layout = win.document.documentElement.clientHeight || win.innerHeight
    const covered = Math.round(layout - vv.height - vv.offsetTop)
    const keyboard = covered > 80
    root.style.setProperty('--bma-kb', `${keyboard ? covered : 0}px`)
    root.style.setProperty('--bma-vv-top', `${keyboard ? Math.max(0, Math.round(vv.offsetTop)) : 0}px`)
    root.toggleAttribute('data-bma-keyboard', keyboard)
  }
  const schedule = () => {
    if (frame === 0) frame = win.requestAnimationFrame(update)
  }
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  update()
  return () => {
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    if (frame !== 0) win.cancelAnimationFrame(frame)
  }
}
