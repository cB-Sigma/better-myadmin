import type {
  NavBranchQuery,
  NavBranchResponse,
  NavList,
  NavNode,
  NavTreeResponse,
} from '@bettermyadmin/contracts'
import { describe, expect, it } from 'vitest'
import { currentScope, navHref } from './links'
import { ROOT, buildRows, countListItems, nodeKey } from './rows'
import { NavTreeStore } from './store'

function node(kind: NavNode['kind'], vPath: string[], o: Partial<NavNode> = {}): NavNode {
  const name = vPath.at(-1) as string
  return {
    kind,
    name,
    realName: name,
    label: name,
    aPath: vPath,
    vPath,
    classes: '',
    isNew: kind === 'new',
    expandable: kind !== 'new' && kind !== 'view',
    loaded: kind === 'group',
    expanded: false,
    flatten: false,
    icons: [],
    link: null,
    pagination: null,
    children: null,
    ...o,
  }
}
const list = (items: NavNode[], o: Partial<NavList> = {}): NavList => ({
  fastFilter: null,
  pageSelector: null,
  items,
  ...o,
})

const SETTINGS = {
  NavigationWidth: 240,
  NavigationLinkWithMainPanel: true,
  NavigationTreePointerEnable: true,
  NavigationTreeAutoexpandSingleDb: true,
  NavigationTreeEnableExpansion: true,
  NavigationDisplayLogo: true,
  NavigationLogoLink: 'index.php',
  NavigationLogoLinkWindow: 'main' as const,
  NavigationDisplayServers: true,
  DisplayServersList: false,
  DefaultTabServer: '/',
  NumRecentTables: 10,
  NumFavoriteTables: 10,
  authType: 'cookie',
  isMariaDb: false,
  serverDocsUrl: '',
  TableNavigationLinksMode: 'icons' as const,
}

function treeResponse(tree: NavList): NavTreeResponse {
  return { settings: SETTINGS, pos: 0, searchClause: '', tree, controls: true, errors: [] }
}

describe('navHref', () => {
  it('maps phpMyAdmin routes onto the SPA scopes', () => {
    expect(navHref(1, '/database/structure', { db: 'a b' })).toBe('/s/1/db/a%20b/')
    expect(navHref(1, '/database/structure', { tbl_type: 'table', db: 'x' })).toBe(
      '/s/1/db/x/structure?tbl_type=table',
    )
    expect(navHref(2, '/sql', { pos: 0, db: 'x', table: 't' })).toBe('/s/2/db/x/t/t/')
    expect(navHref(1, '/table/structure', { db: 'x', table: 't' })).toBe('/s/1/db/x/t/t/structure')
    expect(navHref(1, '/table/create', { db: 'x' })).toBe('/s/1/db/x/table/create')
    expect(
      navHref(1, '/database/routines', { item_type: 'PROCEDURE', edit_item: 1, db: 'x', item_name: 'p' }),
    ).toBe('/s/1/db/x/routines?item_type=PROCEDURE&edit_item=1&item_name=p')
    expect(navHref(1, '/triggers', { add_item: 1, db: 'x' })).toBe('/s/1/db/x/triggers?add_item=1')
    expect(navHref(1, '/events', { edit_item: 1, db: 'x', item_name: 'e' })).toBe(
      '/s/1/db/x/events?edit_item=1&item_name=e',
    )
    expect(navHref(1, '/server/databases', {})).toBe('/s/1/databases')
    expect(navHref(1, '/view/create', { db: 'x' })).toBe('/s/1/db/x/view/create')
  })

  it('reads the current database and table from the URL', () => {
    expect(currentScope('/s/1/db/my%20db/t/t1/structure')).toEqual({ db: 'my db', table: 't1' })
    expect(currentScope('/s/1/db/x/')).toEqual({ db: 'x', table: '' })
    expect(currentScope('/s/1/sql')).toEqual({ db: '', table: '' })
  })
})

describe('buildRows', () => {
  const t1 = node('table', ['g', 'a', 'Tables', 't1'], { aPath: ['g_a', 'tables', 't1'] })
  const db = node('database', ['g', 'a'], {
    aPath: ['g_a'],
    label: 'g_a',
    loaded: true,
    children: list([
      node('container', ['g', 'a', 'Tables'], { flatten: true, loaded: false, children: list([t1]) }),
    ]),
  })
  const group = node('group', ['g'], {
    aPath: [],
    children: list([db, node('database', ['g', 'b'], { label: 'g_b' })]),
  })
  const root = list([node('new', ['New']), group], {
    fastFilter: { kind: 'db', aPath: [] },
    pageSelector: {
      aPath: [],
      pos2: null,
      count: 3,
      pos: 0,
      maxCount: 1,
      paramName: 'pos',
      begin: null,
      prev: null,
      next: 1,
      end: 2,
      pages: [],
    },
  })
  const base = {
    expanded: new Set<string>(),
    loading: new Set<string>(),
    selected: new Set<string>(),
    branches: new Map<string, NavList>(),
    searchLists: new Set<NavList>(),
    filters: new Map<string, string>(),
  }

  it('shows the filter, the page selector and the collapsed root items', () => {
    expect(buildRows(root, base).map((r) => (r.type === 'node' ? r.node.label : r.type))).toEqual([
      'filter',
      'pager',
      'New',
      'g',
    ])
  })

  it('opens groups and flattened containers in place [p01-5523b6]', () => {
    const rows = buildRows(root, { ...base, expanded: new Set([nodeKey(group), nodeKey(db)]) })
    expect(rows.flatMap((r) => (r.type === 'node' ? [[r.node.label, r.depth]] : []))).toEqual([
      ['New', 0],
      ['g', 0],
      ['g_a', 1],
      ['t1', 2],
      ['g_b', 1],
    ])
  })

  it('filters root items and group members client side, hides empty groups and page selectors', () => {
    const rows = buildRows(root, {
      ...base,
      expanded: new Set([nodeKey(group)]),
      filters: new Map([[ROOT, 'b$']]),
    })
    expect(rows.map((r) => (r.type === 'node' ? r.node.label : r.type))).toEqual(['filter', 'g', 'g_b'])
    const none = buildRows(root, { ...base, filters: new Map([[ROOT, 'zzz']]) })
    expect(none.map((r) => r.type)).toEqual(['filter'])
  })

  it('counts list items like find("ul > li")', () => {
    expect(
      countListItems(
        list([
          node('container', ['d', 'Columns'], { children: list([node('new', ['d', 'Columns', 'New'])]) }),
        ]),
      ),
    ).toBe(2)
  })
})

describe('NavTreeStore', () => {
  function setup(rootList: NavList, branches: Record<string, NavList>) {
    const calls: NavBranchQuery[] = []
    const store = new NavTreeStore(
      1,
      {
        tree: async () => treeResponse(rootList),
        treeState: async () => treeResponse(rootList),
        branch: async (q): Promise<NavBranchResponse> => {
          calls.push(q)
          const l = branches[q.path.join('/')]
          return {
            list: l ?? null,
            error: l === undefined ? 'An error has occurred while loading the navigation display' : null,
            searchResults: false,
            results: null,
            errors: [],
          }
        },
      },
      'token',
    )
    return { store, calls }
  }

  const tables = node('container', ['db1', 'Tables'], {
    aPath: ['db1', 'tables'],
    realName: 'tables',
    container: 'tables',
    classes: 'tableContainer subContainer',
    pagination: { position: 'pos2_nav', name: 'tables', value: 0 },
  })
  const views = node('container', ['db1', 'Views'], {
    aPath: ['db1', 'views'],
    realName: 'views',
    container: 'views',
    classes: 'viewContainer subContainer',
    pagination: { position: 'pos2_nav', name: 'views', value: 0 },
  })
  const db1 = node('database', ['db1'], { classes: 'database' })
  const root = list([db1, node('database', ['db2'])])
  const branches = {
    db1: list([tables, views]),
    'db1/tables': list([
      node('new', ['db1', 'Tables', 'New']),
      node('table', ['db1', 'Tables', 'orders'], { aPath: ['db1', 'tables', 'orders'] }),
    ]),
    'db1/views': list([node('view', ['db1', 'Views', 'v1'])]),
  }

  it('loads a branch on expand with the pagination marker of the node', async () => {
    const { store, calls } = setup(root, branches)
    await store.init('')
    await store.expand(db1)
    await store.expand(tables)
    expect(calls).toEqual([
      { path: ['db1'], pos: 0 },
      { path: ['db1', 'tables'], pos: 0, pos2Name: 'tables', pos2Value: 0 },
    ])
    expect(store.rows().flatMap((r) => (r.type === 'node' ? [r.node.label] : []))).toEqual([
      'db1',
      'Tables',
      'New',
      'orders',
      'Views',
      'db2',
    ])
    expect(store.traverseForPaths().paths).toEqual([
      { aPath: ['db1', 'tables'], vPath: ['db1', 'Tables'], pos2Name: 'tables', pos2Value: 0 },
    ])
    store.collapse(db1)
    expect(store.rows()).toHaveLength(2)
  })

  it('link with main panel: opens the database and highlights a table found in a sub container [p01-750138]', async () => {
    const { store } = setup(root, branches)
    await store.init('db1')
    await store.showCurrent('db1', 'orders')
    const orders = store.rows().find((r) => r.type === 'node' && r.node.label === 'orders')
    expect(orders?.type === 'node' && orders.selected).toBe(true)
    expect(store.scrollRequest?.key).toBe(nodeKey(branches['db1/tables'].items[1] as NavNode))
    // a database without table: the Tables container is selected and opened
    await store.showCurrent('db1', '')
    expect([...store.selected]).toEqual([nodeKey(db1), nodeKey(tables)])
  })

  it('auto-expands the only database when none is selected [p01-750138]', async () => {
    const { store } = setup(list([db1]), branches)
    await store.init('')
    await store.showCurrent('', '')
    expect(store.expanded.has(nodeKey(db1))).toBe(true)
  })

  it('reports a branch that cannot be built', async () => {
    const { store } = setup(root, branches)
    await store.init('')
    await store.expand(node('database', ['db2']))
    expect(store.errors).toEqual(['An error has occurred while loading the navigation display'])
  })
})
