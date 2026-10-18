import type { NavFastFilter, NavList, NavNode, NavPageSelector } from '@bettermyadmin/contracts'

/** Stable identity of a node: its kind and display path (vPath is unique among siblings). */
export const nodeKey = (n: NavNode): string => `${n.kind}:${n.vPath.join('\u001f')}`

export const ROOT = 'root'

export type Row =
  | {
      type: 'node'
      key: string
      node: NavNode
      depth: number
      /** Key of the list the node belongs to (owner node key or ROOT). */
      listKey: string
      expanded: boolean
      loading: boolean
      selected: boolean
      /** The node sits in a list that came back from a server search (`ul.search_results`). */
      inSearch: boolean
      /** pos2 of the enclosing table/object list, for branch requests below it. */
      pos2: number | undefined
    }
  | {
      type: 'filter'
      key: string
      depth: number
      filter: NavFastFilter
      /** Key of the list the filter belongs to (ROOT or the node it is shown under). */
      ownerKey: string
    }
  | { type: 'pager'; key: string; depth: number; selector: NavPageSelector; ownerKey: string }

export interface RowState {
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
  selected: ReadonlySet<string>
  /** Children loaded by a branch request, by owner key (replace the embedded children). */
  branches: ReadonlyMap<string, NavList>
  /** Lists returned for a search clause. */
  searchLists: { has(list: NavList): boolean }
  /** Client-side fast filter text by owner key (ROOT for the database filter). */
  filters: ReadonlyMap<string, string>
}

/** The children shown under a node, or null when they still have to be requested. */
export function childrenOf(node: NavNode, s: Pick<RowState, 'branches'>): NavList | null {
  const loaded = s.branches.get(nodeKey(node))
  if (loaded !== undefined) return loaded
  return node.loaded || node.flatten ? node.children : null
}

function regexOf(text: string | undefined): RegExp | null {
  if (text === undefined || text === '') return null
  try {
    return new RegExp(text, 'i')
  } catch {
    return null
  }
}

/**
 * The client part of the fast filter (navigation.ts FastFilter keyup): items of the list and of its
 * groups (recursively) whose link text does not match are hidden, containers are never hidden, and
 * groups without a visible member are hidden. Children of databases are not filtered.
 */
export function isFilteredOut(node: NavNode, re: RegExp, s: Pick<RowState, 'branches'>): boolean {
  if (node.kind === 'group') {
    const items = childrenOf(node, s)?.items ?? []
    return !items.some((c) => !isFilteredOut(c, re, s))
  }
  if (node.kind === 'container') return false
  return !re.test(node.label)
}

/** Flattens the visible part of the tree into rows for the virtualized list. */
export function buildRows(list: NavList, s: RowState): Row[] {
  const rows: Row[] = []
  walk(list, 0, ROOT, null, undefined, false)
  return rows

  function walk(
    l: NavList,
    depth: number,
    listKey: string,
    filter: RegExp | null,
    pos2: number | undefined,
    hidePagers: boolean,
  ): void {
    // a filter only acts while its input is there (a search result may come back without one)
    const text = l.fastFilter !== null ? (s.filters.get(listKey) ?? '') : ''
    const re = regexOf(text) ?? filter
    // typing in a fast filter hides the page selectors below it
    const noPager = hidePagers || text !== ''
    const inSearch = s.searchLists.has(l)
    if (l.fastFilter !== null) {
      rows.push({ type: 'filter', key: `${listKey}#filter`, depth, filter: l.fastFilter, ownerKey: listKey })
    }
    if (l.pageSelector !== null && !noPager) {
      rows.push({
        type: 'pager',
        key: `${listKey}#pager`,
        depth,
        selector: l.pageSelector,
        ownerKey: listKey,
      })
    }
    for (const node of l.items) {
      const key = nodeKey(node)
      if (node.flatten) {
        const c = childrenOf(node, s)
        if (c !== null) walk(c, depth, key, re, pos2, noPager)
        continue
      }
      if (re !== null && isFilteredOut(node, re, s)) continue
      const expanded = s.expanded.has(key)
      const nodePos2 = node.pagination?.position === 'pos2_nav' ? node.pagination.value : pos2
      rows.push({
        type: 'node',
        key,
        node,
        depth,
        listKey,
        expanded,
        loading: s.loading.has(key),
        selected: s.selected.has(key),
        inSearch,
        pos2: nodePos2,
      })
      if (!expanded) continue
      const c = childrenOf(node, s)
      if (c === null) continue
      // groups are filtered with their parent list; other children are not
      walk(c, depth + 1, key, node.kind === 'group' ? re : null, nodePos2, noPager)
    }
  }
}

/** Number of `<li>` phpMyAdmin would render for a list, nested ones included (`find('ul > li')`). */
export function countListItems(list: NavList): number {
  let n = list.fastFilter !== null ? 1 : 0
  for (const item of list.items) {
    if (!item.flatten) n++
    if (item.children !== null) n += countListItems(item.children)
  }
  return n
}

/** Visits every node of a list (depth first), embedded children included. */
export function* walkNodes(list: NavList | null): Generator<NavNode> {
  if (list === null) return
  for (const item of list.items) {
    yield item
    yield* walkNodes(item.children)
  }
}

/** What the legacy panel (ShowDatabasesNavigationAsTree = false) shows of the rows. */
export interface LegacyRows {
  /** The list navigator of the databases (`#pma_navigation_select_database div.dbselector`). */
  pager: Extract<Row, { type: 'pager' }> | null
  /** The databases of `#navi_db_select` (the "New" item is not an option). */
  options: NavNode[]
  /** The row of the current database, when it is on the page. */
  current: Extract<Row, { type: 'node' }> | null
  /** `#pma_navigation_tree_content`: the databases, or the branch of the current one a level up. */
  content: Row[]
}

/**
 * pma: NavigationTree::renderDbSelect + Navigation.showCurrent with `#navi_db_select` — with no
 * database the tree content lists the databases (no expanders); with one, it holds that
 * database's children only (loadChildNodes into `#pma_navigation_tree_content`).
 */
export function legacyRows(rows: readonly Row[], db: string, order?: readonly string[]): LegacyRows {
  let pager: LegacyRows['pager'] = null
  const options: NavNode[] = []
  const top: Row[] = []
  let current: LegacyRows['current'] = null
  const content: Row[] = []
  let inCurrent = false
  for (const r of rows) {
    if (r.depth > 0) {
      if (inCurrent) content.push({ ...r, depth: r.depth - 1 })
      continue
    }
    inCurrent = false
    if (r.type === 'pager' && r.ownerKey === ROOT) pager = r
    if (r.type !== 'node') continue
    top.push(r)
    if (r.node.kind !== 'database' || r.node.isNew) continue
    options.push(r.node)
    if (db !== '' && current === null && r.node.realName === db) {
      current = r
      inCurrent = true
    }
  }
  // the options keep the order of the query (renderDbSelect), the nodes are sorted
  if (order !== undefined) {
    const at = new Map(order.map((n, i) => [n, i]))
    options.sort((a, b) => (at.get(a.realName) ?? order.length) - (at.get(b.realName) ?? order.length))
  }
  return { pager, options, current, content: current === null ? top : content }
}
