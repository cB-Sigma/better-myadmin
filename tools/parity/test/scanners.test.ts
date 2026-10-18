import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { findApi, findUi } from '../src/coverage.ts'
import { type SourceFile, collectChains, directiveUses, scanMsgids } from '../src/scan/code.ts'
import { scanControlClaims, verifyClaim } from '../src/scan/controls.ts'
import { joinPath, normalizePath, scanHono } from '../src/scan/hono.ts'
import { fileToRoute } from '../src/scan/tanstack.ts'

const fixtures = join(import.meta.dirname, 'fixtures')

describe('Hono route scanner', () => {
  const endpoints = scanHono(join(fixtures, 'server'), fixtures)
  it('follows .route() mounts through imports, joins prefixes and drops catch-alls', () => {
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /api/child',
      'PATCH /api/child/item/:id',
      'PUT /api/child/item/:id',
      'GET /api/child/load/:id',
      'POST /api/child/save',
      'GET /api/health',
      'DELETE /api/servers/:s/deep/inner/x',
    ])
    expect(endpoints[0]).toMatchObject({ file: 'server/routes/child.ts', line: 5 })
  })

  it('normalises params and slashes', () => {
    expect(normalizePath('/a/:s{[0-9]+}//b/')).toBe('/a/:s/b')
    expect(joinPath('/api/x', '/')).toBe('/api/x')
  })

  it('matches map targets by method and path, any param name', () => {
    expect(findApi('POST /api/child/save', endpoints)).toBeDefined()
    expect(findApi('GET /api/child/save', endpoints)).toBeUndefined()
    expect(findApi('/api/child/load/:other', endpoints)?.method).toBe('GET')
    expect(findApi('DELETE /api/servers/{server}/deep/inner/x', endpoints)).toBeDefined()
    expect(findApi('/api/child/*', endpoints)).toBeDefined()
    expect(findApi('/api/nothing/*', endpoints)).toBeUndefined()
  })
})

describe('TanStack file routes', () => {
  it('maps file names to paths', () => {
    expect(fileToRoute('index.tsx')).toEqual({ path: '/', splat: false })
    expect(fileToRoute('s/$server/route.tsx')).toEqual({ path: '/s/:server', splat: false })
    expect(fileToRoute('s/$server/db/$db/index.tsx')).toEqual({ path: '/s/:server/db/:db', splat: false })
    expect(fileToRoute('s/$server/sql.tsx')).toEqual({ path: '/s/:server/sql', splat: false })
    expect(fileToRoute('s/$server/db/$db/t/$table/structure_.add.tsx')).toEqual({
      path: '/s/:server/db/:db/t/:table/structure/add',
      splat: false,
    })
    expect(fileToRoute('s/$server/$.tsx')).toEqual({ path: '/s/:server/*', splat: true })
    expect(fileToRoute('s/_layout/about.tsx')).toEqual({ path: '/s/about', splat: false })
    expect(fileToRoute('s.$server.status.tsx')).toEqual({ path: '/s/:server/status', splat: false })
    expect(fileToRoute('__root.tsx')).toBeNull()
  })

  it('never lets a splat or a placeholder route satisfy a target', () => {
    const routes = [
      { path: '/s/:server/*', splat: true, placeholder: false, file: 'a' },
      { path: '/s/:server/db/:db', splat: false, placeholder: true, file: 'b' },
      { path: '/s/:server/sql', splat: false, placeholder: false, file: 'c' },
    ]
    expect(findUi('/s/:s/sql', routes)?.file).toBe('c')
    expect(findUi('/s/:s/status', routes)).toBeUndefined()
    expect(findUi('/s/:s/db/:db', routes)).toBeUndefined()
  })
})

function sources(files: Record<string, string>): { repo: string; list: SourceFile[] } {
  const repo = mkdtempSync(join(tmpdir(), 'parity-code-'))
  const list: SourceFile[] = []
  for (const [file, text] of Object.entries(files)) {
    const abs = join(repo, file)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, text)
    list.push({
      file,
      sf: ts.createSourceFile(
        abs,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    })
  }
  return { repo, list }
}

describe('directive consumption', () => {
  const { list } = sources({
    'apps/server/a.ts': [
      'export function f(cfg: any, server: any, deps: any) {',
      '  const n = cfg.MaxRows + deps.cfg.Listen?.basePath.length',
      '  const { LoginCookieValidity } = cfg',
      '  if (server.DisableIS) return cfg.Servers[1].host',
      "  return cfg['Lang'] ?? 'Export/csv_columns' + other.Confirm + x.MaxNavigationItems",
      '}',
    ].join('\n'),
  })
  const idx = collectChains(list)
  const uses = (p: string) => directiveUses(p, idx).map((u) => u.line)
  it('finds property chains, destructuring, element access and path literals', () => {
    expect(uses('MaxRows')).toEqual([2])
    expect(uses('Listen/basePath')).toEqual([2])
    expect(uses('LoginCookieValidity')).toEqual([3])
    expect(uses('Servers/*/DisableIS')).toEqual([4])
    expect(uses('Servers/*/host')).toEqual([4])
    expect(uses('Lang')).toEqual([5])
    expect(uses('Export/csv_columns')).toEqual([5])
  })
  it('needs a config-like receiver for single-hump names, not for distinctive ones', () => {
    expect(uses('Confirm')).toEqual([])
    expect(uses('MaxNavigationItems')).toEqual([5])
  })
})

describe('msgid scan', () => {
  const { repo, list } = sources({
    'apps/web/tabs.ts': "export const TABS = [{ text: 'Databases' }, { text: 'SQL' }]\n",
    'apps/web/Shell.tsx': [
      "import { TABS } from './tabs'",
      "export const Msg = { expired: 'Your session has expired.' }",
      "const single = 'Log out'",
      'export function S() {',
      "  return [t('Go'), __('Edit'), ngettext('%d row', '%d rows', 2), pgettext('Create new user', 'New'),",
      '    tr.gettext(Msg.expired), t(single), TABS.map((tab) => t(tab.text)), <Trans id="Welcome to %s" />]',
      '}',
    ].join('\n'),
  })
  const found = scanMsgids(list, repo)
  it('reads literal calls, Trans ids, contexts and resolved constants', () => {
    const keys = found.map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(['Go', 'Edit', '%d row', 'Create new user\u0004New', 'Welcome to %s']),
    )
    expect(found.find((f) => f.key === 'Your session has expired.')?.via).toBe('constant')
    expect(found.find((f) => f.key === 'Log out')?.via).toBe('constant')
    expect(found.filter((f) => f.via === 'property').map((f) => f.key)).toEqual(['Databases', 'SQL'])
  })
})

describe('msgid scan: markers, conditionals and JSON message tables', () => {
  const { repo, list } = sources({
    'packages/kbs/src/index.ts':
      "export { default as kb } from './generated/kb.json' with { type: 'json' }\n",
    'packages/kbs/src/rules.ts': [
      "import rules from './generated/rules.json' with { type: 'json' }",
      'export const names = (tr: any) => rules.list.map((rule) => tr.gettext(rule.name))',
    ].join('\n'),
    'apps/server/a.ts': [
      "import { kb } from '@bettermyadmin/kbs'",
      "const LABELS = { a: N_('Allows reading data.'), b: NC_('Collation', 'Swedish') }",
      'export function f(tr: any, lock: boolean, name: string) {',
      '  const descriptions = kb.descriptions',
      "  return [tr.gettext(lock ? 'Locked.' : 'Unlocked.'), tProduct('Hello phpMyAdmin'),",
      '    tr.gettext(descriptions[name]!), tr.gettext(LABELS.a)]',
      '}',
    ].join('\n'),
  })
  mkdirSync(join(repo, 'packages/kbs/src/generated'), { recursive: true })
  writeFileSync(
    join(repo, 'packages/kbs/package.json'),
    JSON.stringify({ name: '@bettermyadmin/kbs', exports: { '.': './src/index.ts' } }),
  )
  writeFileSync(
    join(repo, 'packages/kbs/src/generated/kb.json'),
    JSON.stringify({ descriptions: { Uptime: 'The number of seconds the server has been up.' }, title: 'x' }),
  )
  writeFileSync(
    join(repo, 'packages/kbs/src/generated/rules.json'),
    JSON.stringify({ list: [{ name: 'Uptime below one day' }, { name: 'Questions below 1,000' }] }),
  )
  const found = scanMsgids(list, repo)
  const via = (k: string) => found.filter((f) => f.key === k).map((f) => f.via)
  it('reads N_/NC_ markers, tProduct and both branches of a conditional', () => {
    expect(via('Allows reading data.')).toContain('literal')
    expect(via('Collation\u0004Swedish')).toEqual(['literal'])
    expect(via('Hello phpMyAdmin')).toEqual(['literal'])
    expect(via('Locked.')).toEqual(['literal'])
    expect(via('Unlocked.')).toEqual(['literal'])
  })
  it('resolves properties of imported JSON and string maps re-exported by a workspace package', () => {
    expect(via('Uptime below one day')).toEqual(['json'])
    expect(via('Questions below 1,000')).toEqual(['json'])
    expect(via('The number of seconds the server has been up.')).toEqual(['json'])
    // a map's keys and the JSON's other properties are not msgids of `descriptions[name]`
    expect(via('Uptime')).toEqual([])
    expect(via('x')).toEqual([])
  })
})

describe('control claims', () => {
  const repo = mkdtempSync(join(tmpdir(), 'parity-claims-'))
  const dir = join(repo, 'apps/web/src/features/x')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pma-controls.ts'),
    [
      'export const pmaControls = {',
      "  'login/form.twig#pma_username': 'Login.tsx',",
      "  'sql/query.twig#SQL': { file: 'Login.tsx', match: 'button_submit_query' },",
      "  'login/form.twig#pma_password': 'Gone.tsx',",
      "  'menu/main.twig#link:Server:': 'Login.tsx',",
      '} as const',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'Login.tsx'),
    `export const L = () => <form><input name="pma_username" /><input data-pma="sql/query.twig#sql_query sql/query.twig#sql_delimiter" /><span>{t('Server:')}</span></form>`,
  )
  const claims = scanControlClaims(join(repo, 'apps/web/src'), repo)
  it('reads registries and data-pma attributes', () => {
    expect(claims.map((c) => `${c.via} ${c.key} → ${c.file}`)).toEqual([
      'data-pma sql/query.twig#sql_query → apps/web/src/features/x/Login.tsx',
      'data-pma sql/query.twig#sql_delimiter → apps/web/src/features/x/Login.tsx',
      'registry login/form.twig#pma_username → apps/web/src/features/x/Login.tsx',
      'registry sql/query.twig#SQL → apps/web/src/features/x/Login.tsx',
      'registry login/form.twig#pma_password → apps/web/src/features/x/Gone.tsx',
      'registry menu/main.twig#link:Server: → apps/web/src/features/x/Login.tsx',
    ])
  })
  it('verifies the evidence', () => {
    const v = (key: string, control?: { local: string; label?: string }) =>
      verifyClaim(claims.find((c) => c.key === key)!, control, repo)
    expect(v('login/form.twig#pma_username')).toBeNull()
    expect(v('sql/query.twig#SQL')).toMatch(/button_submit_query/)
    expect(v('login/form.twig#pma_password')).toMatch(/does not exist/)
    expect(v('menu/main.twig#link:Server:', { local: 'link:Server:', label: 'Server:' })).toBeNull()
    expect(v('sql/query.twig#sql_query')).toBeNull()
  })
})
