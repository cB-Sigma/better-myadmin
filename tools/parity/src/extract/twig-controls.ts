/**
 * Form controls, action links and checkbox/radio groups of a phpMyAdmin Twig template.
 *
 * The template is HTML with Twig constructs anywhere, including inside tags
 * (`<input name="x"{% if y %} checked{% endif %}>`). We replace every `{{ … }}` / `{% … %}` with an
 * opaque placeholder, scan the HTML tags of the result, and resolve placeholders back when reading
 * attribute values (a print becomes `*` in names/ids; `t('…')` inside a print is a label msgid).
 *
 * Extracted:
 * - `<input>` (except type=hidden), `<select>` with its static `<option value>`s, `<textarea>`,
 *   `<button>`, submit/reset/image inputs with their label;
 * - radio inputs sharing a name → one `radio-group` with the values; several checkboxes sharing a
 *   name → one `checkbox-group`;
 * - `<a>` whose content (or title) carries a translated label → `link:<msgid>`;
 * - `link_or_button(…, t('…'))` calls (src/Html/Generator.php::linkOrButton) → `link:<msgid>`.
 * - `<label for>` text is attached to the control with that id.
 */

export type ControlKind =
  | 'input'
  | 'checkbox'
  | 'checkbox-group'
  | 'radio-group'
  | 'select'
  | 'textarea'
  | 'button'
  | 'submit'
  | 'link'

export interface TemplateControl {
  /** `<template>#<local>`, e.g. `login/form.twig#pma_username`. */
  key: string
  template: string
  /** Control key inside the template: its name, else its id, else `<kind>:<label msgid>`. */
  local: string
  kind: ControlKind
  type?: string
  name?: string
  id?: string
  /** Static option values (select) or values (radio/checkbox group). */
  options?: string[]
  /** True when some options/values come from Twig expressions or loops. */
  dynamicOptions?: boolean
  /** Translated label msgid (button text, submit value, link text, `<label for>`). */
  label?: string
  /** First line in the template. */
  line: number
  /** How many elements in the template share this key. */
  count: number
}

interface Placeholder {
  kind: 'print' | 'block'
  text: string
  newlines: number
}

const PH_OPEN = '\u0001'
const PH_CLOSE = '\u0002'
// built from the constants: biome rejects control characters in regex literals
const PH_RE = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g')
const HAS_PH = new RegExp(`${PH_OPEN}\\d+${PH_CLOSE}`)
const NOT_KEPT = new RegExp(`[^\\n${PH_OPEN}${PH_CLOSE}\\d]`, 'g')

/** Literal msgids of `t('…')` calls in a Twig expression. */
export function transMsgids(expr: string): string[] {
  const out: string[] = []
  const re = /\bt\(\s*(?:message\s*=\s*)?('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g
  for (const m of expr.matchAll(re)) out.push(unquoteTwig(m[1]!))
  return out
}

function unquoteTwig(lit: string): string {
  return lit.slice(1, -1).replace(/\\(.)/g, '$1')
}

/** Replaces Twig constructs by placeholders; strips Twig comments, HTML comments and script/style bodies. */
function tokenize(src: string): { html: string; phs: Placeholder[] } {
  const phs: Placeholder[] = []
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src.startsWith('{#', i)) {
      const end = src.indexOf('#}', i + 2)
      const stop = end < 0 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (src.startsWith('{{', i) || src.startsWith('{%', i)) {
      const close = src[i + 1] === '{' ? '}}' : '%}'
      let j = i + 2
      let quote: string | null = null
      while (j < src.length) {
        const ch = src[j]!
        if (quote !== null) {
          if (ch === '\\') j++
          else if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"') quote = ch
        else if (src.startsWith(close, j)) break
        j++
      }
      const text = src.slice(i, Math.min(j + 2, src.length))
      phs.push({ kind: close === '}}' ? 'print' : 'block', text, newlines: text.split('\n').length - 1 })
      out += `${PH_OPEN}${phs.length - 1}${PH_CLOSE}`
      i = j + 2
      continue
    }
    out += src[i]
    i++
  }
  // HTML comments and script/style bodies hold no controls
  const blank = (s: string) => s.replace(NOT_KEPT, ' ')
  out = out.replace(/<!--[\s\S]*?-->/g, blank)
  out = out.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, open, _t, body, close) => {
    return open + blank(body) + close
  })
  return { html: out, phs }
}

interface Tag {
  name: string
  closing: boolean
  attrs: Map<string, string | true>
  start: number
  end: number
}

function parseAttrs(s: string): Map<string, string | true> {
  const attrs = new Map<string, string | true>()
  let i = 0
  const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '/'
  while (i < s.length) {
    const c = s[i]!
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === PH_OPEN) {
      i = s.indexOf(PH_CLOSE, i) + 1
      if (i === 0) break
      continue
    }
    let j = i
    while (j < s.length && !isSpace(s[j]!) && s[j] !== '=' && s[j] !== PH_OPEN) j++
    const name = s.slice(i, j).toLowerCase()
    i = j
    while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t')) i++
    if (s[i] === '=') {
      i++
      while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t')) i++
      const q = s[i]
      let value: string
      if (q === '"' || q === "'") {
        const end = s.indexOf(q, i + 1)
        value = s.slice(i + 1, end < 0 ? s.length : end)
        i = end < 0 ? s.length : end + 1
      } else {
        let k = i
        while (k < s.length && !isSpace(s[k]!)) {
          if (s[k] === PH_OPEN) k = s.indexOf(PH_CLOSE, k)
          k++
        }
        value = s.slice(i, k)
        i = k
      }
      if (name !== '' && !attrs.has(name)) attrs.set(name, value)
    } else if (name !== '' && !attrs.has(name)) {
      attrs.set(name, true)
    }
  }
  return attrs
}

function* tags(html: string): Generator<Tag> {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  for (const m of html.matchAll(re)) {
    yield {
      name: m[2]!.toLowerCase(),
      closing: m[1] === '/',
      attrs: m[1] === '/' ? new Map() : parseAttrs(m[3] ?? ''),
      start: m.index,
      end: m.index + m[0].length,
    }
  }
}

export function parseTemplate(template: string, source: string): TemplateControl[] {
  const { html, phs } = tokenize(source)

  // line of an offset in `html`, counting the newlines hidden inside placeholders
  const lineStarts: number[] = []
  {
    let line = 1
    let k = 0
    while (k < html.length) {
      lineStarts.push(line)
      const ch = html[k]!
      if (ch === '\n') line++
      else if (ch === PH_OPEN) {
        const end = html.indexOf(PH_CLOSE, k)
        line += phs[Number(html.slice(k + 1, end))]?.newlines ?? 0
        for (let q = k + 1; q <= end; q++) lineStarts.push(line)
        k = end
      }
      k++
    }
  }
  const lineAt = (offset: number) => lineStarts[offset] ?? lineStarts[lineStarts.length - 1] ?? 1

  const placeholders = (s: string) => [...s.matchAll(PH_RE)].map((m) => phs[Number(m[1])]!)
  const msgidsIn = (s: string) =>
    placeholders(s).flatMap((p) => (p.kind === 'print' ? transMsgids(p.text) : []))
  /** Static form of an attribute value: prints → `*`, blocks dropped. */
  const resolved = (v: string | true | undefined): { text: string; dynamic: boolean } | undefined => {
    if (v === undefined || v === true) return undefined
    let dynamic = false
    const text = v
      .replace(PH_RE, (_m, n: string) => {
        dynamic = true
        return phs[Number(n)]!.kind === 'print' ? '*' : ''
      })
      .trim()
    return { text, dynamic }
  }
  const textOf = (s: string) =>
    s
      .replace(PH_RE, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const found: TemplateControl[] = []
  const labelsFor = new Map<string, string>()
  const all = [...tags(html)]

  /** Content between an opening tag and its matching close (same name, nesting-aware). */
  const contentAfter = (idx: number): { content: string; endIdx: number } => {
    const open = all[idx]!
    let depth = 0
    for (let k = idx + 1; k < all.length; k++) {
      const t = all[k]!
      if (t.name !== open.name) continue
      if (!t.closing) depth++
      else if (depth === 0) return { content: html.slice(open.end, t.start), endIdx: k }
      else depth--
    }
    return { content: '', endIdx: idx }
  }

  const add = (c: Omit<TemplateControl, 'key' | 'template' | 'count'>) => {
    found.push({ ...c, key: `${template}#${c.local}`, template, count: 1 })
  }

  for (let idx = 0; idx < all.length; idx++) {
    const tag = all[idx]!
    if (tag.closing) continue
    const a = tag.attrs
    const name = resolved(a.get('name'))
    const id = resolved(a.get('id'))
    const line = lineAt(tag.start)
    const attrLabel = () =>
      [a.get('value'), a.get('aria-label'), a.get('title'), a.get('placeholder')]
        .flatMap((v) => (typeof v === 'string' ? msgidsIn(v) : []))
        .at(0)
    const ids = (label?: string) => ({
      ...(name !== undefined && name.text !== '' ? { name: name.text } : {}),
      ...(id !== undefined && id.text !== '' ? { id: id.text } : {}),
      ...(label !== undefined ? { label } : {}),
    })
    // a name/id made only of Twig output (`name="{{ x }}"`) identifies nothing
    const usable = (v: { text: string } | undefined) =>
      v !== undefined && v.text !== '' && /[^*]/.test(v.text)
    const localOf = (kind: string, label: string | undefined, fallback: string) =>
      usable(name)
        ? name!.text
        : usable(id)
          ? `id:${id!.text}`
          : label !== undefined
            ? `${kind}:${label}`
            : `${kind}:${fallback}`

    switch (tag.name) {
      case 'label': {
        const forId = resolved(a.get('for'))
        if (forId !== undefined && forId.text !== '') {
          const { content } = contentAfter(idx)
          const msgid = msgidsIn(content)[0]
          if (msgid !== undefined) labelsFor.set(forId.text, msgid)
        }
        break
      }
      case 'input': {
        const typeRaw = resolved(a.get('type'))
        const type = typeRaw === undefined || typeRaw.text === '' ? 'text' : typeRaw.text.toLowerCase()
        if (type === 'hidden') break
        const label = attrLabel()
        if (type === 'submit' || type === 'reset' || type === 'image' || type === 'button') {
          add({ local: localOf(type, label, `L${line}`), kind: 'submit', type, ...ids(label), line })
        } else if (type === 'radio' || type === 'checkbox') {
          const value = resolved(a.get('value'))
          const options = value !== undefined && !value.dynamic ? [value.text] : []
          add({
            local: localOf(type, label, `L${line}`),
            kind: type === 'radio' ? 'radio-group' : 'checkbox',
            type,
            ...ids(label),
            options,
            ...(value?.dynamic === true ? { dynamicOptions: true } : {}),
            line,
          })
        } else {
          add({ local: localOf(type, label, `L${line}`), kind: 'input', type, ...ids(label), line })
        }
        break
      }
      case 'select': {
        const { content, endIdx } = contentAfter(idx)
        const options: string[] = []
        let dynamicOptions = HAS_PH.test(content.replace(/<option\b[^>]*>[^<]*<\/option>/g, ''))
        for (let k = idx + 1; k < endIdx; k++) {
          const t = all[k]!
          if (t.closing || t.name !== 'option') continue
          const v = resolved(t.attrs.get('value'))
          if (v === undefined) {
            // value defaults to the option text
            const end = html.indexOf('<', t.end)
            const text = textOf(html.slice(t.end, end < 0 ? html.length : end))
            if (html.slice(t.end, end).includes(PH_OPEN)) dynamicOptions = true
            else options.push(text)
          } else if (v.dynamic) dynamicOptions = true
          else options.push(v.text)
        }
        const label = attrLabel()
        add({
          local: localOf('select', label, `L${line}`),
          kind: 'select',
          ...ids(label),
          options,
          ...(dynamicOptions ? { dynamicOptions: true } : {}),
          line,
        })
        break
      }
      case 'textarea': {
        const label = attrLabel()
        add({ local: localOf('textarea', label, `L${line}`), kind: 'textarea', ...ids(label), line })
        break
      }
      case 'button': {
        const { content } = contentAfter(idx)
        const label = msgidsIn(content)[0] ?? attrLabel()
        const typeRaw = resolved(a.get('type'))
        const type = typeRaw?.text.toLowerCase() || 'submit'
        add({ local: localOf('button', label, `L${line}`), kind: 'button', type, ...ids(label), line })
        break
      }
      case 'a': {
        const { content } = contentAfter(idx)
        const label = msgidsIn(content)[0] ?? attrLabel()
        if (label === undefined) break
        add({ local: `link:${label}`, kind: 'link', ...ids(label), line })
        break
      }
    }
  }

  // link_or_button(url, params, t('Label'), …) printed outside tags
  for (const m of html.matchAll(PH_RE)) {
    const ph = phs[Number(m[1])]!
    if (ph.kind !== 'print' || !/\blink_or_button\s*\(/.test(ph.text)) continue
    const label = transMsgids(ph.text)[0]
    if (label === undefined) continue
    found.push({
      key: `${template}#link:${label}`,
      template,
      local: `link:${label}`,
      kind: 'link',
      label,
      line: lineAt(m.index),
      count: 1,
    })
  }

  // merge controls sharing a key: radio groups, checkbox groups, repeated links
  const merged = new Map<string, TemplateControl>()
  for (const c of found) {
    if (c.label === undefined && c.id !== undefined && labelsFor.has(c.id)) c.label = labelsFor.get(c.id)!
    const prev = merged.get(c.key)
    if (prev === undefined) {
      merged.set(c.key, c)
      continue
    }
    prev.count++
    if (prev.kind === 'checkbox' && c.kind === 'checkbox') prev.kind = 'checkbox-group'
    if (c.options !== undefined) {
      const set = new Set([...(prev.options ?? []), ...c.options])
      prev.options = [...set]
    }
    if (c.dynamicOptions === true) prev.dynamicOptions = true
    if (prev.label === undefined && c.label !== undefined) prev.label = c.label
    if (prev.id !== undefined && c.id !== undefined && prev.id !== c.id) delete prev.id
  }
  return [...merged.values()].sort((x, y) => x.line - y.line || x.local.localeCompare(y.local))
}
