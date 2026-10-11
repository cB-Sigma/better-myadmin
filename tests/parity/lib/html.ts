import { decodeEntities as decodeBasic } from './nav-html.ts'

const NAMED: Record<string, string> = {
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
}
const decodeEntities = (s: string) =>
  decodeBasic(s.replace(/&(laquo|raquo|mdash|ndash|hellip|copy);/g, (_m, n: string) => NAMED[n]!))

/**
 * A small HTML tree for reading phpMyAdmin's server pages in parity tests: tags with attributes,
 * text, and the implicit end tags HTML allows (`<tr>`, `<td>`, `<li>`, `<option>`, `<p>` close their
 * open sibling), plus helpers to select elements and read their visible text.
 */
export interface Node {
  tag: string
  attrs: Record<string, string>
  children: Array<Node | string>
}

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'col'])
/** tag → the open tags a new one of this kind closes */
const IMPLIED: Record<string, string[]> = {
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  li: ['li'],
  option: ['option'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
}
/** containers that stop the implicit closing search */
const SCOPE = new Set(['table', 'thead', 'tbody', 'tfoot', 'ul', 'ol', 'select', 'dl', 'optgroup'])

export function parse(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [] }
  const stack: Node[] = [root]
  const re =
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g
  let last = 0
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const top = stack[stack.length - 1]!
    if (m.index > last) top.children.push(decodeEntities(html.slice(last, m.index)))
    last = re.lastIndex
    if (m[0].startsWith('<!--') || m[1] !== undefined) continue
    const [, , close, tagRaw = '', attrText = ''] = m
    const tag = tagRaw.toLowerCase()
    if (close === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const implied = IMPLIED[tag]
    if (implied !== undefined) {
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i]!.tag
        if (SCOPE.has(t)) break
        if (implied.includes(t)) {
          stack.length = i
          break
        }
      }
    }
    const attrs: Record<string, string> = {}
    const ar = /([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
    for (let a = ar.exec(attrText); a !== null; a = ar.exec(attrText)) {
      attrs[a[1]!.toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }
    const el: Node = { tag, attrs, children: [] }
    stack[stack.length - 1]!.children.push(el)
    if (!VOID.has(tag)) stack.push(el)
  }
  if (last < html.length) stack[stack.length - 1]!.children.push(decodeEntities(html.slice(last)))
  return root
}

export const elements = (n: Node): Node[] => n.children.filter((c): c is Node => typeof c !== 'string')
export const classes = (n: Node): string[] => (n.attrs.class ?? '').split(/\s+/).filter((c) => c !== '')
export const hasClass = (n: Node, c: string): boolean => classes(n).includes(c)

/** Visible text, whitespace collapsed (elements with class `hide` are skipped when `visibleOnly`). */
export function text(n: Node | string, visibleOnly = false): string {
  const raw = (x: Node | string): string => {
    if (typeof x === 'string') return x
    if (visibleOnly && (hasClass(x, 'hide') || /display:\s*none/.test(x.attrs.style ?? ''))) return ''
    if (x.tag === 'br') return ' '
    return x.children.map(raw).join('')
  }
  return raw(n)
    .replace(/[\s ]+/g, ' ')
    .trim()
}

/** All descendants matching `pred` (document order). */
export function findAll(n: Node, pred: (e: Node) => boolean, out: Node[] = []): Node[] {
  for (const c of elements(n)) {
    if (pred(c)) out.push(c)
    findAll(c, pred, out)
  }
  return out
}

export function find(n: Node, pred: (e: Node) => boolean): Node | undefined {
  return findAll(n, pred)[0]
}

/** A tiny selector: `tag`, `#id`, `.class`, `tag.class`, `tag#id`, `[attr=value]` (one compound). */
export function matcher(sel: string): (e: Node) => boolean {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=([^\]]*))?\])?$/.exec(sel)
  if (m === null) throw new Error(`bad selector ${sel}`)
  const [, tag, id, cls, attr, value] = m
  const cs = (cls ?? '').split('.').filter((c) => c !== '')
  return (e) =>
    (tag === '' || tag === undefined || e.tag === tag) &&
    (id === undefined || e.attrs.id === id) &&
    cs.every((c) => hasClass(e, c)) &&
    (attr === undefined || (value === undefined ? attr in e.attrs : e.attrs[attr] === value))
}

/** Descendant selector: `table#x tbody tr` */
export function $$(n: Node, selector: string): Node[] {
  let current = [n]
  for (const part of selector.trim().split(/\s+/)) {
    const pred = matcher(part)
    const next: Node[] = []
    for (const c of current) for (const e of findAll(c, pred)) if (!next.includes(e)) next.push(e)
    current = next
  }
  return current
}

export const $ = (n: Node, selector: string): Node | undefined => $$(n, selector)[0]

/** The `url=` target of a Core::linkURL link (`index.php?route=/url&url=…`), else the href. */
export function linkTarget(href: string): string {
  const m = /[?&]url=([^&]+)/.exec(href)
  return m !== null ? decodeURIComponent(m[1]!.replaceAll('+', ' ')) : href
}

/** phpMyAdmin's AJAX page response (`{success, message: html, …}`) or a full page. */
export function pageHtml(response: string): string {
  const t = response.trimStart()
  if (t.startsWith('{')) {
    const j = JSON.parse(t) as { message?: string; error?: string }
    return j.message ?? j.error ?? ''
  }
  return response
}

/** Replaces every number by `#` (counters drift between the two tools' requests). */
export const shape = (s: string): string => s.replace(/\d+([.,]\d+)*/g, '#')
