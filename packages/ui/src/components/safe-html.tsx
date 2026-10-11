import DOMPurify, { type Config } from 'dompurify'
import { type ComponentProps, type ElementType, useMemo } from 'react'

/**
 * The one place that turns an HTML string into DOM (docs/architecture/07-security.md#injection):
 * translated msgids that carry markup (`<b>`, `<code>`, links), advisor texts, documentation
 * snippets. DOMPurify with phpMyAdmin's `Sanitize::sanitizeMessage` tag set; links only to
 * http(s), relative (`./…`) or in-page (`#…`) targets, external ones open in a new window.
 * pma: src/Sanitize.php::sanitizeMessage
 */
export const SAFE_HTML_TAGS = [
  'a',
  'b',
  'i',
  'em',
  'strong',
  'br',
  'code',
  'kbd',
  'sup',
  'sub',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'p',
  'pre',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]
export const SAFE_HTML_ATTRS = ['href', 'target', 'rel', 'title', 'class', 'dir', 'lang']
const SAFE_HREF = /^(?:https?:\/\/|\.\/|#)/i

const CONFIG: Config = {
  ALLOWED_TAGS: SAFE_HTML_TAGS,
  ALLOWED_ATTR: SAFE_HTML_ATTRS,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
}

let hooked = false
function purifier() {
  if (!hooked && DOMPurify.isSupported) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeName !== 'A') return
      const href = node.getAttribute('href')
      if (href !== null && !SAFE_HREF.test(href.trim())) node.removeAttribute('href')
      if (/^https?:\/\//i.test(node.getAttribute('href') ?? '')) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      } else if (node.getAttribute('target') !== null) {
        node.setAttribute('rel', 'noopener noreferrer')
      }
    })
    hooked = true
  }
  return DOMPurify
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)

/**
 * Sanitized HTML string. Without a DOM (server-side, workers, node tests) DOMPurify cannot run,
 * so the input is escaped instead: never unsanitized markup.
 */
export function sanitizeHtml(html: string): string {
  const p = purifier()
  return p.isSupported ? p.sanitize(html, CONFIG) : escapeHtml(html)
}

/** A sanitized DocumentFragment (CodeMirror tooltips and other DOM APIs that want nodes). */
export function sanitizeToFragment(html: string): DocumentFragment {
  const p = purifier()
  if (!p.isSupported) {
    const f = document.createDocumentFragment()
    f.append(html)
    return f
  }
  return p.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true })
}

/** Twig's `striptags`: the text of an HTML string, parsed inertly (no image loads, no handlers). */
export function stripTags(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '')
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
}

type SafeHtmlProps<T extends ElementType> = {
  /** Markup to render; sanitized with the allow-list above. */
  html: string
  /** Wrapper element, `span` by default. */
  as?: T
} & Omit<ComponentProps<T>, 'children' | 'dangerouslySetInnerHTML'>

/** `<SafeHtml html={t('… <b>primary</b> …')} />` — the only component allowed to set innerHTML. */
export function SafeHtml<T extends ElementType = 'span'>({ html, as, ...props }: SafeHtmlProps<T>) {
  const Tag = (as ?? 'span') as ElementType
  const clean = useMemo(() => sanitizeHtml(html), [html])
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized above with the Sanitize allow-list
  return <Tag {...props} dangerouslySetInnerHTML={{ __html: clean }} />
}
