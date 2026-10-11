/**
 * The PHP extractors against the real phpMyAdmin checkout (PMA_PATH, default /home/user/ref/pma).
 * Skipped when the checkout or PHP is not available (CI); `pnpm parity:check` then still verifies
 * the committed inventories by commit.
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  extractHelperControls,
  extractMessages,
  extractRoutes,
  flattenPmaSettings,
} from '../src/inventory.ts'
import { pmaHead, pmaPath } from '../src/util.ts'

const pma = pmaPath()
const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const available = hasPhp && pmaHead(pma) !== null

describe.skipIf(!available)('extractors on the reference checkout', () => {
  it('routes: executes Routes::collect and the setup dispatcher', () => {
    const inv = extractRoutes(pma, 'x')
    const app = inv.items.filter((r) => r.scope === 'app')
    expect(app.length).toBeGreaterThan(150)
    expect(inv.items.find((r) => r.key === '/server/engines/{engine}[/{page}]')).toMatchObject({
      methods: ['GET'],
      controller: 'Server/ShowEngineController',
      file: 'src/Controllers/Server/ShowEngineController.php',
      variants: ['/server/engines/{engine}', '/server/engines/{engine}/{page}'],
    })
    expect(inv.items.find((r) => r.key === '/sql')?.methods).toEqual(['GET', 'POST'])
    expect(inv.items.filter((r) => r.scope === 'setup').map((r) => r.key)).toEqual(
      expect.arrayContaining(['setup:/setup', 'setup:/setup/show-config', 'setup:/setup/validate']),
    )
  })

  it('messages: attributes msgids to templates (Twig AST), PHP and JS files', { timeout: 60_000 }, () => {
    const inv = extractMessages(pma, 'x')
    const byKey = new Map(inv.items.map((m) => [m.key, m]))
    expect(byKey.get('Log in')?.refs.some((r) => r.startsWith('resources/templates/login/form.twig:'))).toBe(
      true,
    )
    // `t('New', context = 'Create new user')` in a template keeps its context
    expect(
      byKey.get('Create new user\u0004New')?.refs.some((r) => r.startsWith('resources/templates/')),
    ).toBe(true)
    // a window.Messages string is attributed to the JS that reads it
    expect(
      [...byKey.values()].some(
        (m) =>
          m.refs.some((r) => r.startsWith('resources/js/')) &&
          m.refs.some((r) => r.includes('JavaScriptMessagesController')),
      ),
    ).toBe(true)
  })

  it('helpers: controls printed by Generator/Util', () => {
    const keys = extractHelperControls(pma).map((c) => c.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'src/Navigation/NavigationTree.php#id:pma_navigation_collapse',
        'src/Navigation/NavigationTree.php#id:pma_navigation_sync',
      ]),
    )
  })
})

describe('Settings flattening', () => {
  it('groups become paths, lists and scalars are leaves, servers use *', () => {
    expect(
      flattenPmaSettings(
        {
          MaxRows: 25,
          Export: { format: 'sql', csv_null: 'NULL' },
          Servers: { 1: { host: 'x' } },
          PDFPageSizes: ['A4'],
          Empty: {},
        },
        { host: 'localhost', AllowDeny: { order: '', rules: [] } },
      ),
    ).toEqual([
      'MaxRows',
      'Export/format',
      'Export/csv_null',
      'PDFPageSizes',
      'Empty',
      'Servers/*/host',
      'Servers/*/AllowDeny/order',
      'Servers/*/AllowDeny/rules',
    ])
  })
})
