/**
 * The navigation tree's node classes, ported one-to-one so the tree is built, grouped and queried
 * in the same order as phpMyAdmin's (the SQL it sends depends on that order and on per-node caches).
 * pma: src/Navigation/Nodes/*.php
 */
import type { NavNode } from '@bettermyadmin/contracts'
import { extractColumnSpec, php } from '@bettermyadmin/mysql-types'
import { backquote, escapeMysqlWildcards } from '@bettermyadmin/sql-gen'
import type { AppConfig, ServerConfig } from '../config.ts'
import { phpRegex } from '../util/php-regex.ts'
import type { NavDbi } from './dbi.ts'
import { ObjectFetcher } from './object-fetcher.ts'
import { phpSort, strlen, strnatcasecmp, strstrBefore, substrBytes } from './php.ts'
import type { UserPrivileges } from './privileges.ts'

export type Params = Record<string, string | number | null>

/**
 * The navigation-hiding feature of the configuration storage (`pma__navigationhiding`), provided by
 * the metadata layer. phpMyAdmin runs these through the control connection.
 */
export interface NavigationHiding {
  /** Node::getNavigationHidingData — hidden item count per database. */
  hiddenCounts(): Promise<Record<string, number>>
  /** NodeDatabase::getHiddenItems — hidden item names of one type (`table`, `view`, `group`…). */
  hiddenItems(db: string, type: string): Promise<string[]>
}

export interface NavCtx {
  dbi: NavDbi
  cfg: AppConfig
  /** `$cfg['Servers'][$i]` of the current server (selectedServer). */
  server: ServerConfig
  privileges: UserPrivileges
  hiding: NavigationHiding | null
}

export type NodeType = 'container' | 'object'

/** pma: Nodes/Icon.php::withDifferentParams — array_merge($params, array_intersect_key($args, $params)) */
function mergeParams(own: Params, args: Params): Params {
  const out: Params = { ...own }
  for (const k of Object.keys(own)) if (Object.hasOwn(args, k)) out[k] = args[k] as string | number | null
  return out
}

export class Icon {
  constructor(
    readonly image: string,
    readonly title: string,
    readonly route: string,
    readonly params: Params = {},
  ) {}

  withDifferentParams(args: Params): Icon {
    return new Icon(this.image, this.title, this.route, mergeParams(this.params, args))
  }
}

export class Link {
  constructor(
    readonly title: string,
    readonly route: string,
    readonly params: Params = {},
  ) {}

  withDifferentParams(args: Params): Link {
    return new Link(this.title, this.route, mergeParams(this.params, args))
  }
}

/** pma: Nodes/Node.php */
export class Node {
  realName: string
  visible = false
  parent: Node | null = null
  children: Node[] = []
  separators: string[] = []
  separatorDepth = 1
  icon: Icon = new Icon('', '', '')
  link: Link = new Link('', '', {})
  classes = ''
  isNew = false
  pos2 = 0
  pos3 = 0
  urlParamName: string | null = null

  constructor(
    readonly ctx: NavCtx,
    public name = '',
    readonly type: NodeType = 'object',
    public isGroup = false,
  ) {
    this.realName = name
  }

  /** `new $child($dbi, $config, $name)` in NavigationTree::groupNode */
  newInstance(name: string): Node {
    return new Node(this.ctx, name)
  }

  getInstanceForNewNode(name: string, classes: string): Node {
    const node = new Node(this.ctx, name)
    node.isNew = true
    node.classes = classes
    return node
  }

  addChild(child: Node): void {
    this.children.push(child)
    child.parent = this
  }

  getChild(name: string, realName = false): Node | null {
    for (const child of this.children) {
      if (realName) {
        if (child.realName === name) return child
      } else if (child.name === name && !child.isNew) {
        return child
      }
    }
    return null
  }

  removeChild(name: string): void {
    const i = this.children.findIndex((c) => c.name === name)
    if (i >= 0) this.children.splice(i, 1)
  }

  parents(self = false, containers = false, groups = false): Node[] {
    const out: Node[] = []
    let parent: Node | null = self ? this : this.parent
    while (parent !== null) {
      if ((parent.type !== 'container' || containers) && (!parent.isGroup || groups)) out.push(parent)
      parent = parent.parent
    }
    return out
  }

  getRealParent(): Node | false {
    let parent = this.parent
    while (parent !== null) {
      if (parent.type !== 'container' && !parent.isGroup) return parent
      parent = parent.parent
    }
    return false
  }

  hasChildren(countEmptyContainers = true): boolean {
    if (countEmptyContainers) return this.children.length > 0
    for (const child of this.children) {
      if (child.type === 'object' || child.hasChildren(false)) return true
    }
    return false
  }

  hasSiblings(): boolean {
    if (this.parent === null) return false
    if (this.getPaths().aPathClean.length > 3) return true
    for (const child of this.parent.children) {
      if (child !== this && (child.type === 'object' || child.hasChildren(false))) return true
    }
    return false
  }

  getPaths(): { aPathClean: string[]; vPathClean: string[] } {
    const aPathClean = this.parents(true, true)
      .map((p) => p.realName)
      .reverse()
    const vPathClean = this.parents(true, true, true)
      .map((p) => p.name)
      .reverse()
    return { aPathClean, vPathClean }
  }

  get #cfg() {
    return this.ctx.cfg
  }

  get #grouping(): boolean {
    return this.#cfg.NavigationTreeEnableGrouping && this.#cfg.ShowDatabasesNavigationAsTree
  }

  /** pma: Node::getData */
  async getData(pos: number, searchClause = ''): Promise<Array<string | null>> {
    if (!this.ctx.server.DisableIS) return this.#getDataFromInfoSchema(pos, searchClause)
    if (this.ctx.privileges.databasesToTest === false)
      return this.#getDataFromShowDatabases(pos, searchClause)
    return this.#getDataFromShowDatabasesLike(pos, searchClause)
  }

  /** pma: Node::getPresence (the database list; overridden by NodeDatabase and NodeTable) */
  async getPresence(_type = '', searchClause = ''): Promise<number> {
    const { dbi, server, privileges } = this.ctx
    if (!this.#grouping) {
      if (!server.DisableIS) {
        let query = 'SELECT COUNT(*) '
        query += 'FROM INFORMATION_SCHEMA.SCHEMATA '
        query += this.#getWhereClause('SCHEMA_NAME', searchClause)
        return toInt(await dbi.fetchValue(query))
      }
      if (privileges.databasesToTest === false) {
        let query = 'SHOW DATABASES '
        query += this.#getWhereClause('Database', searchClause)
        return this.queryAndGetNumRows(query)
      }
      let retval = 0
      for (const db of this.#getDatabasesToSearch(searchClause)) {
        retval += await this.queryAndGetNumRows(`SHOW DATABASES LIKE ${dbi.quoteString(db)}`)
      }
      return retval
    }

    const dbSeparator = this.#cfg.NavigationTreeDbSeparator
    if (!server.DisableIS) {
      let query = 'SELECT COUNT(*) '
      query += 'FROM ( '
      query += 'SELECT DISTINCT SUBSTRING_INDEX(SCHEMA_NAME, '
      query += `'${dbSeparator}', 1) `
      query += 'DB_first_level '
      query += 'FROM INFORMATION_SCHEMA.SCHEMATA '
      query += this.#getWhereClause('SCHEMA_NAME', searchClause)
      query += ') t '
      return toInt(await dbi.fetchValue(query))
    }

    if (privileges.databasesToTest !== false) {
      const prefixMap = new Set<string>()
      for (const db of this.#getDatabasesToSearch(searchClause)) {
        const handle = await dbi.tryQuery(`SHOW DATABASES LIKE ${dbi.quoteString(db)}`)
        if (handle === null) continue
        for (const [value] of handle.rows) {
          if (value === null || value === undefined || this.#isHideDb(value)) continue
          const prefix = strstrBefore(value, dbSeparator)
          prefixMap.add(prefix === false ? value : prefix)
        }
      }
      return prefixMap.size
    }

    const prefixMap = new Set<string>()
    let query = 'SHOW DATABASES '
    query += this.#getWhereClause('Database', searchClause)
    const handle = await dbi.tryQuery(query)
    if (handle !== null) {
      for (const [value] of handle.rows) {
        if (value === null || value === undefined) continue
        const prefix = strstrBefore(value, dbSeparator)
        prefixMap.add(prefix === false ? value : prefix)
      }
    }
    return prefixMap.size
  }

  #isHideDb(db: string): boolean {
    const hideDb = this.ctx.server.hide_db
    if (hideDb === '') return false
    return phpRegex(`/${hideDb}/`)?.test(db) === true
  }

  #onlyDb(): string[] | '' {
    const onlyDb = this.ctx.server.only_db as string | string[]
    if (onlyDb === '') return ''
    return typeof onlyDb === 'string' ? [onlyDb] : onlyDb
  }

  /** pma: Node::getDatabasesToSearch */
  #getDatabasesToSearch(searchClause: string): string[] {
    let databases: string[] = []
    const onlyDb = this.#onlyDb()
    const toTest = this.ctx.privileges.databasesToTest
    if (searchClause !== '') databases = [`%${escapeMysqlWildcards(searchClause)}%`]
    else if (onlyDb !== '') databases = [...onlyDb]
    else if (toTest !== false && toTest.length > 0) databases = [...toTest]
    return phpSort(databases)
  }

  /** pma: Node::getWhereClause */
  #getWhereClause(columnName: string, searchClause = ''): string {
    const { dbi, server } = this.ctx
    let whereClause = 'WHERE TRUE '
    if (searchClause !== '') {
      whereClause += `AND ${backquote(columnName)} LIKE ${dbi.quoteString(`%${escapeMysqlWildcards(searchClause)}%`)} `
    }
    if (server.hide_db !== '') {
      whereClause += `AND ${backquote(columnName)} NOT REGEXP ${dbi.quoteString(server.hide_db)} `
    }
    const onlyDb = this.#onlyDb()
    if (onlyDb !== '') {
      whereClause += 'AND ('
      const sub = onlyDb.map((each) => ` ${backquote(columnName)} LIKE ${dbi.quoteString(each)} `)
      whereClause += `${sub.join('OR')}) `
    }
    return whereClause
  }

  /** pma: Node::getHtmlForControlButtons — the hide / unhide controls (none by default). */
  controlButtons(): Pick<NavNode, 'hide' | 'hiddenCount'> {
    return {}
  }

  /** pma: Node::getCssClasses → [loaded, container] flags of the expander */
  getCssClasses(match: boolean): { loaded: boolean } | null {
    if (!this.#cfg.NavigationTreeEnableExpansion) return null
    return { loaded: this.isGroup || match }
  }

  /** pma: Node::getIcon — b_minus (open) when the node is on an active path */
  getIcon(match: boolean): 'b_minus' | 'b_plus' | null {
    if (!this.#cfg.NavigationTreeEnableExpansion) return null
    if (match) {
      this.visible = true
      return 'b_minus'
    }
    return 'b_plus'
  }

  /** pma: Node::getNavigationHidingData */
  async getNavigationHidingData(): Promise<Record<string, number> | null> {
    return this.ctx.hiding === null ? null : this.ctx.hiding.hiddenCounts()
  }

  async #getDataFromInfoSchema(pos: number, searchClause: string): Promise<Array<string | null>> {
    const { dbi } = this.ctx
    const maxItems = this.#cfg.FirstLevelNavigationItems
    if (!this.#grouping) {
      const query = `SELECT \`SCHEMA_NAME\` FROM \`INFORMATION_SCHEMA\`.\`SCHEMATA\` ${this.#getWhereClause('SCHEMA_NAME', searchClause)}ORDER BY \`SCHEMA_NAME\` LIMIT ${pos}, ${maxItems}`
      return dbi.fetchSingleColumn(query)
    }
    const sep = dbi.quoteString(this.#cfg.NavigationTreeDbSeparator)
    const where = this.#getWhereClause('SCHEMA_NAME', searchClause)
    const query =
      'SELECT `SCHEMA_NAME` FROM `INFORMATION_SCHEMA`.`SCHEMATA`, (SELECT DB_first_level' +
      ` FROM ( SELECT DISTINCT SUBSTRING_INDEX(SCHEMA_NAME, ${sep}, 1) DB_first_level` +
      ` FROM INFORMATION_SCHEMA.SCHEMATA ${where}) t` +
      ` ORDER BY DB_first_level ASC LIMIT ${pos}, ${maxItems}) t2` +
      ` ${where}AND 1 = LOCATE(CONCAT(DB_first_level, ${sep}),` +
      ` CONCAT(SCHEMA_NAME, ${sep})) ORDER BY SCHEMA_NAME ASC`
    return dbi.fetchSingleColumn(query)
  }

  async #getDataFromShowDatabases(pos: number, searchClause: string): Promise<Array<string | null>> {
    const { dbi } = this.ctx
    const maxItems = this.#cfg.FirstLevelNavigationItems
    if (!this.#grouping) {
      const handle = await dbi.tryQuery(`SHOW DATABASES ${this.#getWhereClause('Database', searchClause)}`)
      if (handle === null) return []
      return handle.rows.map((r) => r[0] ?? null).slice(pos, pos + maxItems)
    }
    const dbSeparator = this.#cfg.NavigationTreeDbSeparator
    const handle = await dbi.tryQuery(`SHOW DATABASES ${this.#getWhereClause('Database', searchClause)}`)
    let prefixes: string[] = []
    if (handle !== null) {
      const prefixMap = new Set<string>()
      const total = pos + maxItems
      for (const [value] of handle.rows) {
        // while ($value = $handle->fetchValue())
        if (!php.truthy(value)) break
        const prefix = strstrBefore(value as string, dbSeparator)
        prefixMap.add(prefix === false ? (value as string) : prefix)
        if (prefixMap.size === total) break
      }
      prefixes = [...prefixMap].slice(pos)
    }
    const subClauses = prefixes.map(
      (prefix) =>
        ` LOCATE(${dbi.quoteString(prefix + dbSeparator)}, CONCAT(\`Database\`, ${dbi.quoteString(dbSeparator)})) = 1 `,
    )
    const query = `SHOW DATABASES ${this.#getWhereClause('Database', searchClause)}AND (${subClauses.join('OR')})`
    return dbi.fetchSingleColumn(query)
  }

  async #getDataFromShowDatabasesLike(pos: number, searchClause: string): Promise<string[]> {
    const { dbi } = this.ctx
    const maxItems = this.#cfg.FirstLevelNavigationItems
    if (!this.#grouping) {
      const retval: string[] = []
      let count = 0
      let p = pos
      for (const db of this.#getDatabasesToSearch(searchClause)) {
        const handle = await dbi.tryQuery(`SHOW DATABASES LIKE ${dbi.quoteString(db)}`)
        if (handle === null) continue
        for (const [value] of handle.rows) {
          if (value === null || value === undefined) continue
          if (this.#isHideDb(value)) continue
          if (retval.includes(value)) continue
          if (p <= 0 && count < maxItems) {
            retval.push(value)
            count++
          }
          p--
        }
      }
      return phpSort(retval)
    }

    const dbSeparator = this.#cfg.NavigationTreeDbSeparator
    const retval: string[] = []
    const prefixMap = new Set<string>()
    const total = pos + maxItems
    outer: for (const db of this.#getDatabasesToSearch(searchClause)) {
      const handle = await dbi.tryQuery(`SHOW DATABASES LIKE ${dbi.quoteString(db)}`)
      if (handle === null) continue
      for (const [value] of handle.rows) {
        if (value === null || value === undefined) continue
        if (this.#isHideDb(value)) continue
        const prefix = strstrBefore(value, dbSeparator)
        prefixMap.add(prefix === false ? value : prefix)
        if (prefixMap.size === total) break outer
      }
    }
    const prefixes = [...prefixMap].slice(pos)
    for (const db of this.#getDatabasesToSearch(searchClause)) {
      const handle = await dbi.tryQuery(`SHOW DATABASES LIKE ${dbi.quoteString(db)}`)
      if (handle === null) continue
      for (const [value] of handle.rows) {
        if (value === null || value === undefined) continue
        if (this.#isHideDb(value)) continue
        if (retval.includes(value)) continue
        for (const prefix of prefixes) {
          if ((value + dbSeparator).startsWith(prefix + dbSeparator)) {
            retval.push(value)
            break
          }
        }
      }
    }
    return phpSort(retval)
  }

  protected async queryAndGetNumRows(query: string): Promise<number> {
    const r = await this.ctx.dbi.tryQuery(query)
    return r === null ? 0 : r.rows.length
  }
}

const toInt = (v: string | null | false) => (typeof v === 'string' ? Number.parseInt(v, 10) || 0 : 0)

/** pma: Nodes/NodeDatabaseContainer.php — the root */
export class NodeDatabaseContainer extends Node {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name, 'container')
    const cfg = ctx.cfg
    if (cfg.NavigationTreeEnableGrouping && cfg.ShowDatabasesNavigationAsTree) {
      const separator = cfg.NavigationTreeDbSeparator
      if (separator !== '') this.separators = [separator]
      this.separatorDepth = 10000
    }
    if (!ctx.privileges.isCreateDatabase || !cfg.ShowCreateDb) return
    // _pgettext('Create new database', 'New')
    const newLabel = 'New'
    const node = this.getInstanceForNewNode(newLabel, 'new_database italics')
    node.icon = new Icon('b_newdb', newLabel, '/server/databases')
    node.link = new Link(newLabel, '/server/databases')
    this.addChild(node)
  }
}

/** pma: Nodes/NodeDatabase.php */
export class NodeDatabase extends Node {
  #hiddenCount = 0
  readonly #presenceCounts = new Map<string, number>()
  readonly #objectFetcher: ObjectFetcher

  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('s_db', 'Database operations', '/database/operations', { db: null })
    this.link = new Link('Structure', ctx.cfg.DefaultTabDatabase, { db: null })
    this.classes = 'database'
    this.urlParamName = 'db'
    this.#objectFetcher = new ObjectFetcher(ctx)
  }

  override newInstance(name: string): Node {
    return new NodeDatabase(this.ctx, name)
  }

  #names(type: string, searchClause: string): Promise<string[]> | null {
    const f = this.#objectFetcher
    switch (type) {
      case 'tables':
        return f.getTables(this.realName, searchClause)
      case 'views':
        return f.getViews(this.realName, searchClause)
      case 'procedures':
        return f.getProcedures(this.realName, searchClause)
      case 'functions':
        return f.getFunctions(this.realName, searchClause)
      case 'events':
        return f.getEvents(this.realName, searchClause)
      default:
        return null
    }
  }

  override async getPresence(type = '', searchClause = ''): Promise<number> {
    const key = `${type}\u0000${searchClause}`
    const cached = this.#presenceCounts.get(key)
    if (cached !== undefined) return cached
    const names = this.#names(type, searchClause)
    const n = names === null ? 0 : (await names).length
    this.#presenceCounts.set(key, n)
    return n
  }

  /** pma: NodeDatabase::getDatabaseObjects */
  async getDatabaseObjects(type: string, pos: number, searchClause = ''): Promise<Node[]> {
    const pending = this.#names(type, searchClause)
    if (pending === null) return []
    let names = [...(await pending)]
    const maxItems = this.ctx.cfg.MaxNavigationItems
    if (this.ctx.cfg.NaturalOrder) names.sort(strnatcasecmp)
    names = names.slice(pos, pos + maxItems)
    // Remove hidden items so that they are not displayed in navigation tree
    if (this.ctx.hiding !== null) {
      const hidden = await this.getHiddenItems(type.slice(0, -1))
      names = names.filter((n) => !hidden.includes(n))
    }
    return names.map((item) => {
      switch (type) {
        case 'tables':
          return new NodeTable(this.ctx, item)
        case 'views':
          return new NodeView(this.ctx, item)
        case 'procedures':
          return new NodeProcedure(this.ctx, item)
        case 'functions':
          return new NodeFunction(this.ctx, item)
        default:
          return new NodeEvent(this.ctx, item)
      }
    })
  }

  /** pma: NodeDatabase::getHiddenItems */
  async getHiddenItems(type: string): Promise<string[]> {
    if (this.ctx.hiding === null) return []
    return this.ctx.hiding.hiddenItems(this.realName, type)
  }

  override controlButtons() {
    if (this.ctx.hiding !== null && this.#hiddenCount > 0) return { hiddenCount: this.#hiddenCount }
    return {}
  }

  setHiddenCount(count: number): void {
    this.#hiddenCount = count >= 1 ? count : 0
  }

  getHiddenCount(): number {
    return this.#hiddenCount
  }
}

/** pma: Nodes/NodeDatabaseChild.php */
export abstract class NodeDatabaseChild extends Node {
  protected abstract getItemType(): string

  override controlButtons() {
    if (this.ctx.hiding === null) return {}
    const parent = this.getRealParent()
    return {
      hide: {
        itemType: this.getItemType(),
        itemName: this.realName,
        dbName: parent === false ? '' : parent.realName,
      },
    }
  }
}

/** pma: Nodes/NodeDatabaseChildContainer.php */
export abstract class NodeDatabaseChildContainer extends NodeDatabaseChild {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name, 'container')
    if (!ctx.cfg.NavigationTreeEnableGrouping) return
    const separators = ctx.cfg.NavigationTreeTableSeparator as string | string[] | false
    if (typeof separators === 'string') {
      if (separators !== '') this.separators = [separators]
    } else if (separators !== false) {
      this.separators = [...separators]
    }
    this.separatorDepth = ctx.cfg.NavigationTreeTableLevel
  }

  protected getItemType(): string {
    return 'group'
  }
}

function newChild(container: Node, label: string, classes: string, icon: Icon, link: Link): void {
  const n = container.getInstanceForNewNode(label, classes)
  n.icon = icon
  n.link = link
  container.addChild(n)
}

export class NodeTableContainer extends NodeDatabaseChildContainer {
  constructor(ctx: NavCtx) {
    super(ctx, 'Tables')
    this.icon = new Icon('b_browse', 'Tables', '/database/structure', { tbl_type: 'table', db: null })
    this.link = new Link('', '/database/structure', { tbl_type: 'table', db: null })
    this.realName = 'tables'
    this.classes = 'tableContainer subContainer'
    newChild(
      this,
      'New',
      'new_table italics',
      new Icon('b_table_add', 'New', '/table/create', { db: null }),
      new Link('New', '/table/create', { db: null }),
    )
  }
}

export class NodeViewContainer extends NodeDatabaseChildContainer {
  constructor(ctx: NavCtx) {
    super(ctx, 'Views')
    this.icon = new Icon('b_views', 'Views', '/database/structure', { tbl_type: 'view', db: null })
    this.link = new Link('', '/database/structure', { tbl_type: 'view', db: null })
    this.classes = 'viewContainer subContainer'
    this.realName = 'views'
    newChild(
      this,
      'New',
      'new_view italics',
      new Icon('b_view_add', 'New', '/view/create', { db: null }),
      new Link('New', '/view/create', { db: null }),
    )
  }
}

export class NodeFunctionContainer extends NodeDatabaseChildContainer {
  constructor(ctx: NavCtx) {
    super(ctx, 'Functions')
    this.icon = new Icon('b_routines', 'Functions', '/database/routines', { type: 'FUNCTION', db: null })
    this.link = new Link('', '/database/routines', { type: 'FUNCTION', db: null })
    this.realName = 'functions'
    const p = { item_type: 'FUNCTION', add_item: 1, db: null }
    newChild(
      this,
      'New',
      'new_function italics',
      new Icon('b_routine_add', 'New', '/database/routines', p),
      new Link('New', '/database/routines', p),
    )
  }
}

export class NodeProcedureContainer extends NodeDatabaseChildContainer {
  constructor(ctx: NavCtx) {
    super(ctx, 'Procedures')
    this.icon = new Icon('b_routines', 'Procedures', '/database/routines', { type: 'PROCEDURE', db: null })
    this.link = new Link('', '/database/routines', { type: 'PROCEDURE', db: null })
    this.realName = 'procedures'
    const p = { add_item: 1, db: null }
    newChild(
      this,
      'New',
      'new_procedure italics',
      new Icon('b_routine_add', 'New', '/database/routines', p),
      new Link('New', '/database/routines', p),
    )
  }
}

export class NodeEventContainer extends NodeDatabaseChildContainer {
  constructor(ctx: NavCtx) {
    super(ctx, 'Events')
    this.icon = new Icon('b_events', 'Events', '/events', { db: null })
    this.link = new Link('', '/events', { db: null })
    this.realName = 'events'
    const p = { add_item: 1, db: null }
    newChild(
      this,
      'New',
      'new_event italics',
      new Icon('b_event_add', 'New', '/events', p),
      new Link('New', '/events', p),
    )
  }
}

/** pma: Nodes/NodeTable.php */
export class NodeTable extends NodeDatabaseChild {
  secondIcon: Icon | null = null

  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    const cfg = ctx.cfg
    const icon = NodeTable.#addIcon(cfg.NavigationTreeDefaultTabTable, { db: null, table: null })
    if (icon !== null) this.icon = icon
    this.secondIcon = NodeTable.#addIcon(cfg.NavigationTreeDefaultTabTable2, { db: null, table: null })
    this.link = new Link(titleForTarget(cfg.DefaultTabTable), cfg.DefaultTabTable, {
      pos: 0,
      db: null,
      table: null,
    })
    this.classes = 'nav_node_table'
    this.urlParamName = 'table'
  }

  override newInstance(name: string): Node {
    return new NodeTable(this.ctx, name)
  }

  protected getItemType(): string {
    return 'table'
  }

  static #addIcon(page: string, params: Params): Icon | null {
    switch (page) {
      case '/table/structure':
        return new Icon('b_props', 'Structure', page, params)
      case '/table/search':
        return new Icon('b_search', 'Search', page, params)
      case '/table/change':
        return new Icon('b_insrow', 'Insert', page, params)
      case '/table/sql':
        return new Icon('b_sql', 'SQL', page, params)
      case '/sql':
        return new Icon('b_browse', 'Browse', page, params)
      default:
        return null
    }
  }

  #dbName(): string {
    const p = this.getRealParent()
    return p === false ? '' : p.realName
  }

  override async getPresence(type = '', _searchClause = ''): Promise<number> {
    const { dbi, server } = this.ctx
    const db = this.#dbName()
    const table = this.realName
    switch (type) {
      case 'columns':
        if (!server.DisableIS) {
          let query = 'SELECT COUNT(*) '
          query += 'FROM `INFORMATION_SCHEMA`.`COLUMNS` '
          query += `WHERE \`TABLE_NAME\`=${dbi.quoteString(table)} `
          query += `AND \`TABLE_SCHEMA\`=${dbi.quoteString(db)}`
          return toInt(await dbi.fetchValue(query))
        }
        return this.queryAndGetNumRows(`SHOW COLUMNS FROM ${backquote(table)} FROM ${backquote(db)}`)
      case 'indexes':
        return this.queryAndGetNumRows(`SHOW INDEXES FROM ${backquote(table)} FROM ${backquote(db)}`)
      case 'triggers':
        if (!server.DisableIS) {
          let query = 'SELECT COUNT(*) '
          query += 'FROM `INFORMATION_SCHEMA`.`TRIGGERS` '
          query += `WHERE \`EVENT_OBJECT_SCHEMA\` ${await dbi.collateForIS()}=${dbi.quoteString(db)} `
          query += `AND \`EVENT_OBJECT_TABLE\` ${await dbi.collateForIS()}=${dbi.quoteString(table)}`
          return toInt(await dbi.fetchValue(query))
        }
        return this.queryAndGetNumRows(
          `SHOW TRIGGERS FROM ${backquote(db)} WHERE \`Table\` = ${dbi.quoteString(table)}`,
        )
      default:
        return 0
    }
  }

  async getColumns(pos: number): Promise<NodeColumn[]> {
    const { dbi, server, cfg } = this.ctx
    const maxItems = cfg.MaxNavigationItems
    const db = this.#dbName()
    const table = this.realName
    if (!server.DisableIS) {
      let query = 'SELECT `COLUMN_NAME` AS `name` '
      query += ',`COLUMN_KEY` AS `key` '
      query += ',`DATA_TYPE` AS `type` '
      query += ',`COLUMN_DEFAULT` AS `default` '
      query += ",IF (`IS_NULLABLE` = 'NO', '', 'nullable') AS `nullable` "
      query += 'FROM `INFORMATION_SCHEMA`.`COLUMNS` '
      query += `WHERE \`TABLE_NAME\`=${dbi.quoteString(table)} `
      query += `AND \`TABLE_SCHEMA\`=${dbi.quoteString(db)} `
      query += 'ORDER BY `ORDINAL_POSITION` ASC '
      query += `LIMIT ${pos}, ${maxItems}`
      return (await dbi.fetchResultSimple(query)).map(
        (row) =>
          new NodeColumn(this.ctx, {
            name: row.name ?? '',
            key: row.key ?? null,
            type: row.type ?? null,
            default: row.default ?? null,
            nullable: row.nullable ?? null,
          }),
      )
    }
    const r = await dbi.tryQuery(`SHOW COLUMNS FROM ${backquote(table)} FROM ${backquote(db)}`)
    if (r === null) return []
    const col = (name: string) => r.fields.indexOf(name)
    return r.rows.slice(pos, pos + maxItems).map(
      (row) =>
        new NodeColumn(this.ctx, {
          name: row[col('Field')] ?? '',
          key: row[col('Key')] ?? '',
          type: extractColumnSpec(row[col('Type')] ?? '').type,
          default: row[col('Default')] ?? null,
          nullable: row[col('Null')] === 'NO' ? '' : 'nullable',
        }),
    )
  }

  async getIndexes(pos: number): Promise<NodeIndex[]> {
    const { dbi, cfg } = this.ctx
    const r = await dbi.tryQuery(
      `SHOW INDEXES FROM ${backquote(this.realName)} FROM ${backquote(this.#dbName())}`,
    )
    if (r === null) return []
    const i = r.fields.indexOf('Key_name')
    return r.rows.slice(pos, pos + cfg.MaxNavigationItems).map((row) => new NodeIndex(this.ctx, row[i] ?? ''))
  }

  async getTriggers(pos: number): Promise<NodeTrigger[]> {
    const { dbi, server, cfg } = this.ctx
    const maxItems = cfg.MaxNavigationItems
    const db = this.#dbName()
    const table = this.realName
    if (!server.DisableIS) {
      let query = 'SELECT `TRIGGER_NAME` AS `name` '
      query += 'FROM `INFORMATION_SCHEMA`.`TRIGGERS` '
      query += `WHERE \`EVENT_OBJECT_SCHEMA\` ${await dbi.collateForIS()}=${dbi.quoteString(db)} `
      query += `AND \`EVENT_OBJECT_TABLE\` ${await dbi.collateForIS()}=${dbi.quoteString(table)} `
      query += 'ORDER BY `TRIGGER_NAME` ASC '
      query += `LIMIT ${pos}, ${maxItems}`
      return (await dbi.fetchSingleColumn(query)).map((n) => new NodeTrigger(this.ctx, n ?? ''))
    }
    const r = await dbi.tryQuery(
      `SHOW TRIGGERS FROM ${backquote(db)} WHERE \`Table\` = ${dbi.quoteString(table)}`,
    )
    if (r === null) return []
    const i = r.fields.indexOf('Trigger')
    return r.rows.slice(pos, pos + maxItems).map((row) => new NodeTrigger(this.ctx, row[i] ?? ''))
  }
}

/** pma: src/Util.php::getTitleForTarget */
export function titleForTarget(target: string): string {
  switch (target) {
    case '/table/structure':
    case '/database/structure':
      return 'Structure'
    case '/table/sql':
    case '/database/sql':
      return 'SQL'
    case '/table/search':
    case '/database/search':
      return 'Search'
    case '/table/change':
      return 'Insert'
    case '/sql':
      return 'Browse'
    case '/database/operations':
      return 'Operations'
    default:
      return ''
  }
}

export class NodeView extends NodeDatabaseChild {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_props', 'View', '/table/structure', { db: null, table: null })
    this.link = new Link('', '/sql', { pos: 0, db: null, table: null })
    this.classes = 'view'
    this.urlParamName = 'table'
  }

  override newInstance(name: string): Node {
    return new NodeView(this.ctx, name)
  }

  protected getItemType(): string {
    return 'view'
  }
}

export class NodeProcedure extends NodeDatabaseChild {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_routines', 'Procedure', '/database/routines', {
      item_type: 'PROCEDURE',
      execute_dialog: 1,
      db: null,
      item_name: null,
    })
    this.link = new Link('', '/database/routines', {
      item_type: 'PROCEDURE',
      edit_item: 1,
      db: null,
      item_name: null,
    })
    this.classes = 'procedure'
    this.urlParamName = 'item_name'
  }

  override newInstance(name: string): Node {
    return new NodeProcedure(this.ctx, name)
  }

  protected getItemType(): string {
    return 'procedure'
  }
}

export class NodeFunction extends NodeDatabaseChild {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_routines', 'Function', '/database/routines', {
      item_type: 'FUNCTION',
      execute_dialog: 1,
      db: null,
      item_name: null,
    })
    this.link = new Link('', '/database/routines', {
      item_type: 'FUNCTION',
      edit_item: 1,
      db: null,
      item_name: null,
    })
    this.classes = 'function'
    this.urlParamName = 'item_name'
  }

  override newInstance(name: string): Node {
    return new NodeFunction(this.ctx, name)
  }

  protected getItemType(): string {
    return 'function'
  }
}

export class NodeEvent extends NodeDatabaseChild {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_events', 'Event', '/events', { edit_item: 1, db: null, item_name: null })
    this.link = new Link('', '/events', { edit_item: 1, db: null, item_name: null })
    this.classes = 'event'
    this.urlParamName = 'item_name'
  }

  override newInstance(name: string): Node {
    return new NodeEvent(this.ctx, name)
  }

  protected getItemType(): string {
    return 'event'
  }
}

export class NodeColumnContainer extends Node {
  constructor(ctx: NavCtx) {
    super(ctx, 'Columns', 'container')
    this.icon = new Icon('pause', 'Columns', '/table/structure', { db: null, table: null })
    this.link = new Link('', '/table/structure', { db: null, table: null })
    this.realName = 'columns'
    const p = { field_where: 'last', after_field: '', db: null, table: null }
    newChild(
      this,
      'New',
      'new_column italics',
      new Icon('b_column_add', 'New', '/table/add-field', p),
      new Link('New', '/table/add-field', p),
    )
  }
}

export class NodeIndexContainer extends Node {
  constructor(ctx: NavCtx) {
    super(ctx, 'Indexes', 'container')
    this.icon = new Icon('b_index', 'Indexes', '/table/structure', { db: null, table: null })
    this.link = new Link('', '/table/structure', { db: null, table: null })
    this.realName = 'indexes'
    const p = { create_index: 1, added_fields: 2, db: null, table: null }
    newChild(
      this,
      'New',
      'new_index italics',
      new Icon('b_index_add', 'New', '/table/indexes', p),
      new Link('New', '/table/indexes', p),
    )
  }
}

export class NodeTriggerContainer extends Node {
  constructor(ctx: NavCtx) {
    super(ctx, 'Triggers', 'container')
    this.icon = new Icon('b_triggers', 'Triggers', '/triggers', { db: null, table: null })
    this.link = new Link('', '/triggers', { db: null, table: null })
    this.realName = 'triggers'
    const p = { add_item: 1, db: null }
    newChild(
      this,
      'New',
      'new_trigger italics',
      new Icon('b_trigger_add', 'New', '/triggers', p),
      new Link('New', '/triggers', p),
    )
  }
}

export interface ColumnItem {
  name: string
  key: string | null
  type: string | null
  default: string | null
  nullable: string | null
}

/** pma: Nodes/NodeColumn.php */
export class NodeColumn extends Node {
  readonly displayName: string

  constructor(ctx: NavCtx, item: ColumnItem) {
    super(ctx, item.name)
    this.displayName = NodeColumn.#getDisplayName(item)
    const icon = item.key === 'PRI' ? 'b_primary' : item.key === 'UNI' ? 'bd_primary' : 'pause'
    const p = { change_column: 1, db: null, table: null, field: null }
    this.icon = new Icon(icon, 'Column', '/table/structure/change', p)
    this.link = new Link('Structure', '/table/structure/change', p)
    this.urlParamName = 'field'
  }

  static #getDisplayName(item: ColumnItem): string {
    let retval = item.name
    let isFirst = true
    for (const key of ['key', 'type', 'default', 'nullable'] as const) {
      const value = item[key]
      if (value === null || value === '') continue
      retval += isFirst ? ' (' : ', '
      isFirst = false
      retval += key === 'default' && strlen(value) > 6 ? `${substrBytes(value, 0, 6)}...` : value
    }
    return `${retval})`
  }
}

export class NodeIndex extends Node {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_index', 'Index', '/table/indexes', { db: null, table: null, index: null })
    this.link = new Link('', '/table/indexes', { db: null, table: null, index: null })
    this.classes = 'index'
    this.urlParamName = 'index'
  }
}

export class NodeTrigger extends Node {
  constructor(ctx: NavCtx, name: string) {
    super(ctx, name)
    this.icon = new Icon('b_triggers', 'Trigger', '/triggers', { export_item: 1, db: null, item_name: null })
    this.link = new Link('', '/triggers', { edit_item: 1, db: null, item_name: null })
    this.classes = 'trigger'
    this.urlParamName = 'item_name'
  }
}
