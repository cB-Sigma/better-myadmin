import { checkLink } from '@bettermyadmin/i18n'
import { phpDocUrl } from '@bettermyadmin/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../lib/config.ts'
import { qk } from '../../lib/queryKeys.ts'
import { DebugCard } from '../console/Console.tsx'
import { NodeControls } from '../navigation/NavExtras.tsx'
import { logoTarget } from '../navigation/check-link.ts'
import { DemoBanner } from './DemoBanner.tsx'

/** Feature 01 checklist items proved on the web app's logic and components. */
describe('feature 01 shell', () => {
  it('[p01-df1754] Sanitize::checkLink: https, the /url redirector, docs, index.php; http and mailto/ftp on demand', () => {
    expect(checkLink('https://example.org')).toBe(true)
    expect(checkLink('index.php?route=/url&url=https%3A%2F%2Fexample.org')).toBe(true)
    expect(checkLink('./docs/html/index.html')).toBe(true)
    expect(checkLink('./index.php?route=/server/sql')).toBe(true)
    expect(checkLink('http://example.org')).toBe(false)
    expect(checkLink('http://example.org', true)).toBe(true)
    expect(checkLink('mailto:a@b')).toBe(false)
    expect(checkLink('mailto:a@b', false, true)).toBe(true)
    expect(checkLink('javascript:alert(1)', true, true)).toBe(false)
  })

  it('[p01-a5b403] the logo link: NavigationLogoLink / NavigationLogoLinkWindow, invalid links fall back to index.php', () => {
    expect(logoTarget('index.php', 'main')).toEqual({ kind: 'home', newWindow: false })
    expect(logoTarget('', 'main')).toEqual({ kind: 'none' })
    expect(logoTarget(' https://example.org/ ', 'new')).toEqual({
      kind: 'external',
      href: 'https://example.org/',
      newWindow: true,
    })
    expect(logoTarget('http://intranet/', 'main')).toEqual({
      kind: 'external',
      href: 'http://intranet/',
      newWindow: false,
    })
    // not a valid link: the home page
    expect(logoTarget('javascript:alert(1)', 'main')).toEqual({ kind: 'home', newWindow: false })
    expect(logoTarget('ftp://files/', 'main')).toEqual({ kind: 'home', newWindow: false })
  })

  it('[p01-39786c] DBG/demo: the demo server notice with the Git revision and branch (custom header/footer files: X48)', () => {
    const render = (demo: boolean, build: unknown) => {
      const qc = new QueryClient()
      qc.setQueryData(qk.config, { ...DEFAULT_CLIENT_CONFIG, DBG: { demo } })
      qc.setQueryData(qk.build, build)
      return renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <DemoBanner server={1} />
        </QueryClientProvider>,
      )
    }
    expect(render(false, null)).toBe('')
    const html = render(true, { name: 'BetterMyAdmin', version: '1', commit: 'abcdef0123', branch: 'main' })
    expect(html).toContain('id="pma_demo"')
    expect(html).toContain('BetterMyAdmin Demo Server')
    expect(html).toContain(
      'Currently running Git revision <strong>abcdef0</strong> from the <strong>main</strong> branch.',
    )
    expect(render(true, { name: 'B', version: '1', commit: null, branch: null })).toContain(
      'Git information missing!',
    )
  })

  it('[p01-62e957] the PHP manual by language; external links go direct with noreferrer instead of /url (X35)', () => {
    expect(phpDocUrl('function.mysqli-connect.php', 'de')).toBe(
      'https://www.php.net/manual/de/function.mysqli-connect.php',
    )
    expect(phpDocUrl('x.php', 'zh_TW')).toBe('https://www.php.net/manual/zh/x.php')
    expect(phpDocUrl('x.php', 'xx')).toBe('https://www.php.net/manual/en/x.php')
  })

  it('[p01-f71193] a hide control on a database child (containers too); a database with hidden items offers to show them', () => {
    const render = (node: object) =>
      renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <NodeControls server={1} node={node as never} onChanged={() => {}} />
        </QueryClientProvider>,
      )
    const table = render({
      kind: 'table',
      realName: 't',
      hide: { itemName: 't', itemType: 'table', dbName: 'd' },
    })
    expect(table).toContain('class="hideNavItem"')
    expect(table).toContain('title="Hide"')
    const container = render({
      kind: 'container',
      realName: 'tables',
      hide: { itemName: 'tables', itemType: 'group', dbName: 'd' },
    })
    expect(container).toContain('class="hideNavItem"')
    const db = render({ kind: 'database', realName: 'd', hiddenCount: 2 })
    expect(db).toContain('class="showUnhide"')
    expect(db).toContain('title="Show hidden items"')
    expect(render({ kind: 'database', realName: 'd', hiddenCount: 0 })).toBe('')
  })

  it('[p01-d7fef2] the Debug SQL card: totals, grouping with counts, ordering by execution, time or count', () => {
    const log = [
      { sql: 'SELECT 1', ms: 2 },
      { sql: 'SELECT 2', ms: 5 },
      { sql: 'SELECT 1', ms: 3 },
    ]
    const render = (settings: object) =>
      renderToStaticMarkup(
        <DebugCard log={log} settings={settings as never} set={() => {}} onClose={() => {}} />,
      )
    const base = { Order: 'asc', OrderBy: 'exec', GroupQueries: false }
    const plain = render(base)
    expect(plain).toContain('3 queries executed 3 times in 0.01 seconds.')
    expect(plain.match(/class="text time"/g)?.length).toBe(3)
    const grouped = render({ ...base, GroupQueries: true, OrderBy: 'count', Order: 'desc' })
    expect(grouped).toContain('2 queries executed 3 times in 0.01 seconds.')
    // SELECT 1 (2 runs) first when ordered by count, descending
    expect(grouped.indexOf('Count: <span>2</span>')).toBeLessThan(grouped.indexOf('Count: <span>1</span>'))
    const byTime = render({ ...base, OrderBy: 'time', Order: 'desc' })
    expect(byTime.indexOf('0.005000s')).toBeLessThan(byTime.indexOf('0.003000s'))
  })
})
