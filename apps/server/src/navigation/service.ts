import type { NavBranchResponse, NavPath, NavSettings, NavTreeResponse } from '@bettermyadmin/contracts'
import type { AppConfig, ServerConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { NavDbi } from './dbi.ts'
import type { NavCtx, NavigationHiding } from './nodes.ts'
import { forgetDatabasesToTest, getPrivileges } from './privileges.ts'
import { NAVIGATION_ERROR, NavigationTree } from './tree.ts'

export interface NavServiceDeps {
  cfg: AppConfig
  server: ServerConfig
  conn: Conn
  /** Per-server session cache (SessionCache). */
  cache: Record<string, unknown>
  hiding: NavigationHiding | null
}

/**
 * Extension point for the metadata layer: returns the navigation-hiding feature
 * (`pma__navigationhiding`) for a request, or null when the pmadb table is not configured.
 */
export type NavigationHidingFactory = (deps: Omit<NavServiceDeps, 'hiding'>) => NavigationHiding | null
let hidingFactory: NavigationHidingFactory = () => null

export function setNavigationHidingFactory(f: NavigationHidingFactory): void {
  hidingFactory = f
}

export function navigationHiding(deps: Omit<NavServiceDeps, 'hiding'>): NavigationHiding | null {
  return hidingFactory(deps)
}

/** pma: Util::getMySQLDocuURL('') */
function mysqlDocsUrl(version: number): string {
  const mysql = version >= 90000 ? '9.0' : version >= 80000 ? '8.0' : '5.7'
  return `https://dev.mysql.com/doc/refman/${mysql}/en/index.html`
}

async function context(deps: NavServiceDeps): Promise<NavCtx> {
  const dbi = new NavDbi(deps.conn, deps.cache)
  return {
    dbi,
    cfg: deps.cfg,
    server: deps.server,
    privileges: await getPrivileges(dbi),
    hiding: deps.hiding,
  }
}

export function navSettings(deps: Pick<NavServiceDeps, 'cfg' | 'server' | 'conn'>): NavSettings {
  const { cfg, server } = deps
  const isMariaDb = deps.conn.serverInfo?.isMariaDb ?? false
  const v = deps.conn.serverInfo?.versionInt ?? 0
  return {
    NavigationWidth: cfg.NavigationWidth,
    NavigationLinkWithMainPanel: cfg.NavigationLinkWithMainPanel,
    NavigationTreePointerEnable: cfg.NavigationTreePointerEnable,
    NavigationTreeAutoexpandSingleDb: cfg.NavigationTreeAutoexpandSingleDb,
    NavigationTreeEnableExpansion: cfg.NavigationTreeEnableExpansion,
    NavigationDisplayLogo: cfg.NavigationDisplayLogo,
    NavigationLogoLink: cfg.NavigationLogoLink,
    NavigationLogoLinkWindow: cfg.NavigationLogoLinkWindow as 'main' | 'new',
    NavigationDisplayServers: cfg.NavigationDisplayServers,
    DisplayServersList: cfg.DisplayServersList,
    DefaultTabServer: cfg.DefaultTabServer,
    NumRecentTables: cfg.NumRecentTables,
    NumFavoriteTables: cfg.NumFavoriteTables,
    authType: server.auth_type,
    isMariaDb,
    serverDocsUrl: isMariaDb ? 'https://mariadb.com/kb/en/documentation/' : mysqlDocsUrl(v),
    TableNavigationLinksMode: cfg.TableNavigationLinksMode as 'icons' | 'text' | 'both',
  }
}

/**
 * The whole tree, optionally with expanded branches (pma: POST /navigation with `full=1` or
 * `reload=1` and `n{i}_aPath`… → Navigation::getDisplay → NavigationTree::renderState).
 */
export async function navigationTree(
  deps: NavServiceDeps,
  req: {
    pos?: number | undefined
    db?: string | undefined
    searchClause?: string | undefined
    paths: NavPath[]
    reload: boolean
  },
): Promise<NavTreeResponse> {
  const ctx = await context(deps)
  const tree = await NavigationTree.create(ctx, {
    pos: req.pos,
    db: req.db,
    paths: req.paths,
    searchClause: req.searchClause,
  })
  if (req.reload) {
    // NavigationController runs after the tree was constructed: the reset applies to getDisplay()
    forgetDatabasesToTest(ctx.dbi)
    ctx.privileges = await getPrivileges(ctx.dbi)
  }
  const list = await tree.renderState()
  return {
    settings: navSettings(deps),
    pos: tree.pos,
    searchClause: tree.searchClause,
    tree: list,
    controls: deps.cfg.NavigationTreeEnableExpansion,
    errors: tree.errors,
  }
}

/** One branch (pma: POST /navigation with `aPath` → NavigationTree::renderPath). */
export async function navigationBranch(
  deps: NavServiceDeps,
  req: {
    path: string[]
    pos: number
    pos2Name?: string | undefined
    pos2Value?: number | undefined
    pos3Name?: string | undefined
    pos3Value?: number | undefined
    searchClause?: string | undefined
    searchClause2?: string | undefined
  },
): Promise<NavBranchResponse> {
  const ctx = await context(deps)
  const path: NavPath = { aPath: req.path, vPath: [] }
  // loadChildNodes always posts pos2_name/pos2_value (empty when absent)
  path.pos2Name = req.pos2Name ?? ''
  path.pos2Value = req.pos2Value ?? 0
  if (req.pos3Name !== undefined) {
    path.pos3Name = req.pos3Name
    path.pos3Value = req.pos3Value ?? 0
  }
  const tree = await NavigationTree.create(ctx, {
    pos: req.pos,
    // no aPath at all (database fast filter search): the root is the branch
    paths: req.path.length === 0 ? [] : [path],
    searchClause: req.searchClause,
    searchClause2: req.searchClause2,
  })
  const r = await tree.renderPath()
  return {
    list: r.list === false ? null : r.list,
    error: r.list === false ? NAVIGATION_ERROR : null,
    searchResults: r.searchResults,
    results: r.results,
    errors: tree.errors,
  }
}
