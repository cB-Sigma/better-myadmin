import { type RefObject, useEffect, useRef, useState } from 'react'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

/**
 * Phones only (BetterMyAdmin): the Designer canvas in its own scroller, one finger pans (native
 * scrolling), two fingers pinch-zoom it (CSS `zoom` on #osn_tab, kept around the pinch centre).
 * `enabled` false (desktop) attaches nothing and the zoom stays 1.
 */
export function useTouchZoom(scroller: RefObject<HTMLElement | null>, enabled: boolean) {
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  useEffect(() => {
    const el = scroller.current
    if (!enabled || el === null) return
    let start: { d: number; z: number } | null = null
    const dist = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]]
      return a === undefined || b === undefined ? 0 : Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { d: dist(e), z: zoomRef.current }
    }
    const onMove = (e: TouchEvent) => {
      if (start === null || e.touches.length !== 2 || start.d === 0) return
      e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      if (a === undefined || b === undefined) return
      const next = clampZoom((start.z * dist(e)) / start.d)
      const prev = zoomRef.current
      if (next === prev) return
      // keep the content under the pinch centre in place
      const box = el.getBoundingClientRect()
      const mx = (a.clientX + b.clientX) / 2 - box.left
      const my = (a.clientY + b.clientY) / 2 - box.top
      const left = ((el.scrollLeft + mx) * next) / prev - mx
      const top = ((el.scrollTop + my) * next) / prev - my
      zoomRef.current = next
      setZoom(next)
      requestAnimationFrame(() => {
        el.scrollLeft = left
        el.scrollTop = top
      })
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scroller, enabled])

  return [enabled ? zoom : 1, setZoom] as const
}
