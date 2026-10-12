import { describe, expect, it } from 'vitest'
import { renderChangelog } from '../../src/shell/about.ts'

const REPO = 'https://github.com/o/r'

describe('renderChangelog (ChangeLogController)', () => {
  it("applies phpMyAdmin's rewrites for the project's repository", () => {
    const md = [
      '# Changes in BetterMyAdmin 1.0',
      '',
      '## [1.0.1] - 2026-01-02',
      '',
      '### Fixed',
      '- [#12](https://github.com/o/r/issues/12) a <bug>, see FAQ 1.2 and CVE-2024-1234',
      '',
      '## [1.0.2] - YYYY-MM-DD',
      '',
      `[1.0.1]: ${REPO}/releases/tag/1.0.1`,
      `[1.0.2]: ${REPO}/compare/1.0.1...main`,
    ].join('\n')
    const html = renderChangelog(md, REPO, 'https://docs/faq.html')
    expect(html).toContain('<h1>Changes in BetterMyAdmin 1.0</h1>')
    expect(html).toContain(
      `<h2><a target="_blank" rel="noopener noreferrer" href="${REPO}/releases/tag/1.0.1">1.0.1</a> 2026-01-02</h2>`,
    )
    expect(html).toContain('<h3>Fixed</h3>')
    expect(html).toContain(`<a target="_blank" rel="noopener noreferrer" href="${REPO}/issues/12">#12</a>`)
    expect(html).toContain('a &lt;bug&gt;')
    expect(html).toContain('href="https://docs/faq.html#faq1-2">FAQ 1.2</a>')
    expect(html).toContain('href="https://www.cve.org/CVERecord?id=CVE-2024-1234">CVE-2024-1234</a>')
    expect(html).toContain('1.0.2</a> (not yet released)</h2>')
  })
})
