import { useEffect, useState } from 'react'
import { HAMBURGER_BREAKPOINT } from './overflow.ts'

/**
 * True below 768 px, the phone layout (apps/web/src/lib/mobile.ts holds the same breakpoint for the
 * app; this package has no dependency on it).
 */
export function useNarrow(): boolean {
  const query = `(max-width: ${HAMBURGER_BREAKPOINT - 1}px)`
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}
