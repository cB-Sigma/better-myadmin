import { type ComponentProps, useMemo } from 'react'

/**
 * Server- or plugin-produced HTML (phpMyAdmin builds some cells and messages as HTML strings,
 * e.g. transformation output) rendered through an allow-list: unknown tags are unwrapped, event
 * handlers and `javascript:` URLs are dropped. The only place that sets innerHTML.
 */
const TAGS = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'dfn',
  'div',
  'em',
  'i',
  'iframe',
  'img',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const ATTRS = new Set([
  'href',
  'title',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  'width',
  'height',
  'border',
  'dir',
  'lang',
  'srcdoc',
  'sandbox',
  'colspan',
  'rowspan',
])

function clean(node: Node, doc: Document): Node | DocumentFragment | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style') return null
  const kids = [...el.childNodes].map((c) => clean(c, doc)).filter((c): c is Node => c !== null)
  if (!TAGS.has(tag)) {
    const f = doc.createDocumentFragment()
    for (const k of kids) f.appendChild(k)
    return f
  }
  const out = doc.createElement(tag)
  for (const a of [...el.attributes]) {
    const name = a.name.toLowerCase()
    if (!ATTRS.has(name)) continue
    if (
      (name === 'href' || name === 'src') &&
      /^\s*(javascript|vbscript|data):/i.test(a.value) &&
      !(tag === 'img' && /^\s*data:image\//i.test(a.value))
    )
      continue
    out.setAttribute(name, a.value)
  }
  // an iframe is only kept sandboxed (Text_Plain_Formatted)
  if (tag === 'iframe') {
    out.setAttribute('sandbox', '')
    out.removeAttribute('src')
  }
  for (const k of kids) out.appendChild(k)
  return out
}

/** Sanitises an HTML fragment with the allow-list above. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = doc.createElement('div')
  for (const c of [...doc.body.childNodes]) {
    const n = clean(c, doc)
    if (n !== null) out.appendChild(n)
  }
  return out.innerHTML
}

export function SafeHtml({
  html,
  as: Tag = 'span',
  ...props
}: Omit<ComponentProps<'span'>, 'children' | 'dangerouslySetInnerHTML' | 'ref'> & {
  html: string
  as?: 'span' | 'div'
}) {
  const safe = useMemo(() => sanitizeHtml(html), [html])
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by the allow-list above
  return <Tag {...props} dangerouslySetInnerHTML={{ __html: safe }} />
}
