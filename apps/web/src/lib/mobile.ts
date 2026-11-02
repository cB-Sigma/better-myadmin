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
