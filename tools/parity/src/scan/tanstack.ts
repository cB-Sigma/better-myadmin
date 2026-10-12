/**
 * Our SPA routes, from TanStack Router's file-based routes under apps/web/src/routes.
 *
 *   index.tsx            → the directory path
 *   route.tsx            → the directory path (layout route)
 *   $param               → `:param`
 *   $.tsx                → splat `*` (catch-all; never counts as an implemented target)
 *   _layout / (group)    → pathless segments
 *   segment_             → the segment, not nested under its layout (`structure_.add` → structure/add)
 *   __root.tsx           → skipped
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, walk } from '../util.ts'

export interface SpaRoute {
  path: string
  file: string
  splat: boolean
  /** The route renders the `NotImplemented` placeholder: it does not implement anything yet. */
  placeholder: boolean
}

export function fileToRoute(relFile: string): { path: string; splat: boolean } | null {
  const noExt = relFile.replace(/\.(tsx|ts|jsx|js)$/, '')
  if (/(^|\/)__root$/.test(noExt)) return null
  if (/(^|\/)-/.test(noExt)) return null // `-` prefixed files/dirs are ignored by the router
  const segs = noExt.split(/[/.]/)
  const last = segs.at(-1)
  if (last === 'index' || last === 'route') segs.pop()
  let splat = false
  const parts = segs
    .filter((s) => !s.startsWith('_') && !/^\(.*\)$/.test(s))
    .map((s) => {
      if (s === '$') {
        splat = true
        return '*'
      }
      const seg = s.length > 1 && s.endsWith('_') ? s.slice(0, -1) : s
      return seg.startsWith('$') ? `:${seg.slice(1)}` : seg
    })
  return { path: `/${parts.join('/')}`.replace(/\/+$/, '') || '/', splat }
}

export function scanTanstack(root = join(REPO, 'apps/web/src/routes')): SpaRoute[] {
  const out = new Map<string, SpaRoute>()
  for (const f of walk(root, (r) => /\.(tsx|ts)$/.test(r) && !r.endsWith('.gen.ts') && !/\.test\./.test(r))) {
    const r = fileToRoute(f)
    if (r === null) continue
    const placeholder = /\bNotImplemented\b/.test(readFileSync(join(root, f), 'utf8'))
    const prev = out.get(r.path)
    // index.tsx and route.tsx can share a path; the route is real if either is
    if (prev === undefined) out.set(r.path, { ...r, file: `apps/web/src/routes/${f}`, placeholder })
    else if (prev.placeholder && !placeholder)
      out.set(r.path, { ...r, file: `apps/web/src/routes/${f}`, placeholder })
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path))
}
