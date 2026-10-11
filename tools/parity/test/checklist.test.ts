import { describe, expect, it } from 'vitest'
import { SUFFIX_MARK, assignIds, parseChecklist, rewriteChecklist, similarity } from '../src/checklist.ts'
import { linkChecklist, resultFor } from '../src/coverage.ts'
import { msgKey, parsePot } from '../src/extract/pot.ts'
import { type TestCase, parsePlaywrightJson, parseVitestJson, scanTestFile } from '../src/tests.ts'

const DOC = [
  '# 01 — Shell',
  '',
  '## Micro-behaviours checklist',
  '',
  'Navigation panel',
  '- [ ] Panel width persisted on drag end.',
  '- [x] Reload icon re-fetches the tree. <!-- parity:test --> `p01-aaaaaa` [x.test.ts:1](x)',
  '',
  '```',
  '- [ ] not an item (code block)',
  '```',
  '',
  '### Security',
  '- [ ] CSP header. <!-- parity:n/a: PHP-only -->',
].join('\n')
const FILE = 'docs/features/01-shell.md'

describe('checklist parsing', () => {
  const items = parseChecklist(FILE, DOC)
  it('reads items with their section and marker, skipping code blocks and suffixes', () => {
    expect(items).toEqual([
      {
        file: FILE,
        area: '01',
        section: 'Micro-behaviours checklist › Navigation panel',
        text: 'Panel width persisted on drag end.',
        line: 6,
        checked: false,
      },
      {
        file: FILE,
        area: '01',
        section: 'Micro-behaviours checklist › Navigation panel',
        text: 'Reload icon re-fetches the tree.',
        line: 7,
        checked: true,
      },
      {
        file: FILE,
        area: '01',
        section: 'Micro-behaviours checklist › Security',
        text: 'CSP header.',
        line: 14,
        checked: false,
        na: 'PHP-only',
      },
    ])
  })

  it('keeps ids stable when an item is edited, moved to another section or reordered', () => {
    const first = assignIds(items, {})
    expect(first.minted).toHaveLength(3)
    expect(first.items[0]!.id).toMatch(/^p01-[0-9a-f]{6}$/)
    const edited = DOC.replace(
      'Panel width persisted on drag end.',
      'Panel width persisted on drag end and collapse.',
    ).replace('### Security', '### Security headers')
    const again = assignIds(parseChecklist(FILE, edited), first.ids)
    expect(again.minted).toEqual([])
    expect(again.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id))
    expect(again.ids[first.items[0]!.id]!.text).toBe('Panel width persisted on drag end and collapse.')
    const removed = assignIds(parseChecklist(FILE, DOC.replace(/^- \[ \] Panel.*$/m, '')), first.ids)
    expect(removed.removed).toEqual([first.items[0]!.id])
  })

  it('tells an edited item from a different one', () => {
    expect(
      similarity('Panel width persisted on drag end.', 'Panel width persisted on drag end and collapse.'),
    ).toBeGreaterThan(0.8)
    expect(
      similarity('Panel width persisted on drag end.', 'Panel hidden by default below 768px.'),
    ).toBeLessThan(0.6)
  })

  it('rewrites only the marker and the suffix', () => {
    const { items: withIds } = assignIds(items, {})
    const [a, b] = withIds
    const out = rewriteChecklist(DOC, FILE, withIds, new Map([[a!.id, '`ref-a`']]))
    const lines = out.split('\n')
    expect(lines[5]).toBe(`- [x] Panel width persisted on drag end. ${SUFFIX_MARK} \`ref-a\``)
    expect(lines[6]).toBe('- [ ] Reload icon re-fetches the tree.')
    expect(lines[13]).toBe('- [ ] CSP header. <!-- parity:n/a: PHP-only -->')
    expect(rewriteChecklist(out, FILE, withIds, new Map([[a!.id, '`ref-a`']]))).toBe(out)
    void b
  })
})

describe('test linking', () => {
  const source = [
    "describe('nav', () => {",
    "  it('reloads the tree [p01-abc123]', () => {})",
    "  it('Panel width persisted on drag end.', () => {})",
    "  test.describe('inner', () => { test(`row ${'x'} works`, () => {}) })",
    '})',
    "const CASES = [{ name: 'case one [p09-def456]' }, { name: 'case two' }]",
    'for (const c of CASES) {',
    '  it(c.name, async () => {})',
    '}',
  ].join('\n')
  const tests = scanTestFile('vitest-unit', 'x.test.ts', source)
  it('collects full titles, template titles and case tables', () => {
    expect(tests.map((t) => t.fullTitle)).toEqual([
      'nav > reloads the tree [p01-abc123]',
      'nav > Panel width persisted on drag end.',
      'nav > inner > row … works',
      'case one [p09-def456]',
      'case two',
    ])
    expect(tests[3]!.line).toBe(6)
  })

  it('links items by id or exact text', () => {
    const items = [
      {
        id: 'p01-abc123',
        file: FILE,
        area: '01',
        section: '',
        text: 'Something else entirely',
        line: 1,
        checked: false,
      },
      {
        id: 'p01-000000',
        file: FILE,
        area: '01',
        section: '',
        text: 'Panel width persisted on drag end.',
        line: 2,
        checked: false,
      },
      { id: 'p09-def456', file: FILE, area: '09', section: '', text: 'Unrelated', line: 3, checked: false },
    ]
    const links = linkChecklist(items, tests)
    expect(links.get('p01-abc123')?.map((t) => t.line)).toEqual([2])
    expect(links.get('p01-000000')?.map((t) => t.line)).toEqual([3])
    expect(links.get('p09-def456')?.map((t) => t.line)).toEqual([6])
  })

  it('matches results, including titles with substitutions', () => {
    const results = parseVitestJson(
      'vitest-unit',
      {
        testResults: [
          {
            name: '/repo/x.test.ts',
            assertionResults: [
              { ancestorTitles: ['nav', 'inner'], title: 'row 7 works', status: 'failed' },
              { ancestorTitles: ['nav'], title: 'reloads the tree [p01-abc123]', status: 'passed' },
            ],
          },
        ],
      },
      '/repo',
    )
    const t = (i: number) => tests[i] as TestCase
    expect(resultFor(t(0), results)?.status).toBe('passed')
    expect(resultFor(t(2), results)?.status).toBe('failed')
    expect(resultFor(t(1), results)).toBeUndefined()
  })

  it('reads Playwright JSON (file suites, describe blocks, retries)', () => {
    const r = parsePlaywrightJson(
      'playwright-web',
      {
        config: { rootDir: '/repo/apps/web/e2e' },
        suites: [
          {
            title: 'navigation.spec.ts',
            file: 'navigation.spec.ts',
            specs: [
              {
                title: 'top',
                file: 'navigation.spec.ts',
                tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }],
              },
            ],
            suites: [
              {
                title: 'group',
                file: 'navigation.spec.ts',
                specs: [
                  {
                    title: 'inner',
                    file: 'navigation.spec.ts',
                    tests: [{ results: [{ status: 'skipped' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      '/repo',
    )
    expect(r).toEqual([
      {
        suite: 'playwright-web',
        file: 'apps/web/e2e/navigation.spec.ts',
        fullTitle: 'top',
        status: 'passed',
      },
      {
        suite: 'playwright-web',
        file: 'apps/web/e2e/navigation.spec.ts',
        fullTitle: 'group > inner',
        status: 'skipped',
      },
    ])
  })
})

describe('pot reader', () => {
  it('keeps references, contexts, plurals and continuation lines', () => {
    const pot = parsePot(
      [
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: x\\n"',
        '',
        '#: resources/templates/a.twig:3',
        '#: src/B.php:10 src/C.php:11',
        'msgid "Hello"',
        'msgstr ""',
        '',
        '#: src/D.php:1',
        'msgctxt "Create new user"',
        'msgid "New"',
        'msgstr ""',
        '',
        '#, php-format',
        'msgid ""',
        '"%d row "',
        '"\\"quoted\\""',
        'msgid_plural "%d rows"',
        'msgstr[0] ""',
        '',
      ].join('\n'),
    )
    expect(pot).toEqual([
      {
        msgid: 'Hello',
        context: null,
        plural: null,
        refs: ['resources/templates/a.twig:3', 'src/B.php:10', 'src/C.php:11'],
      },
      { msgid: 'New', context: 'Create new user', plural: null, refs: ['src/D.php:1'] },
      { msgid: '%d row "quoted"', context: null, plural: '%d rows', refs: [] },
    ])
    expect(msgKey('New', 'Create new user')).toBe('Create new user\u0004New')
  })
})
