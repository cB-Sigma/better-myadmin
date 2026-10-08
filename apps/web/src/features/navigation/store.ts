import type {
  NavBranchQuery,
  NavBranchResponse,
  NavFastFilter,
  NavList,
  NavNode,
  NavPageSelector,
  NavPath,
  NavTreeQuery,
  NavTreeRequest,
  NavTreeResponse,
} from '@bettermyadmin/contracts'
import {
  ROOT,
  type Row,
  type RowState,
  buildRows,
  childrenOf,
  countListItems,
  nodeKey,
  walkNodes,
} from './rows'

export interface NavFetchers {
  tree(q: NavTreeQuery): Promise<NavTreeResponse>
  treeState(req: NavTreeRequest): Promise<NavTreeResponse>
  branch(q: NavBranchQuery): Promise<NavBranchResponse>
}

/** What `sessionStorage` keeps between page loads (pma: navTreePaths + server + token). */
interface StoredState {
  server: number
  token: string
  pos?: number | undefined
  paths: NavPath[]
}

const PATHS_KEY = 'navTreePaths'
const FILTERS_KEY = 'navTreeSearchFilters'

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * State and behaviour of the navigation tree (pma: resources/js/modules/navigation.ts). Kept outside
 * React so the asynchronous sequences (expand → load → highlight) read like phpMyAdmin's.
 */
export class NavTreeStore {
  readonly server: number
  readonly #fetch: NavFetchers
  readonly #token: string
  #listeners = new Set<() => void>()
  version = 0

  root: NavTreeResponse | null = null
  rootError: string | null = null
  /** The root list replaced by a database search (FastFilter.swap). */
  rootSearch: NavList | null = null
  /** Search clause in effect for `rootSearch`. */
  rootSearchClause = ''
  branches = new Map<string, NavList>()
  expanded = new Set<string>()
  loading = new Set<string>()
  selected = new Set<string>()
  /** Client fast-filter texts by owner key (ROOT = database filter). */
  filters = new Map<string, string>()
  /** Container lists replaced by an item search, with their search clause. */
  itemSearch = new Map<string, { clause: string; list: NavList }>()
  searchLists = new WeakSet<NavList>()
  /** Errors the server attached to responses (large-group warning, branch errors). */
  errors: string[] = []
  /** "Link with main panel" (not persisted, like phpMyAdmin). */
  synced = true
  /** Set when a row should be scrolled into view; consumed by the view. */
  scrollRequest: { key: string; toTop: boolean } | null = null
  #rowsCache: { version: number; rows: Row[] } | null = null
  #settingsApplied = false

  constructor(server: number, fetchers: NavFetchers, token: string) {
    this.server = server
    this.#fetch = fetchers
    this.#token = token
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  getVersion = (): number => this.version

  #emit(): void {
    this.version++
    for (const fn of this.#listeners) fn()
  }

  // ------------------------------------------------------------------ derived

  /** The root list on screen (the search result when a database search is active). */
  get rootList(): NavList | null {
    return this.rootSearch ?? this.root?.tree ?? null
  }

  rowState(): RowState {
    const branches = new Map(this.branches)
    for (const [k, v] of this.itemSearch) branches.set(k, v.list)
    return {
      expanded: this.expanded,
      loading: this.loading,
      selected: this.selected,
      branches,
      searchLists: this.searchLists,
      filters: this.filters,
    }
  }

  rows(): Row[] {
    if (this.#rowsCache?.version === this.version) return this.#rowsCache.rows
    const list = this.rootList
    const rows = list === null ? [] : buildRows(list, this.rowState())
    this.#rowsCache = { version: this.version, rows }
    return rows
  }

  children(node: NavNode): NavList | null {
    const s = this.itemSearch.get(nodeKey(node))
    return s?.list ?? childrenOf(node, this)
  }

  /** The node with that key among the loaded nodes. */
  find(key: string): NavNode | null {
    for (const n of this.#allNodes()) if (nodeKey(n) === key) return n
    return null
  }

  *#allNodes(): Generator<NavNode> {
    const self = this
    function* visit(list: NavList | null): Generator<NavNode> {
      if (list === null) return
      for (const n of list.items) {
        yield n
        yield* visit(self.children(n))
      }
    }
    yield* visit(this.rootList)
  }

  /** Database page position currently shown (the dbselector `<select>` value). */
  get pos(): number {
    return this.root?.pos ?? 0
  }

  // ------------------------------------------------------------------ loading

  /**
   * First load: phpMyAdmin renders the tree with the page, then `onloadNavigation` posts
   * `reload=1` with the stored expanded paths when the stored server/token match.
   */
  async init(currentDb: string): Promise<void> {
    const stored = this.#readStored()
    const req: NavTreeRequest = { reload: true, paths: stored?.paths ?? [] }
    if (stored?.pos !== undefined) req.pos = stored.pos
    else if (currentDb !== '') req.db = currentDb
    await this.#loadRoot(() => this.#fetch.treeState(req), stored !== null)
    this.#restoreFilters()
  }

  /** "Reload navigation panel": the whole tree again, keeping the expanded branches. */
  async reload(): Promise<void> {
    const state = this.traverseForPaths()
    const req: NavTreeRequest = { reload: true, paths: state.paths }
    if (state.pos !== undefined) req.pos = state.pos
    await this.#loadRoot(() => this.#fetch.treeState(req), true)
  }

  async #loadRoot(
    load: () => Promise<NavTreeResponse>,
    restoreExpansion: boolean,
    keepDbFilter = false,
  ): Promise<void> {
    try {
      const r = await load()
      this.root = r
      this.rootError = null
      this.rootSearch = null
      this.rootSearchClause = ''
      // the tree markup is replaced: filter inputs come back empty (the database page selector
      // puts the database filter text back, treePagination)
      const dbFilter = this.filters.get(ROOT)
      this.filters.clear()
      if (keepDbFilter && dbFilter !== undefined) this.filters.set(ROOT, dbFilter)
      this.branches.clear()
      this.itemSearch.clear()
      this.expanded.clear()
      this.errors = [...r.errors]
      if (!this.#settingsApplied) {
        this.#settingsApplied = true
        this.synced = r.settings.NavigationLinkWithMainPanel
      }
      if (restoreExpansion) {
        for (const n of walkNodes(r.tree)) if (n.expanded) this.expanded.add(nodeKey(n))
      }
    } catch (e) {
      this.rootError = e instanceof Error ? e.message : String(e)
    }
    this.#emit()
    this.treeStateUpdate()
  }

  /** pma: Navigation.loadChildNodes for one node */
  async #loadChildren(node: NavNode, inSearch: boolean): Promise<NavList | null> {
    const key = nodeKey(node)
    const q: NavBranchQuery = { path: node.aPath, pos: this.pos }
    if (node.pagination?.position === 'pos2_nav') {
      q.pos2Name = node.pagination.name
      q.pos2Value = node.pagination.value
    }
    if (inSearch) {
      if (this.rootSearchClause !== '') q.searchClause = this.rootSearchClause
      const owner = this.#ownerOf(key)
      const clause2 = owner === null ? '' : (this.itemSearch.get(owner)?.clause ?? '')
      if (clause2 !== '') q.searchClause2 = clause2
    }
    this.loading.add(key)
    this.#emit()
    try {
      const r = await this.#fetch.branch(q)
      this.errors.push(...r.errors)
      if (r.list === null) {
        if (r.error !== null) this.errors.push(r.error)
        return null
      }
      if (r.searchResults) this.searchLists.add(r.list)
      this.branches.set(key, r.list)
      return r.list
    } catch (e) {
      this.errors.push(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      this.loading.delete(key)
      this.#emit()
    }
  }

  /** Key of the node whose children list holds `key` (ROOT for the root list). */
  #ownerOf(key: string): string | null {
    const visit = (list: NavList | null, owner: string): string | null => {
      if (list === null) return null
      for (const n of list.items) {
        const k = nodeKey(n)
        if (k === key) return owner
        const found = visit(this.children(n), n.flatten ? owner : k)
        if (found !== null) return found
      }
      return null
    }
    return visit(this.rootList, ROOT)
  }

  #isInSearchList(key: string): boolean {
    const visit = (list: NavList | null): boolean | null => {
      if (list === null) return null
      for (const n of list.items) {
        if (nodeKey(n) === key) return this.searchLists.has(list)
        const r = visit(this.children(n))
        if (r !== null) return r
      }
      return null
    }
    return visit(this.rootList) === true
  }

  // ------------------------------------------------------------------ expand / collapse

  /** pma: Navigation.expandTreeNode */
  async expand(node: NavNode, opts: { skipAutoContainer?: boolean } = {}): Promise<void> {
    if (!node.expandable) return
    const key = nodeKey(node)
    if (this.children(node) !== null) {
      if (!this.expanded.has(key)) {
        this.expanded.add(key)
        this.#emit()
      }
      this.treeStateUpdate()
      return
    }
    if (this.loading.has(key)) return
    const list = await this.#loadChildren(node, this.#isInSearchList(key))
    if (list === null) return
    this.expanded.add(key)
    this.#emit()
    // a branch with a single container opens it straight away
    if (!opts.skipAutoContainer && countListItems(list) === 1) {
      const only = list.items[0]
      if (only !== undefined && only.kind === 'container' && only.expandable) await this.expand(only)
    }
    this.treeStateUpdate()
  }

  /** pma: Navigation.collapseTreeNode */
  collapse(node: NavNode): void {
    if (this.expanded.delete(nodeKey(node))) this.#emit()
    this.treeStateUpdate()
  }

  async toggle(node: NavNode): Promise<void> {
    if (this.expanded.has(nodeKey(node))) this.collapse(node)
    else await this.expand(node)
  }

  /** "Collapse all": every visible open expander is closed. */
  collapseAll(): void {
    for (const r of this.rows()) if (r.type === 'node' && r.expanded) this.expanded.delete(r.key)
    this.#emit()
    this.treeStateUpdate()
  }

  // ------------------------------------------------------------------ paging

  /** pma: Navigation.treePagination — `ownerKey` is the list the page selector is shown in. */
  async paginate(selector: NavPageSelector, ownerKey: string, value: number): Promise<void> {
    if (selector.paramName === 'pos') {
      // the database page selector reloads the whole tree (full=1), expanded branches are lost
      const q: NavTreeQuery = { pos: value }
      const clause = this.filters.get(ROOT) ?? ''
      if (clause !== '') q.searchClause = clause
      await this.#loadRoot(() => this.#fetch.tree(q), false, true)
      return
    }
    const path = selector.aPath
    const q: NavBranchQuery = { path, pos: this.pos, pos2Name: path[1] ?? '' }
    if (selector.paramName === 'pos3_value') {
      q.pos2Value = selector.pos2 ?? 0
      q.pos3Name = path[3] ?? ''
      q.pos3Value = value
    } else {
      q.pos2Value = value
    }
    const clause = this.filters.get(ROOT) ?? ''
    if (clause !== '') q.searchClause = clause
    const clause2 = this.filters.get(ownerKey) ?? ''
    if (clause2 !== '') q.searchClause2 = clause2
    try {
      const r = await this.#fetch.branch(q)
      this.errors.push(...r.errors)
      if (r.list !== null) {
        if (r.searchResults) this.searchLists.add(r.list)
        this.itemSearch.delete(ownerKey)
        this.branches.set(ownerKey, r.list)
      } else if (r.error !== null) {
        this.errors.push(r.error)
      }
    } catch (e) {
      this.errors.push(e instanceof Error ? e.message : String(e))
    }
    this.#emit()
    this.treeStateUpdate()
  }

  // ------------------------------------------------------------------ fast filter

  /** keyup: the client-side filter (and its stored state, navTreeSearchFilters). */
  setFilter(ownerKey: string, text: string): void {
    this.filters.set(ownerKey, text)
    if (text === '') this.#restoreSearch(ownerKey)
    this.#emit()
    this.#storeFilter(ownerKey, text)
  }

  /** Enter: server search (FastFilter.update → request → swap). */
  async search(filter: NavFastFilter, ownerKey: string, text: string): Promise<void> {
    if (text === '') return
    if (filter.kind === 'db') {
      if (this.rootSearch !== null && this.rootSearchClause === text) return
      const r = await this.#fetch.branch({ path: [], pos: 0, searchClause: text }).catch(() => null)
      if (r?.list && r.results !== null) {
        this.searchLists.add(r.list)
        this.rootSearch = r.list
        this.rootSearchClause = text
      }
    } else {
      if (this.itemSearch.get(ownerKey)?.clause === text) return
      const q: NavBranchQuery = {
        path: filter.aPath,
        pos: this.pos,
        pos2Name: filter.aPath.at(-1) ?? '',
        pos2Value: 0,
        searchClause2: text,
      }
      const clause = this.filters.get(ROOT) ?? ''
      if (clause !== '') q.searchClause = clause
      const r = await this.#fetch.branch(q).catch(() => null)
      if (r?.list && r.results !== null) {
        this.searchLists.add(r.list)
        this.itemSearch.set(ownerKey, { clause: text, list: r.list })
      }
    }
    this.#emit()
  }

  /** The clear button / emptied input: back to the list as it was before the search. */
  clearFilter(ownerKey: string): void {
    this.setFilter(ownerKey, '')
  }

  #restoreSearch(ownerKey: string): void {
    if (ownerKey === ROOT) {
      this.rootSearch = null
      this.rootSearchClause = ''
    } else {
      this.itemSearch.delete(ownerKey)
    }
  }

  #filterName(ownerKey: string): string {
    if (ownerKey === ROOT) return 'dbFilter'
    const n = this.find(ownerKey)
    return n === null ? ownerKey : JSON.stringify(n.aPath)
  }

  #storeFilter(ownerKey: string, text: string): void {
    const st = storage()
    if (st === null) return
    try {
      const current = JSON.parse(st.getItem(FILTERS_KEY) ?? '{}') as Record<string, string>
      current[this.#filterName(ownerKey)] = text
      st.setItem(FILTERS_KEY, JSON.stringify(current))
    } catch {
      st.removeItem(FILTERS_KEY)
    }
  }

  /** pma: filterStateRestore — the database filter text is typed back in (client filter only). */
  #restoreFilters(): void {
    const st = storage()
    if (st === null) return
    try {
      const saved = JSON.parse(st.getItem(FILTERS_KEY) ?? '{}') as Record<string, string>
      if (typeof saved.dbFilter === 'string' && saved.dbFilter !== '' && this.root?.tree.fastFilter) {
        this.filters.set(ROOT, saved.dbFilter)
      }
      for (const n of this.#allNodes()) {
        const v = saved[JSON.stringify(n.aPath)]
        if (n.kind === 'container' && typeof v === 'string' && v !== '') this.filters.set(nodeKey(n), v)
      }
      this.#emit()
    } catch {
      st.removeItem(FILTERS_KEY)
    }
  }

  // ------------------------------------------------------------------ state persistence

  /**
   * pma: Navigation.traverseForPaths — every open expander without an open expander below it,
   * with the pagination markers of its branch.
   */
  traverseForPaths(): { pos?: number | undefined; paths: NavPath[] } {
    const rows = this.rows()
    const paths: NavPath[] = []
    rows.forEach((r, i) => {
      if (r.type !== 'node' || !r.expanded) return
      // an open expander below this one?
      for (let j = i + 1; j < rows.length; j++) {
        const below = rows[j] as Row
        if (below.depth <= r.depth) break
        if (below.type === 'node' && below.expanded) return
      }
      const n = r.node
      const p: NavPath = { aPath: n.aPath, vPath: n.vPath }
      if (n.pagination?.position === 'pos2_nav') {
        p.pos2Name = n.pagination.name
        p.pos2Value = n.pagination.value
      } else if (r.pos2 !== undefined && n.aPath[1] !== undefined) {
        p.pos2Name = n.aPath[1]
        p.pos2Value = r.pos2
      }
      if (n.pagination?.position === 'pos3_nav') {
        p.pos3Name = n.pagination.name
        p.pos3Value = n.pagination.value
      }
      paths.push(p)
    })
    const pager = this.root?.tree.pageSelector
    return { pos: pager === null || pager === undefined ? undefined : this.pos, paths }
  }

  /** pma: Navigation.treeStateUpdate */
  treeStateUpdate(): void {
    const st = storage()
    if (st === null || this.root === null) return
    try {
      const state: StoredState = { server: this.server, token: this.#token, ...this.traverseForPaths() }
      st.setItem(PATHS_KEY, JSON.stringify(state))
    } catch {
      st.removeItem(PATHS_KEY)
    }
  }

  #readStored(): StoredState | null {
    const st = storage()
    if (st === null) return null
    try {
      const raw = st.getItem(PATHS_KEY)
      if (raw === null) return null
      const s = JSON.parse(raw) as StoredState
      // another server or another login: the stored state does not apply
      return s.server === this.server && s.token === this.#token ? s : null
    } catch {
      return null
    }
  }

  // ------------------------------------------------------------------ link with main panel

  setSynced(synced: boolean): void {
    this.synced = synced
    if (!synced) this.selected.clear()
    this.#emit()
  }

  #select(key: string): void {
    this.selected.add(key)
  }

  #requestScroll(key: string, toTop: boolean): void {
    this.scrollRequest = { key, toTop }
    this.#emit()
  }

  /** Path of nodes from the root list down to `key` (groups and containers included). */
  #pathTo(key: string): NavNode[] | null {
    const visit = (list: NavList | null, trail: NavNode[]): NavNode[] | null => {
      if (list === null) return null
      for (const n of list.items) {
        const t = [...trail, n]
        if (nodeKey(n) === key) return t
        const r = visit(this.children(n), t)
        if (r !== null) return r
      }
      return null
    }
    return visit(this.rootList, [])
  }

  /** pma: findLoadedItem — a real item of `list` (recursing into groups) whose text is `name`. */
  async #findLoadedItem(list: NavList | null, name: string, kind: NavNode['kind'] | null, doSelect: boolean) {
    const visit = (l: NavList | null): NavNode | null => {
      if (l === null) return null
      for (const n of l.items) {
        if (n.flatten) {
          const r = visit(this.children(n))
          if (r !== null) return r
        } else if (n.kind === 'group') {
          const r = visit(this.children(n))
          if (r !== null) return r
        } else if ((kind === null || n.kind === kind) && n.label === name) {
          return n
        }
      }
      return null
    }
    const found = visit(list)
    if (found === null) return null
    if (doSelect) this.#select(nodeKey(found))
    // open the groups around it
    for (const p of this.#pathTo(nodeKey(found)) ?? []) {
      if (p.kind === 'group' && !this.expanded.has(nodeKey(p))) this.expanded.add(nodeKey(p))
    }
    this.#emit()
    return found
  }

  /**
   * pma: Navigation.showCurrent — highlight and open the database / table of the main panel;
   * with no database selected, auto-expand the only database (NavigationTreeAutoexpandSingleDb).
   */
  async showCurrent(db: string, table: string): Promise<void> {
    if (this.root === null) return
    this.selected.clear()
    this.#emit()
    if (db !== '') {
      const dbItem = await this.#findLoadedItem(this.rootList, db, 'database', table === '')
      if (dbItem !== null) await this.#fullExpand(table, dbItem)
      return
    }
    if (!this.root.settings.NavigationTreeAutoexpandSingleDb) return
    const top = (this.rootList?.items ?? []).filter((n) => n.kind === 'database' && !n.flatten)
    if (top.length !== 1) return
    const only = top[0] as NavNode
    const dbItem = await this.#findLoadedItem(this.rootList, only.label, 'database', table === '')
    if (dbItem !== null) await this.#fullExpand(table, dbItem)
  }

  async #fullExpand(table: string, dbItem: NavNode): Promise<void> {
    if (!this.expanded.has(nodeKey(dbItem)) || this.children(dbItem) === null) await this.expand(dbItem)
    await this.#handleTableOrDb(table, dbItem)
  }

  async #handleTableOrDb(table: string, dbItem: NavNode): Promise<void> {
    if (table !== '') {
      await this.#loadAndHighlightTableOrView(dbItem, table)
      return
    }
    const tableContainer = this.children(dbItem)?.items.find(
      (n) => !n.flatten && n.kind === 'container' && n.container === 'tables',
    )
    if (tableContainer !== undefined) {
      this.#select(nodeKey(tableContainer))
      await this.expand(tableContainer)
    }
    this.#requestScroll(nodeKey(dbItem), true)
  }

  /** pma: isItemInContainer — a table or view anywhere below `list`. */
  #isItemInContainer(list: NavList | null, name: string): NavNode | null {
    for (const n of walkNodesWith(list, (x) => this.children(x))) {
      if ((n.kind === 'table' || n.kind === 'view') && n.label === name) return n
    }
    return null
  }

  async #loadAndHighlightTableOrView(dbItem: NavNode, itemName: string): Promise<void> {
    const dbChildren = this.children(dbItem)
    const which = this.#isItemInContainer(dbChildren, itemName)
    if (which !== null) {
      const trail = this.#pathTo(nodeKey(which)) ?? []
      const related =
        [...trail]
          .reverse()
          .find((n) => n.kind === 'container' && !n.flatten && n.classes.includes('subContainer')) ?? dbItem
      const found = await this.#findLoadedItem(this.children(related), itemName, null, true)
      await this.#showTableOrView(found, related)
      return
    }
    const subContainers = (dbChildren?.items ?? []).filter(
      (n) => !n.flatten && n.kind === 'container' && n.classes.includes('subContainer'),
    )
    if (subContainers.length > 0) {
      for (const c of subContainers) {
        if (c.loaded || this.branches.has(nodeKey(c))) continue
        const list = await this.#loadChildren(c, false)
        if (list === null) continue
        const found = await this.#findLoadedItem(list, itemName, null, true)
        if (found !== null) await this.#showTableOrView(found, c)
      }
    }
  }

  async #showTableOrView(which: NavNode | null, container: NavNode): Promise<void> {
    await this.expand(container, { skipAutoContainer: true })
    if (which !== null) this.#requestScroll(nodeKey(which), false)
  }
}

function* walkNodesWith(list: NavList | null, children: (n: NavNode) => NavList | null): Generator<NavNode> {
  if (list === null) return
  for (const n of list.items) {
    yield n
    yield* walkNodesWith(children(n), children)
  }
}
