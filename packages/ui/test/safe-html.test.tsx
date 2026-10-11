import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SAFE_HTML_TAGS, SafeHtml, sanitizeHtml, stripTags } from '../src/components/safe-html.tsx'

describe('SafeHtml (Sanitize::sanitizeMessage allow-list)', () => {
  it('keeps the documented tag set (docs/architecture/07-security.md)', () => {
    for (const tag of ['a', 'b', 'i', 'em', 'strong', 'br', 'code', 'kbd', 'sup', 'sub', 'p', 'pre', 'span'])
      expect(SAFE_HTML_TAGS).toContain(tag)
    expect(SAFE_HTML_TAGS).not.toContain('img')
    expect(SAFE_HTML_TAGS).not.toContain('script')
  })

  it('never emits markup without a DOM to sanitize with: escapes instead', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)><b>x</b>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;x&lt;/b&gt;',
    )
    expect(renderToStaticMarkup(<SafeHtml as="dd" html="<script>x</script>" />)).toBe(
      '<dd>&lt;script&gt;x&lt;/script&gt;</dd>',
    )
  })

  it('stripTags without a DOM drops the tags', () => {
    expect(stripTags('a <b>primary</b> <a href="#">x</a>')).toBe('a primary x')
  })
})
