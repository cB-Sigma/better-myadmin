/**
 * The navigation tree builder and renderer: builds the same node tree phpMyAdmin builds for a
 * /navigation request, groups and sorts it, and "renders" it to JSON in the same order phpMyAdmin
 * renders HTML (so every lazy count query runs at the same point).
 * pma: src/Navigation/NavigationTree.php
 */
import type { NavContainer, NavList, NavNode, NavNodeKind, NavPath } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { mbStrlen } from '@bettermyadmin/mysql-types'
import { php } from '@bettermyadmin/mysql-types'
import { listNavigator } from './list-navigator.ts'
import {
  Icon,
  Link,
  type NavCtx,
  Node,
  NodeColumn,
  NodeColumnContainer,
  NodeDatabase,
  NodeDatabaseContainer,
  NodeEvent,
  NodeEventContainer,
  NodeFunction,
  NodeFunctionContainer,
  NodeIndex,
  NodeIndexContainer,
  NodeProcedure,
  NodeProcedureContainer,
  NodeTable,
  NodeTableContainer,
  NodeTrigger,
  NodeTriggerContainer,
  NodeView,
  NodeViewContainer,
  type Params,
} from './nodes.ts'
import {
  isIntKey,
  mbStrpos,
  mbSubstr,
  phpSort,
  strcasecmp,
  strlen,
  strnatcasecmp,
  strstrBefore,
} from './php.ts'

const SPECIAL_NODE_NAMES = ['tables', 'views', 'functions', 'procedures', 'events']
const STERILE = ['events', 'triggers', 'functions', 'procedures', 'views', 'columns', 'indexes']

export const LARGE_GROUP_WARNING =
  'There are large item groups in navigation panel which may affect the performance. Consider disabling item grouping in the navigation panel.'
export const NAVIGATION_ERROR = 'An error has occurred while loading the navigation display'

export interface TreeRequest {
  /** `pos`; undefined → computed from `db` (getNavigationDbPos). */
  pos?: number | undefined
  /** Current database (Current::$database), only used to compute the initial page. */
  db?: string | undefined
  /** Branches to build: one (`aPath` request) or several (`n{i}_aPath`, state restore). */
  paths: NavPath[]
  searchClause?: string | undefined
  searchClause2?: string | undefined
}

/** A branch path as phpMyAdmin keeps it: `['root', ...]`. */
type Path = string[]

export class NavigationTree {
  readonly #ctx: NavCtx
  readonly #tree: NodeDatabaseContainer
  #aPath: Path[] = []
  #vPath: Path[] = []
  #pos = 0
  #pos2Name: string[] = []
  #pos2Value: number[] = []
  #pos3Name: string[] = []
  #pos3Value: number[] = []
  #searchClause = ''
  #searchClause2 = ''
  #largeGroupWarning = false
  readonly errors: string[] = []

  private constructor(ctx: NavCtx) {
    this.#ctx = ctx
    this.#tree = new NodeDatabaseContainer(ctx, 'root')
  }

  /** pma: NavigationTree::__construct */
  static async create(ctx: NavCtx, req: TreeRequest): Promise<NavigationTree> {
    const t = new NavigationTree(ctx)
    t.#pos = req.pos ?? (await t.#getNavigationDbPos(req.db ?? ''))
    req.paths.forEach((p, i) => {
      t.#aPath[i] = ['root', ...p.aPath]
      t.#vPath[i] = ['root', ...p.vPath]
      if (p.pos2Name !== undefined) {
        t.#pos2Name[i] = p.pos2Name
        t.#pos2Value[i] = p.pos2Value ?? 0
      }
      if (p.pos3Name !== undefined) {
        t.#pos3Name[i] = p.pos3Name
        t.#pos3Value[i] = p.pos3Value ?? 0
      }
    })
    t.#searchClause = req.searchClause ?? ''
    t.#searchClause2 = req.searchClause2 ?? ''
    return t
  }

  get pos(): number {
    return this.#pos
  }

  get searchClause(): string {
    return this.#searchClause
  }

  get #cfg() {
    return this.#ctx.cfg
  }

  /** pma: NavigationTree::getNavigationDbPos */
  async #getNavigationDbPos(database: string): Promise<number> {
    if (database === '') return 0
    const { dbi, server, privileges } = this.#ctx
    const items = this.#cfg.FirstLevelNavigationItems
    const sep = this.#cfg.NavigationTreeDbSeparator
    if (!server.DisableIS) {
      let query = 'SELECT (COUNT(DB_first_level) DIV %d) * %d '
      query += 'from ( '
      query += ' SELECT distinct SUBSTRING_INDEX(SCHEMA_NAME, '
      query += ' %s, 1) '
      query += ' DB_first_level '
      query += ' FROM INFORMATION_SCHEMA.SCHEMATA '
      query += ' WHERE `SCHEMA_NAME` < %s '
      query += ') t '
      const sql = query
        .replace('%d', String(items))
        .replace('%d', String(items))
        .replace('%s', dbi.quoteString(sep))
        .replace('%s', dbi.quoteString(database))
      const v = await dbi.fetchValue(sql)
      return typeof v === 'string' ? Number.parseInt(v, 10) || 0 : 0
    }
    const prefixMap = new Set<string>()
    const add = (d: string) => {
      const prefix = strstrBefore(d, sep)
      prefixMap.add(prefix === false ? d : prefix)
    }
    if (privileges.databasesToTest === false) {
      const handle = await dbi.tryQuery('SHOW DATABASES')
      if (handle !== null) {
        for (const [d] of handle.rows) {
          if (!php.truthy(d)) break
          if (strcasecmp(d as string, database) >= 0) break
          add(d as string)
        }
      }
    } else {
      let databases: string[] = []
      for (const db of privileges.databasesToTest) {
        const handle = await dbi.tryQuery(`SHOW DATABASES LIKE '${db}'`)
        if (handle === null) continue
        databases = databases.concat(handle.rows.map((r) => r[0] ?? ''))
      }
      for (const d of phpSort(databases)) {
        if (strcasecmp(d, database) >= 0) break
        add(d)
      }
    }
    return Math.floor(prefixMap.size / items) * items
  }

  /** pma: NavigationTree::buildPath */
  async #buildPath(): Promise<Node | boolean> {
    let retval: Node | boolean = this.#tree
    const data = await this.#tree.getData(this.#pos, this.#searchClause)
    const hiddenCounts = await this.#tree.getNavigationHidingData()
    for (const db of data) {
      const name = db ?? ''
      const node = new NodeDatabase(this.#ctx, name)
      const count = hiddenCounts?.[name]
      if (count !== undefined) node.setHiddenCount(Number(count))
      this.#tree.addChild(node)
    }
    for (let key = 0; key < this.#aPath.length; key++) {
      retval = await this.#buildPathPart(
        this.#aPath[key] as Path,
        this.#pos2Name[key] ?? '',
        this.#pos2Value[key] ?? 0,
        this.#pos3Name[key] ?? '',
        this.#pos3Value[key] ?? 0,
      )
    }
    return retval
  }

  /** pma: NavigationTree::buildPathPart */
  async #buildPathPart(
    pathIn: Path,
    type2: string,
    pos2: number,
    type3: string,
    pos3: number,
  ): Promise<Node | boolean> {
    if (pathIn.length <= 1) return true
    const path = pathIn.slice(1) // remove 'root'
    const db = this.#tree.getChild(path[0] as string)
    if (db === null || !(db instanceof NodeDatabase)) return false

    const containers = await this.#addDbContainers(db, type2, pos2)
    path.shift() // remove db
    const keys = Object.keys(containers)
    if ((path.length === 0 || !Object.hasOwn(containers, path[0] as string)) && keys.length !== 1) return db

    let container: Node | null
    if (keys.length === 1) {
      container = containers[keys[0] as string] as Node
    } else {
      container = db.getChild(path[0] as string, true)
      if (container === null) return false
    }

    if (container.children.length <= 1) {
      const dbData = await db.getDatabaseObjects(container.realName, pos2, this.#searchClause2)
      for (const node of dbData) {
        if (type2 === container.realName) node.pos2 = pos2
        container.addChild(node)
      }
    }

    if (path.length > 1 && path[0] !== 'tables') return false
    path.shift() // remove container
    if (path.length === 0) return container

    let table = container.getChild(path[0] as string, true)
    if (table === null) {
      if ((await db.getPresence('tables', path[0])) === 0) return false
      const node = new NodeTable(this.#ctx, path[0] as string)
      if (type2 === container.realName) node.pos2 = pos2
      container.addChild(node)
      table = container.getChild(path[0] as string, true)
      if (table === null) return false
    }
    if (!(table instanceof NodeTable)) return false

    const tableContainers = await this.#addTableContainers(table, pos2, type3, pos3)
    path.shift() // remove table
    if (path.length === 0 || !Object.hasOwn(tableContainers, path[0] as string)) return table

    const tc = table.getChild(path[0] as string, true)
    if (tc === null) return false
    let tableData: Node[] = []
    if (tc.realName === 'indexes') tableData = await table.getIndexes(pos3)
    else if (tc.realName === 'columns') tableData = await table.getColumns(pos3)
    else if (tc.realName === 'triggers') tableData = await table.getTriggers(pos3)
    for (const node of tableData) {
      node.pos2 = (tc.parent as Node).pos2
      if (type3 === tc.realName) node.pos3 = pos3
      tc.addChild(node)
    }
    return tc
  }

  /** pma: NavigationTree::addTableContainers */
  async #addTableContainers(
    table: NodeTable,
    pos2: number,
    type3: string,
    pos3: number,
  ): Promise<Record<string, Node>> {
    const retval: Record<string, Node> = {}
    if (!table.hasChildren()) {
      if ((await table.getPresence('columns')) !== 0) retval.columns = new NodeColumnContainer(this.#ctx)
      if ((await table.getPresence('indexes')) !== 0) retval.indexes = new NodeIndexContainer(this.#ctx)
      if ((await table.getPresence('triggers')) !== 0) retval.triggers = new NodeTriggerContainer(this.#ctx)
      for (const node of Object.values(retval)) {
        node.pos2 = pos2
        if (type3 === node.realName) node.pos3 = pos3
        table.addChild(node)
      }
    } else {
      for (const node of table.children) {
        if (type3 === node.realName) node.pos3 = pos3
        retval[node.realName] = node
      }
    }
    return retval
  }

  /** pma: NavigationTree::addDbContainers */
  async #addDbContainers(db: NodeDatabase, type: string, pos2: number): Promise<Record<string, Node>> {
    const cfg = this.#cfg
    const hidden = await db.getHiddenItems('group')
    if (!cfg.NavigationTreeShowTables && !hidden.includes('tables')) hidden.push('tables')
    if (!cfg.NavigationTreeShowViews && !hidden.includes('views')) hidden.push('views')
    if (!cfg.NavigationTreeShowFunctions && !hidden.includes('functions')) hidden.push('functions')
    if (!cfg.NavigationTreeShowProcedures && !hidden.includes('procedures')) hidden.push('procedures')
    if (!cfg.NavigationTreeShowEvents && !hidden.includes('events')) hidden.push('events')

    const retval: Record<string, Node> = {}
    if (!db.hasChildren()) {
      const s2 = this.#searchClause2
      if (!hidden.includes('tables') && (await db.getPresence('tables', s2)))
        retval.tables = new NodeTableContainer(this.#ctx)
      if (!hidden.includes('views') && (await db.getPresence('views', s2)))
        retval.views = new NodeViewContainer(this.#ctx)
      if (!hidden.includes('functions') && (await db.getPresence('functions', s2)))
        retval.functions = new NodeFunctionContainer(this.#ctx)
      if (!hidden.includes('procedures') && (await db.getPresence('procedures', s2)))
        retval.procedures = new NodeProcedureContainer(this.#ctx)
      if (!hidden.includes('events') && (await db.getPresence('events', s2)))
        retval.events = new NodeEventContainer(this.#ctx)
      for (const node of Object.values(retval)) {
        if (type === node.realName) node.pos2 = pos2
        db.addChild(node)
      }
    } else {
      for (const node of db.children) {
        if (type === node.realName) node.pos2 = pos2
        retval[node.realName] = node
      }
    }
    return retval
  }

  /** pma: NavigationTree::groupTree */
  groupTree(node: Node = this.#tree): void {
    this.groupNode(node)
    for (const child of [...node.children]) this.groupTree(child)
  }

  /** pma: NavigationTree::groupNode */
  groupNode(node: Node): void {
    if (node.type !== 'container' || !this.#cfg.NavigationTreeEnableExpansion) return

    // PHP array with string/int keys: insertion order, int keys for canonical integer strings
    const prefixes = new Map<string, number>()
    if (node.separatorDepth > 0) {
      for (const child of node.children) {
        let prefixPos: number | false = false
        for (const separator of node.separators) {
          const sepPos = mbStrpos(child.name, separator)
          if (
            sepPos === false ||
            sepPos === 0 ||
            (prefixPos !== false && sepPos >= prefixPos) ||
            sepPos === mbStrlen(child.name)
          ) {
            continue
          }
          prefixPos = sepPos
        }
        if (prefixPos !== false) {
          const prefix = mbSubstr(child.name, 0, prefixPos)
          prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1)
        }
        // Bug #4375: Check if prefix is the name of a DB, to create a group.
        for (const otherChild of node.children) {
          const v = prefixes.get(otherChild.name)
          if (v !== undefined) prefixes.set(otherChild.name, v + 1)
        }
      }
      // Check if prefix is the name of a DB, to create a group.
      for (const child of node.children) {
        const v = prefixes.get(child.name)
        if (v !== undefined) prefixes.set(child.name, v + 1)
      }
    }

    // It is not a group if it has only one item
    for (const [key, value] of [...prefixes]) if (value <= 1) prefixes.delete(key)

    const numChildren = node.children.length
    // rfe #1634 Don't group if there's only one group and no other items
    if (prefixes.size === 1) {
      const [key, value] = [...prefixes][0] as [string, number]
      if (value === numChildren - 1) prefixes.delete(key)
    }
    if (prefixes.size === 0) return

    const groups = new Map<string, Node>()
    for (const [key, value] of prefixes) {
      if (value > 500 && !this.#largeGroupWarning) {
        this.errors.push(this.#ctx.tr.gettext(LARGE_GROUP_WARNING))
        this.#largeGroupWarning = true
      }
      const intKey = isIntKey(key)
      const newChildren: Array<{ node: Node; replacesName: string }> = []
      for (const separator of node.separators) {
        const separatorLength = strlen(separator)
        for (const child of [...node.children]) {
          const keySeparatorLength = mbStrlen(key) + separatorLength
          const nameSubstring = mbSubstr(child.name, 0, keySeparatorLength)
          // `$child->name !== $key` is always true for an int key
          const nameIsKey = !intKey && child.name === key
          if ((nameSubstring !== key + separator && !nameIsKey) || child.type !== 'object') continue
          const nc = child.newInstance(mbSubstr(child.name, keySeparatorLength))
          if (child instanceof NodeDatabase && nc instanceof NodeDatabase && child.getHiddenCount() > 0) {
            nc.setHiddenCount(child.getHiddenCount())
          }
          nc.realName = child.realName
          nc.icon = child.icon
          nc.link = child.link
          nc.pos2 = child.pos2
          nc.pos3 = child.pos3
          for (const elm of child.children) nc.addChild(elm)
          newChildren.push({ node: nc, replacesName: child.name })
        }
      }
      if (newChildren.length === 0) continue

      // If the current node is a standard group (not NodeTableContainer, etc.)
      // and the new group contains all of the current node's children, combine them
      if (newChildren.length === numChildren && node.constructor === Node) {
        const suffix = (node.separators[0] ?? '') + php.htmlspecialchars(key)
        node.name += suffix
        node.realName += suffix
        node.separatorDepth--
        for (const nc of newChildren) {
          node.removeChild(nc.replacesName)
          node.addChild(nc.node)
        }
      } else {
        const group = new Node(this.#ctx, key, 'container', true)
        group.separators = node.separators
        group.separatorDepth = node.separatorDepth - 1
        group.icon = new Icon('b_group', this.#ctx.tr.gettext('Groups'), node.icon.route, {
          ...node.icon.params,
          tbl_group: key,
        })
        group.pos2 = node.pos2
        group.pos3 = node.pos3
        if (node instanceof NodeTableContainer || node instanceof NodeViewContainer) {
          group.link = new Link('', node.link.route, { ...node.link.params, tbl_group: key })
        }
        for (const nc of newChildren) {
          node.removeChild(nc.replacesName)
          group.addChild(nc.node)
        }
        groups.set(key, group)
      }
    }

    for (const group of groups.values()) {
      if (group.children.length === 0) continue
      node.addChild(group)
      this.groupNode(group)
      group.classes = 'navGroup'
    }
  }

  /** pma: NavigationTree::renderState (full=1 / reload=1) */
  async renderState(): Promise<NavList> {
    await this.#buildPath()
    const fastFilter = await this.#fastFilter(this.#tree)
    const pageSelector = await this.#getPageSelector(this.#tree)
    this.groupTree()
    const children = this.#sorted(this.#tree.children)
    this.#setVisibility()
    const items = await this.#renderNodes(children)
    return { fastFilter, pageSelector, items }
  }

  /**
   * pma: NavigationTree::renderDbSelect (ShowDatabasesNavigationAsTree = false): the databases of
   * the page (the client turns them into `#navi_db_select`) with the list navigator, no fast filter
   * and no grouping.
   */
  async renderDbSelect(): Promise<{ list: NavList; options: string[] }> {
    await this.#buildPath()
    const pageSelector = await this.#getPageSelector(this.#tree)
    this.#tree.isGroup = false
    // the options keep the order of the query; the nodes are sorted
    const options = this.#tree.children.filter((n) => !n.isNew).map((n) => n.realName)
    const children = this.#sorted(this.#tree.children)
    this.#setVisibility()
    const items = await this.#renderNodes(children)
    return { list: { fastFilter: null, pageSelector, items }, options }
  }

  /** pma: NavigationTree::renderPath — false when the branch cannot be built. */
  async renderPath(): Promise<{ list: NavList | false; results: string | null; searchResults: boolean }> {
    const node = await this.#buildPath()
    let list: NavList = { fastFilter: null, pageSelector: null, items: [] }
    if (typeof node !== 'boolean') {
      this.groupTree()
      const fastFilter = await this.#fastFilter(node)
      const pageSelector = await this.#getPageSelector(node)
      const items = await this.#renderNodes(this.#sorted(node.children))
      list = { fastFilter, pageSelector, items }
    }
    const hasSearchClause = this.#searchClause !== '' || this.#searchClause2 !== ''
    let results: string | null = null
    if (hasSearchClause && typeof node !== 'boolean') {
      let n = 0
      if (this.#searchClause2 !== '') {
        const parent = node.getRealParent()
        if (parent !== false) n = await parent.getPresence(node.realName, this.#searchClause2)
      } else {
        n = await this.#tree.getPresence('databases', this.#searchClause)
      }
      results = sprintf(this.#ctx.tr.ngettext('%s result found', '%s results found', n), n)
    }
    return { list: node === false ? false : list, results, searchResults: hasSearchClause }
  }

  /** pma: NavigationTree::findTreeMatch */
  #findTreeMatch(tree: Path[], paths: string[]): boolean {
    for (const path of tree) {
      let match = true
      for (let key = 0; key < paths.length; key++) {
        // `$part != $path[$key]` — loose, but both are strings
        if (path[key] === undefined || paths[key] !== path[key]) {
          match = false
          break
        }
      }
      if (match) return true
    }
    return false
  }

  async #renderNodes(children: Node[]): Promise<NavNode[]> {
    const out: NavNode[] = []
    for (const child of children) out.push(await this.#renderNode(child))
    return out
  }

  /** pma: NavigationTree::renderNode (navigation/tree/node.twig) */
  async #renderNode(node: Node): Promise<NavNode> {
    const paths = node.getPaths()
    const nodeIsContainer = node.type === 'container'
    let showNode = node.hasSiblings() || node.parents(false, true).length > 0
    // Don't show the 'Tables' node under each database unless it has 'Views', etc. as a sibling
    if (node instanceof NodeTableContainer && !node.hasSiblings()) showNode = false

    let expandable = false
    let loaded = false
    let icons: Icon[] = []
    let link: Link | null = null
    let controls: ReturnType<Node['controlButtons']> = {}
    if (showNode) {
      const parents = node.parents(false, true)
      const parentName = parents[0]?.realName ?? ''
      // if node name itself is in sterile, then allow
      const nodeIsGroup =
        node.isGroup ||
        (!STERILE.includes(parentName) && !node.isNew) ||
        (STERILE.includes(node.realName) && node.children.length > 0)
      if (nodeIsGroup) {
        const match = this.#findTreeMatch(this.#vPath, paths.vPathClean)
        const css = node.getCssClasses(match)
        expandable = css !== null
        loaded = css?.loaded === true
        if (this.#cfg.ShowDatabasesNavigationAsTree || parentName !== 'root') node.getIcon(match)
      }
      if (!node.isGroup) {
        const args: Params = {}
        for (const parent of node.parents(true)) {
          if (parent.urlParamName === null) continue
          args[parent.urlParamName] = parent.realName
        }
        icons = [node.icon.withDifferentParams(args)]
        if (node instanceof NodeTable && node.secondIcon !== null) {
          icons.push(node.secondIcon.withDifferentParams(args))
        }
        link = node.link.withDifferentParams(args)
      } else {
        icons = [node.icon]
      }
      controls = node.controlButtons()
    } else {
      node.visible = true
    }
    const pagination = this.#paginationParams(node)

    const children = this.#sorted(node.children)
    let childList: NavList | null = null
    if (children.length > 0) {
      const items = await this.#renderNodes(children)
      const fastFilter = await this.#fastFilter(node)
      const pageSelector = await this.#getPageSelector(node)
      childList = { fastFilter, pageSelector, items }
    }

    const container = nodeIsContainer && !node.isGroup ? (node.realName as NavContainer) : undefined
    const out: NavNode = {
      kind: kindOf(node),
      ...(container !== undefined ? { container } : {}),
      name: node.name,
      realName: node.realName,
      // node.twig: groups and containers show `name`, other nodes `displayName` (the real name)
      label: nodeIsContainer ? node.name : node instanceof NodeColumn ? node.displayName : node.realName,
      aPath: paths.aPathClean.slice(1),
      vPath: paths.vPathClean.slice(1),
      classes: node.classes,
      isNew: node.isNew,
      expandable,
      loaded,
      expanded: false,
      flatten: !showNode,
      icons: icons.map((i) => ({ image: i.image, title: i.title, route: i.route, params: i.params })),
      link:
        link === null
          ? null
          : {
              title: link.title,
              route: link.route,
              params: link.params,
              ...(node.classes.includes('index') ? { post: true } : {}),
            },
      pagination,
      ...controls,
      children: childList,
    }
    // the children's list_container is rendered without `display: none` (an open branch)
    out.expanded = expandable && node.visible && childList !== null
    return out
  }

  /** pma: NavigationTree::getPaginationParamsHtml */
  #paginationParams(node: Node): NavNode['pagination'] {
    const a = node.getPaths().aPathClean
    let out: NavNode['pagination'] = null
    if (a[2] !== undefined) out = { position: 'pos2_nav', name: a[2], value: node.pos2 }
    if (a[4] !== undefined) out = { position: 'pos3_nav', name: a[4], value: node.pos3 }
    return out
  }

  /** pma: NavigationTree::setVisibility */
  #setVisibility(): void {
    for (const path of this.#vPath) {
      let node: Node = this.#tree
      for (const value of path) {
        const child = node.getChild(value)
        if (child === null) continue
        child.visible = true
        node = child
      }
    }
  }

  /** pma: NavigationTree::fastFilterHtml */
  async #fastFilter(node: Node): Promise<NavList['fastFilter']> {
    const filterDbMin = this.#cfg.NavigationTreeDisplayDbFilterMinimum
    const filterItemMin = this.#cfg.NavigationTreeDisplayItemFilterMinimum
    const isRootNode = node === this.#tree && (await this.#tree.getPresence()) >= filterDbMin
    if (isRootNode) return { kind: 'db', aPath: [] }
    const nodeIsContainer = node.type === 'container'
    const nodeIsSpecial = SPECIAL_NODE_NAMES.includes(node.realName)
    const realParent = node.getRealParent()
    if (
      nodeIsContainer &&
      nodeIsSpecial &&
      realParent !== false &&
      (await realParent.getPresence(node.realName)) >= filterItemMin
    ) {
      return { kind: 'item', aPath: node.getPaths().aPathClean.slice(1) }
    }
    return null
  }

  /** pma: NavigationTree::getPageSelector */
  async #getPageSelector(node: Node): Promise<NavList['pageSelector']> {
    if (node === this.#tree) {
      return listNavigator(
        [],
        await this.#tree.getPresence('databases', this.#searchClause),
        this.#pos,
        this.#cfg.FirstLevelNavigationItems,
        'pos',
      )
    }
    if (node.type === 'container' && !node.isGroup) {
      const level = node.getPaths().aPathClean[4] !== undefined ? 3 : 2
      const pos = level === 3 ? node.pos3 : node.pos2
      const realParent = node.getRealParent()
      if (realParent === false) return null
      const num = await realParent.getPresence(node.realName, this.#searchClause2)
      return listNavigator(
        node.getPaths().aPathClean.slice(1),
        num,
        pos,
        this.#cfg.MaxNavigationItems,
        level === 3 ? 'pos3_value' : 'pos2_value',
        level === 3 ? node.pos2 : null,
      )
    }
    return null
  }

  /** pma: NavigationTree::sortNode (usort is stable in PHP 8) */
  #sorted(children: Node[]): Node[] {
    const natural = this.#cfg.NaturalOrder
    return [...children].sort((a, b) => {
      if (a.isNew) return -1
      if (b.isNew) return 1
      return natural ? strnatcasecmp(a.name, b.name) : strcasecmp(a.name, b.name)
    })
  }
}

function kindOf(node: Node): NavNodeKind {
  if (node.isNew) return 'new'
  if (node.isGroup) return 'group'
  if (node instanceof NodeDatabase) return 'database'
  if (node instanceof NodeTable) return 'table'
  if (node instanceof NodeView) return 'view'
  if (node instanceof NodeProcedure) return 'procedure'
  if (node instanceof NodeFunction) return 'function'
  if (node instanceof NodeEvent) return 'event'
  if (node instanceof NodeTrigger) return 'trigger'
  if (node instanceof NodeColumn) return 'column'
  if (node instanceof NodeIndex) return 'index'
  return 'container'
}
