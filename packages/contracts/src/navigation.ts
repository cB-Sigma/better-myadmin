import { z } from 'zod'

/**
 * Navigation tree (left panel). The server mirrors phpMyAdmin's /navigation controller
 * (NavigationTree::renderState / renderPath) and returns the node tree it would render as HTML,
 * already grouped and sorted; the client only lays it out.
 * docs/features/01-shell-navigation-auth.md#navigation-tree--databases-level
 */

/** A phpMyAdmin route plus its query parameters, e.g. `/table/structure` + `{db, table}`. */
export const NavParams = z.record(z.union([z.string(), z.number(), z.null()]))
export type NavParams = z.infer<typeof NavParams>

/** pma: src/Navigation/Nodes/Link.php — the text link of a node. */
export const NavLink = z.object({
  title: z.string(),
  route: z.string(),
  params: NavParams,
  /**
   * The link needs POST parameters (`data-post`, used by index nodes, node.twig): the route is
   * opened with `params` + `is_from_nav=1`.
   */
  post: z.boolean().optional(),
})
export type NavLink = z.infer<typeof NavLink>

/** pma: src/Navigation/Nodes/Icon.php — an icon link (`image` is phpMyAdmin's icon name). */
export const NavIcon = z.object({
  image: z.string(),
  title: z.string(),
  route: z.string(),
  params: NavParams,
})
export type NavIcon = z.infer<typeof NavIcon>

export const NavNodeKind = z.enum([
  'new',
  'database',
  'group',
  'container',
  'table',
  'view',
  'procedure',
  'function',
  'event',
  'trigger',
  'column',
  'index',
])
export type NavNodeKind = z.infer<typeof NavNodeKind>

/** Real names of the container nodes (aPath components). */
export const NavContainer = z.enum([
  'tables',
  'views',
  'functions',
  'procedures',
  'events',
  'columns',
  'indexes',
  'triggers',
])
export type NavContainer = z.infer<typeof NavContainer>

/** `list_navigator.twig` in `frame_navigation` mode, with Util::pageselector's page list. */
export const NavPageSelector = z.object({
  /**
   * aPath (after `root`) of the node whose list is paged — `[]` for the databases; not always the
   * node the list is shown under (the only *Tables* container is not rendered).
   */
  aPath: z.array(z.string()),
  count: z.number().int(),
  pos: z.number().int(),
  maxCount: z.number().int(),
  /** `pos` (databases), `pos2_value` (tables, views…), `pos3_value` (columns, indexes, triggers). */
  paramName: z.enum(['pos', 'pos2_value', 'pos3_value']),
  /** For a third-level list (columns, indexes, triggers): the `pos2_value` it is sent with. */
  pos2: z.number().int().nullable(),
  /** Positions of the `<<` `<` `>` `>>` links; null when phpMyAdmin does not render the link. */
  begin: z.number().int().nullable(),
  prev: z.number().int().nullable(),
  next: z.number().int().nullable(),
  end: z.number().int().nullable(),
  /** The `<select>` options: `value` is the position, `page` the 1-based label. */
  pages: z.array(z.object({ value: z.number().int(), page: z.number().int(), selected: z.boolean() })),
})
export type NavPageSelector = z.infer<typeof NavPageSelector>

/** `tree/fast_filter.twig`: `db` is the database filter (`searchClause`), `item` a container filter (`searchClause2`). */
export const NavFastFilter = z.object({
  kind: z.enum(['db', 'item']),
  /** aPath (after `root`) of the filtered container (`[]` for the database filter). */
  aPath: z.array(z.string()),
})
export type NavFastFilter = z.infer<typeof NavFastFilter>

/** Hide control (`hideNavItem`), only when the navigation-hiding feature of the pmadb is on. */
export const NavHideItem = z.object({ itemType: z.string(), itemName: z.string(), dbName: z.string() })
export type NavHideItem = z.infer<typeof NavHideItem>

export interface NavNode {
  kind: NavNodeKind
  /** Container real name (`tables`, `columns`…) when `kind` is `container`. */
  container?: NavContainer | undefined
  /** Name after grouping (prefix stripped), used for ordering and in vPath. */
  name: string
  /** The real object name (aPath component). */
  realName: string
  /** Text shown: the real name; `name (key, type, default…, nullable)` for columns; the prefix for groups. */
  label: string
  /** Real names from the root, excluding `root` and groups (pma `aPath`). */
  aPath: string[]
  /** Display names from the root, excluding `root`, including groups (pma `vPath`). */
  vPath: string[]
  /** phpMyAdmin `<li>` classes of the node (`database`, `nav_node_table`, `new_table italics`, `navGroup`…). */
  classes: string
  isNew: boolean
  /** The node has an expander (`node_is_group` in node.twig). */
  expandable: boolean
  /** The expander has class `loaded`: children are already present (`children`), no request needed. */
  loaded: boolean
  /** The expander shows `b_minus`: the branch is open (state restore). */
  expanded: boolean
  /**
   * The node itself is not rendered (pma `show_node=false`: the only *Tables* container of a
   * database); its fast filter, page selector and children appear in place of it.
   */
  flatten: boolean
  icons: NavIcon[]
  link: NavLink | null
  /** pos2 / pos3 pagination markers (`span.pos2_nav` / `span.pos3_nav`). */
  pagination: { position: 'pos2_nav' | 'pos3_nav'; name: string; value: number } | null
  /** Number of hidden items in a database (`navigationhiding`); shows the unhide control when > 0. */
  hiddenCount?: number | undefined
  hide?: NavHideItem | undefined
  children: NavList | null
}

export interface NavList {
  fastFilter: NavFastFilter | null
  pageSelector: NavPageSelector | null
  items: NavNode[]
}

export const NavNode: z.ZodType<NavNode> = z.lazy(() =>
  z.object({
    kind: NavNodeKind,
    container: NavContainer.optional(),
    name: z.string(),
    realName: z.string(),
    label: z.string(),
    aPath: z.array(z.string()),
    vPath: z.array(z.string()),
    classes: z.string(),
    isNew: z.boolean(),
    expandable: z.boolean(),
    loaded: z.boolean(),
    expanded: z.boolean(),
    flatten: z.boolean(),
    icons: z.array(NavIcon),
    link: NavLink.nullable(),
    pagination: z
      .object({ position: z.enum(['pos2_nav', 'pos3_nav']), name: z.string(), value: z.number().int() })
      .nullable(),
    hiddenCount: z.number().int().optional(),
    hide: NavHideItem.optional(),
    children: NavList.nullable(),
  }),
)

export const NavList: z.ZodType<NavList> = z.lazy(() =>
  z.object({
    fastFilter: NavFastFilter.nullable(),
    pageSelector: NavPageSelector.nullable(),
    items: z.array(NavNode),
  }),
)

/** Directives the panel needs (navigation/main.twig data attributes and classes). */
export const NavSettings = z.object({
  NavigationWidth: z.number().int(),
  NavigationLinkWithMainPanel: z.boolean(),
  NavigationTreePointerEnable: z.boolean(),
  NavigationTreeAutoexpandSingleDb: z.boolean(),
  NavigationTreeEnableExpansion: z.boolean(),
  /** false: the legacy pre-4.0 panel, a database select with the tree of the current database (NavigationTree::renderDbSelect) */
  ShowDatabasesNavigationAsTree: z.boolean(),
  NavigationDisplayLogo: z.boolean(),
  NavigationLogoLink: z.string(),
  NavigationLogoLinkWindow: z.enum(['main', 'new']),
  NavigationDisplayServers: z.boolean(),
  DisplayServersList: z.boolean(),
  DefaultTabServer: z.string(),
  NumRecentTables: z.number().int(),
  NumFavoriteTables: z.number().int(),
  /** `auth_type` of the current server: the logout link reads "Empty session data" for `config`. */
  authType: z.string(),
  isMariaDb: z.boolean(),
  /** `get_docu_url(is_mariadb)`: the MySQL (by server version) or MariaDB documentation. */
  serverDocsUrl: z.string(),
  /** Page selector links: `icons` (<< < > >>), `text` (Begin, Previous…) or `both`. */
  TableNavigationLinksMode: z.enum(['icons', 'text', 'both']),
})
export type NavSettings = z.infer<typeof NavSettings>

/** One expanded branch, as `traverseForPaths()` collects it (n{i}_aPath, n{i}_vPath, n{i}_pos2_*, n{i}_pos3_*). */
export const NavPath = z.object({
  aPath: z.array(z.string()),
  vPath: z.array(z.string()),
  pos2Name: z.string().optional(),
  pos2Value: z.number().int().optional(),
  pos3Name: z.string().optional(),
  pos3Value: z.number().int().optional(),
})
export type NavPath = z.infer<typeof NavPath>

/**
 * GET /api/servers/:s/navigation/tree?pos&searchClause&db — the whole tree (pma `full=1`).
 * When `pos` is absent and `db` is given, the page holding `db` is shown (getNavigationDbPos).
 */
export const NavTreeQuery = z.object({
  pos: z.coerce.number().int().min(0).optional(),
  searchClause: z.string().optional(),
  db: z.string().optional(),
})
export type NavTreeQuery = z.infer<typeof NavTreeQuery>

/** POST /api/servers/:s/navigation/tree — the tree with expanded branches (state restore, reload). */
export const NavTreeRequest = z.object({
  pos: z.number().int().min(0).optional(),
  searchClause: z.string().optional(),
  db: z.string().optional(),
  paths: z.array(NavPath).default([]),
  /** "Reload navigation panel": also drops the cached database list (`dbs_to_test`, #14252). */
  reload: z.boolean().default(false),
})
export type NavTreeRequest = z.input<typeof NavTreeRequest>

export const NavTreeResponse = z.object({
  settings: NavSettings,
  pos: z.number().int(),
  searchClause: z.string(),
  /** Root list: database fast filter, page selector (`dbselector`) and the database / group nodes. */
  tree: NavList,
  /** `Collapse all` / `Link with main panel` controls are shown (NavigationTreeEnableExpansion). */
  controls: z.boolean(),
  /** ShowDatabasesNavigationAsTree off: the databases of `#navi_db_select`, in the order of the query (renderDbSelect). */
  dbSelect: z.array(z.string()).optional(),
  /** User errors raised while building the tree (e.g. the large-group warning). */
  errors: z.array(z.string()),
})
export type NavTreeResponse = z.infer<typeof NavTreeResponse>

/**
 * GET /api/servers/:s/navigation/branch — one branch (pma `renderPath`, `loadChildNodes`).
 * `path` repeats once per aPath component after `root`: `[db]`, `[db, 'tables']`,
 * `[db, 'tables', table]`, `[db, 'tables', table, 'columns']`; no `path` is the root list (the
 * database fast filter's server search, `FastFilter.request`).
 */
export const NavBranchQuery = z.object({
  path: z.array(z.string()),
  pos: z.coerce.number().int().min(0).default(0),
  pos2Name: z.string().optional(),
  pos2Value: z.coerce.number().int().min(0).optional(),
  pos3Name: z.string().optional(),
  pos3Value: z.coerce.number().int().min(0).optional(),
  searchClause: z.string().optional(),
  searchClause2: z.string().optional(),
})
export type NavBranchQuery = z.input<typeof NavBranchQuery>

export const NavBranchResponse = z.object({
  /** null when the branch could not be built ("An error has occurred while loading the navigation display"). */
  list: NavList.nullable(),
  error: z.string().nullable(),
  /** The request carried a search clause: the list is a search result (`ul.search_results`). */
  searchResults: z.boolean(),
  /** "%s result found" / "%s results found" when a search clause was given. */
  results: z.string().nullable(),
  errors: z.array(z.string()),
})
export type NavBranchResponse = z.infer<typeof NavBranchResponse>
