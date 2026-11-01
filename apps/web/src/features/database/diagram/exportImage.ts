import { type Bounds, pngScale } from './diagram.ts'

/**
 * Database → Diagram export (X63): the whole diagram (not the visible part) as a standalone SVG
 * file, or that SVG rasterised to PNG on a canvas. Theme tokens (`var(--…)` in inline styles) are
 * resolved to the current theme's colours, so the file looks like the screen, dark mode included.
 */

const VAR = /var\((--[a-z0-9-]+)\)/gi

/** The standalone SVG text of the diagram content `<g>` of `svg`. */
export function diagramSvg(svg: SVGSVGElement, content: SVGGElement, b: Bounds, title: string): string {
  const css = getComputedStyle(svg)
  const resolve = (s: string) =>
    s.replace(VAR, (_m, name: string) => css.getPropertyValue(name).trim() || 'currentColor')
  const ns = 'http://www.w3.org/2000/svg'
  const out = document.createElementNS(ns, 'svg')
  const pad = 16
  const w = Math.ceil(b.width + 2 * pad)
  const h = Math.ceil(b.height + 2 * pad)
  out.setAttribute('xmlns', ns)
  out.setAttribute('width', String(w))
  out.setAttribute('height', String(h))
  out.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${w} ${h}`)
  out.setAttribute('font-family', css.fontFamily)
  const t = document.createElementNS(ns, 'title')
  t.textContent = title
  out.appendChild(t)
  const bg = document.createElementNS(ns, 'rect')
  bg.setAttribute('x', String(b.x - pad))
  bg.setAttribute('y', String(b.y - pad))
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', resolve('var(--bg)'))
  out.appendChild(bg)
  const g = content.cloneNode(true) as SVGGElement
  g.removeAttribute('transform')
  for (const el of [g, ...g.querySelectorAll('*')]) {
    if (el.getAttribute('data-export') === 'skip') {
      el.remove()
      continue
    }
    for (const a of ['style', 'fill', 'stroke']) {
      const v = el.getAttribute(a)
      if (v?.includes('var(') === true) el.setAttribute(a, resolve(v))
    }
    for (const a of [
      'href',
      'class',
      'tabindex',
      'role',
      'aria-label',
      'aria-expanded',
      'data-table',
      'data-edge',
    ]) {
      el.removeAttribute(a)
    }
  }
  out.appendChild(g)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}`
}

/** The SVG text rasterised at {@link pngScale} (2× when the browser allows it). */
export async function diagramPng(svgText: string, b: Bounds): Promise<Blob> {
  const pad = 16
  const w = b.width + 2 * pad
  const h = b.height + 2 * pad
  const scale = pngScale({ x: 0, y: 0, width: w, height: h })
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * scale)
    canvas.height = Math.ceil(h * scale)
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('canvas')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob === null ? reject(new Error('png')) : resolve(blob)), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Hands the browser a file to save. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
