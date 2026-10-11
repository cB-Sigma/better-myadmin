import { decodeEntities, parseHtml } from './nav-html.ts'

/**
 * Serialises an HTML <form> of phpMyAdmin the way the browser + its JS submit it ($form.serialize()):
 * enabled named controls only, checked checkboxes/radios, the selected (or first) option of a
 * select, textarea text. The collation selects are filled by the template's inline script before
 * submit (`.collation-select[data-selected]` → value = data-selected), the others stay empty and
 * submit nothing; `name="index[Key_name]"` is re-enabled on submit like checkIndexName does.
 */
export type Pairs = Array<[string, string]>

interface El {
  tag: string
  attrs: Record<string, string>
  children: Array<El | string>
}

const elements = (el: El): El[] => el.children.filter((c): c is El => typeof c !== 'string')
const text = (el: El | string): string => (typeof el === 'string' ? el : el.children.map(text).join(''))

function walk(el: El, fn: (e: El) => void): void {
  for (const c of elements(el)) {
    fn(c)
    walk(c, fn)
  }
}

/** The first form whose action contains `action` (route) or whose id/class matches. */
export function findForm(html: string, match: { action?: string; id?: string; cls?: string }): El {
  const root = parseHtml(html) as El
  let found: El | null = null
  walk(root, (e) => {
    if (found !== null || e.tag !== 'form') return
    const a = e.attrs
    if (match.action !== undefined && !(a.action ?? '').includes(match.action)) return
    if (match.id !== undefined && a.id !== match.id) return
    if (match.cls !== undefined && !(a.class ?? '').split(/\s+/).includes(match.cls)) return
    found = e
  })
  if (found === null) throw new Error(`form ${JSON.stringify(match)} not found`)
  return found
}

export function serializeForm(form: El): Pairs {
  const out: Pairs = []
  walk(form, (e) => {
    const name = e.attrs.name
    if (name === undefined || name === '') return
    const disabled = 'disabled' in e.attrs && name !== 'index[Key_name]'
    if (disabled) return
    if (e.tag === 'input') {
      const type = (e.attrs.type ?? 'text').toLowerCase()
      if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return
      if ((type === 'checkbox' || type === 'radio') && !('checked' in e.attrs)) return
      out.push([name, e.attrs.value ?? (type === 'checkbox' || type === 'radio' ? 'on' : '')])
    } else if (e.tag === 'textarea') {
      // the HTML parser drops one leading newline of a textarea
      out.push([name, text(e).replace(/^\r?\n/, '')])
    } else if (e.tag === 'select') {
      const options: El[] = []
      walk(e, (o) => {
        if (o.tag === 'option') options.push(o)
      })
      const value = (o: El) => o.attrs.value ?? decodeEntities(text(o)).trim()
      const classes = (e.attrs.class ?? '').split(/\s+/)
      if (classes.includes('collation-select')) {
        // populate_collation_select(): only the selects with data-selected are filled on load
        if (!('data-selected' in e.attrs)) return
        out.push([name, e.attrs['data-selected'] ?? ''])
        return
      }
      if (options.length === 0) return
      const selected = options.filter((o) => 'selected' in o.attrs)
      if ('multiple' in e.attrs) {
        for (const o of selected) out.push([name, value(o)])
        return
      }
      // the last selected option wins; none selected → the first one
      out.push([name, value(selected.at(-1) ?? (options[0] as El))])
    }
  })
  return out
}

/** Replace (or add) the value of `name` (first occurrence). */
export function setPair(pairs: Pairs, name: string, value: string): Pairs {
  const i = pairs.findIndex(([k]) => k === name)
  if (i < 0) return [...pairs, [name, value]]
  const copy = [...pairs]
  copy[i] = [name, value]
  return copy
}

/** Remove every pair named `name` (an unticked checkbox). */
export function removePair(pairs: Pairs, name: string): Pairs {
  return pairs.filter(([k]) => k !== name)
}

export const getPair = (pairs: Pairs, name: string): string | undefined =>
  pairs.find(([k]) => k === name)?.[1]
