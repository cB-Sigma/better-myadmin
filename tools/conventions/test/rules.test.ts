import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/check.ts'
import { RULES, type Source } from '../src/rules.ts'

const run = (files: Source[], allow = [] as Parameters<typeof evaluate>[1]) => evaluate(files, allow)
const rulesOf = (files: Source[]) => run(files).violations.map((v) => v.rule)

describe('conventions rules', () => {
  it('flags fetch outside lib/api.ts and accepts it inside', () => {
    expect(rulesOf([{ path: 'apps/web/src/features/x/A.tsx', text: 'fetch("/api")' }])).toEqual([
      'web/no-fetch',
    ])
    expect(rulesOf([{ path: 'apps/web/src/lib/api.ts', text: 'await fetch("/api")' }])).toEqual([])
    // `refetch()` and `prefetch()` are not fetch
    expect(rulesOf([{ path: 'apps/web/src/features/x/A.tsx', text: 'q.refetch(); onPrefetch()' }])).toEqual(
      [],
    )
  })

  it('flags feature-local api clients, key factories and inline query keys', () => {
    const text = `import { call } from '../../lib/api'
export const fooKeys = { a: () => ['a'] as const }
useQuery({ queryKey: ['srv', 1], queryFn })
useQuery({ queryKey: qk.home(1), queryFn })`
    expect(rulesOf([{ path: 'apps/web/src/features/x/api.ts', text }])).toEqual([
      'web/api-module',
      'web/query-keys',
      'web/query-keys',
    ])
  })

  it('allows dangerouslySetInnerHTML only in SafeHtml', () => {
    const text = '<div dangerouslySetInnerHTML={{ __html: x }} />'
    expect(rulesOf([{ path: 'apps/web/src/features/x/A.tsx', text }])).toEqual(['no-dangerous-html'])
    expect(rulesOf([{ path: 'packages/ui/src/components/safe-html.tsx', text }])).toEqual([])
  })

  it('flags locally defined primitives in apps, not in packages/ui', () => {
    const text =
      'export function Button() { return null }\nconst Modal = () => null\nfunction ColumnForm() {}'
    expect(run([{ path: 'apps/web/src/features/x/ui.tsx', text }]).violations.map((v) => v.symbol)).toEqual([
      'Button',
      'Modal',
    ])
    expect(
      rulesOf([{ path: 'packages/ui/src/components/button.tsx', text: 'export function Button() {}' }]),
    ).toEqual([])
  })

  it('flags raw colours but not anchors or tokens', () => {
    const file = (text: string) => [{ path: 'apps/web/src/features/x/A.tsx', text }]
    expect(rulesOf(file(`const c = '#4e79a7'`))).toEqual(['web/no-raw-colors'])
    expect(rulesOf(file(`<div className="bg-[#fff]" />`))).toEqual(['web/no-raw-colors'])
    expect(rulesOf(file(`const s = { color: 'rgb(1, 2, 3)' }`))).toEqual(['web/no-raw-colors'])
    expect(rulesOf(file(`<a href="#pma_navigation">x</a>; const c = 'var(--chart-1)'`))).toEqual([])
    expect(rulesOf([{ path: 'apps/web/src/styles/app.css', text: 'a { color: #fff }' }])).toEqual([])
  })

  it('limits route files to 60 lines', () => {
    const text = Array.from({ length: 61 }, (_, i) => `// ${i}`).join('\n')
    expect(rulesOf([{ path: 'apps/web/src/routes/s/x.tsx', text }])).toEqual(['web/route-size'])
  })

  it('flags SQL text, raw safeParse and untranslated errors in route handlers', () => {
    const text = `r.get('/x', async (c) => {
  const p = Schema.safeParse(1)
  await conn.query(\`SELECT 1 FROM \${t}\`, 'x.y')
  throw new ValidationError('Invalid request.')
})
throw new NotFoundError(tr.gettext('Not found'))
const label = 'Select all'`
    const app = { path: 'apps/server/src/app.ts', text: "app.use('/api/*', () => { throw new CsrfError() })" }
    expect(rulesOf([app, { path: 'apps/server/src/routes/x.ts', text }]).sort()).toEqual([
      'server/no-sql-in-routes',
      'server/strings-through-tr',
      'server/validate',
    ])
    expect(rulesOf([app, { path: 'apps/server/src/routes/y.ts', text: 'q(`USE ${db}`)' }])).toEqual([
      'server/no-sql-in-routes',
    ])
    // services may hold SQL
    expect(rulesOf([{ path: 'apps/server/src/x/service.ts', text: "q('SELECT 1')" }])).toEqual([])
  })

  it('asserts the CSRF middleware precedes every mounted route', () => {
    const ok = `app.use('/api/*', async (c, next) => { if (bad) throw new CsrfError(); await next() })
app.route('/api/auth', authRoutes)`
    expect(rulesOf([{ path: 'apps/server/src/app.ts', text: ok }])).toEqual([])
    const bad = `app.route('/api/auth', authRoutes)
app.use('/api/*', async (c, next) => { throw new CsrfError() })
app.post('/other', h)`
    // mounted before the middleware; mounted outside /api/*
    expect(rulesOf([{ path: 'apps/server/src/app.ts', text: bad }]).length).toBe(2)
  })

  it('flags names exported by two packages, honouring the allow-list', () => {
    const files = [
      { path: 'packages/a/src/x.ts', text: 'export function trim() {}' },
      { path: 'packages/b/src/y.ts', text: 'export const trim = () => 1' },
      { path: 'packages/b/src/z.ts', text: 'export function other() {}' },
    ]
    expect(rulesOf(files)).toEqual(['no-duplicate-exports', 'no-duplicate-exports'])
    const r = run(files, [{ rule: 'no-duplicate-exports', symbol: 'trim', reason: 'test' }])
    expect(r.violations).toEqual([])
    expect(r.allowed.length).toBe(2)
  })

  it('reports stale allow-list entries', () => {
    const r = run([], [{ rule: 'web/no-fetch', file: 'apps/web/src/gone.ts', reason: 'test' }])
    expect(r.stale.length).toBe(1)
  })

  it('keeps tests/parity on one client with one helper family', () => {
    const client = `export class PmaClient {
  login() {}
  getPage() {}
  pagePost() {}
  async #req() { return fetch('x') }
}`
    const v = run([
      { path: 'tests/parity/lib/pma.ts', text: client },
      { path: 'tests/parity/x.parity.test.ts', text: "await fetch('http://x')\nclass OtherClient {}" },
    ]).violations
    expect(v.map((x) => x.symbol ?? x.file)).toEqual([
      'pagePost',
      'tests/parity/x.parity.test.ts',
      'OtherClient',
    ])
  })

  it('every rule links a golden-path section', () => {
    for (const r of RULES) expect(r.doc).toMatch(/^[a-z-]+$/)
  })
})
