import type {
  AdminMessage,
  ReplicationActionResponse,
  ReplicationPage,
  ReplicationView,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  changePrimarySql,
  replicaControlSql,
  resetReplicaSql,
  showAllReplicasStatusSql,
  showBinLogStatusSql,
  showReplicasSql,
  skipCounterSql,
} from '@bettermyadmin/sql-gen'
import mysql from 'mysql2/promise'
import { sanitizeMySQLHost } from '../auth/cookie.ts'
import { Conn } from '../db/connection.ts'
import { connectionOptions } from '../db/pool-manager.ts'
import { MysqlError } from '../http/errors.ts'
import { NavDbi } from '../navigation/dbi.ts'
import { TableReader } from '../table/read.ts'
import { type AdminCtx, isSuperUser, isSystemSchema } from './context.ts'
import { databaseList } from './databases.ts'
import { ReplicationInfo, replicationStatusTable } from './replication-info.ts'

/**
 * Server › Replication: primary and replica status, the configuration helpers and the replica
 * controls, in ReplicationController's order (isSuperUser, ReplicationInfo, the requested action,
 * then the page's own reads) so the statement logs stay comparable.
 *
 * pma: src/Controllers/Server/ReplicationController.php, src/Replication/ReplicationGui.php,
 *      src/Replication/Replication.php, templates/server/replication/*.twig
 */

export interface ReplicationRequest {
  view: ReplicationView
  primaryConnection: string | null
  username: string | null
  hostname: string | null
}

type Action = (ctx: AdminCtx) => Promise<{ success: boolean; message: AdminMessage | null }>

const flavour = (ctx: AdminCtx) => ({ versionInt: ctx.versionInt, isMariaDb: ctx.isMariaDb })

/** The page, optionally after an action (handleControlRequest runs between load() and the render). */
async function run(
  ctx: AdminCtx,
  req: ReplicationRequest,
  action: Action | null,
): Promise<{ page: ReplicationPage; success: boolean; message: AdminMessage | null }> {
  // selectDb('mysql') for a superuser is not sent (X36)
  const superUser = await isSuperUser(ctx.dbi)
  const info = await new ReplicationInfo(ctx.dbi, ctx.versionInt, ctx.isMariaDb).load(req.primaryConnection)
  let result: { success: boolean; message: AdminMessage | null } = { success: false, message: null }
  if (superUser && action !== null) result = await action(ctx)

  const clearScreen = req.view === 'replica_configure' || req.view === 'primary_add_user'
  const page: ReplicationPage = {
    isSuperUser: superUser,
    isPrimary: info.primaryInfo.status,
    view: req.view,
    primary: null,
    addUser: null,
    primaryConfiguration: null,
    replica: null,
    changePrimary: null,
  }
  if (info.primaryInfo.status) {
    if (!clearScreen) {
      const statusTable = await replicationStatusTable(
        ctx.dbi,
        ctx.versionInt,
        ctx.isMariaDb,
        'primary',
        req.primaryConnection,
      )
      const replicas = await ctx.dbi.fetchResultSimple(showReplicasSql(flavour(ctx)))
      page.primary = {
        statusTable,
        replicas: replicas.map((r) => ({ serverId: r.Server_id ?? '', host: r.Host ?? '' })),
      }
    }
    if (req.view === 'primary_add_user') page.addUser = await addUserForm(ctx, req.username, req.hostname)
  }
  if (req.view === 'primary_configure') {
    const databases = (await databaseList(ctx)).filter((db) => !isSystemSchema(db))
    page.primaryConfiguration = { databases }
  } else {
    if (!clearScreen) {
      page.replica = await replicaConfiguration(
        ctx,
        req.primaryConnection,
        info.replicaInfo.status,
        info.replicaStatus[0] ?? {},
      )
    }
    if (req.view === 'replica_configure') {
      const [usernameLength, hostnameLength] = await usernameHostnameLength(ctx)
      // change_primary.twig: server-id={{ time() }}
      page.changePrimary = { serverId: Math.floor(Date.now() / 1000), usernameLength, hostnameLength }
    }
  }
  return { page, ...result }
}

export async function replicationPage(ctx: AdminCtx, req: ReplicationRequest): Promise<ReplicationPage> {
  return (await run(ctx, req, null)).page
}

/**
 * ReplicationGui::getHtmlForReplicaConfiguration — the connection selector (MariaDB), the
 * thread-not-running errors and the control links.
 */
async function replicaConfiguration(
  ctx: AdminCtx,
  connection: string | null,
  isReplica: boolean,
  /** the replica status ReplicationController loaded (before the action) */
  r: Record<string, string | null>,
): Promise<NonNullable<ReplicationPage['replica']>> {
  const multi = showAllReplicasStatusSql(flavour(ctx))
  const multiRows = multi === null ? [] : await ctx.dbi.fetchResultSimple(multi)
  let io = false
  let sql = false
  let statusTable = null
  if (isReplica) {
    const running = (slave: string, replica: string) =>
      (r[slave] !== undefined && r[slave] !== null && r[slave] !== 'No') ||
      (r[replica] !== undefined && r[replica] !== null && r[replica] !== 'No')
    // phpMyAdmin reads the IO state of a REPLICA-keyword server from Replica_SQL_Running and passes
    // the two states swapped to the template (Q16, Q60): fixed, each flag is its own thread's
    io = running('Slave_IO_Running', 'Replica_IO_Running')
    sql = running('Slave_SQL_Running', 'Replica_SQL_Running')
    // getHtmlForReplicationStatusTable loads its own ReplicationInfo
    statusTable = await replicationStatusTable(ctx.dbi, ctx.versionInt, ctx.isMariaDb, 'replica', connection)
  }
  return {
    connections: multiRows.map((m) => m.Connection_name ?? ''),
    primaryConnection: connection ?? '',
    isReplica,
    sqlRunning: sql,
    ioRunning: io,
    fullAction: !io || !sql ? 'start' : 'stop',
    sqlAction: sql ? 'stop' : 'start',
    ioAction: io ? 'stop' : 'start',
    statusTable,
  }
}

/** ReplicationGui::getUsernameHostnameLength — from the column types of mysql.user (16 / 41 otherwise) */
async function usernameHostnameLength(ctx: AdminCtx): Promise<[number, number]> {
  const reader = new TableReader(ctx.conn, ctx.dbi.cache, ctx.tr)
  let user = 16
  let host = 41
  for (const col of await reader.getColumns('mysql', 'user')) {
    // strtok($type, '()'); strtok('()'): the text between the first parentheses
    const inner = /^[^()]*\(+([^()]*)/.exec(col.Type)?.[1]
    const n = inner !== undefined && /^\d+$/.test(inner) ? Number(inner) : null
    if (col.Field === 'User' && n !== null) user = n
    else if (col.Field === 'Host' && n !== null) host = n
  }
  return [user, host]
}

/** ReplicationGui::getHtmlForReplicationPrimaryAddReplicaUser */
async function addUserForm(
  ctx: AdminCtx,
  postUsername: string | null,
  hostname: string | null,
): Promise<NonNullable<ReplicationPage['addUser']>> {
  const [usernameLength, hostnameLength] = await usernameHostnameLength(ctx)
  let username = ''
  let predefinedUsername: 'any' | 'userdefined' = 'userdefined'
  if (postUsername === '') predefinedUsername = 'any'
  else if (postUsername !== null && postUsername !== '0') username = postUsername
  let thisHost: string | null = null
  const current = await ctx.dbi.fetchValue('SELECT USER();')
  if (typeof current === 'string' && current !== '') {
    const userHost = current.slice(current.lastIndexOf('@') + 1).replaceAll("'", '')
    if (userHost !== 'localhost' && userHost !== '127.0.0.1') thisHost = userHost
  }
  let predefinedHostname: 'any' | 'localhost' | 'userdefined' = 'any'
  if (hostname !== null) {
    const h = hostname.toLowerCase()
    predefinedHostname =
      h === 'localhost' || h === '127.0.0.1' ? 'localhost' : h === '%' ? 'any' : 'userdefined'
  }
  return {
    usernameLength,
    hostnameLength,
    username,
    hostname: hostname ?? '',
    predefinedUsername,
    predefinedHostname,
    hasUsername: postUsername !== null,
    thisHost,
  }
}

const ok = (q: unknown) => q !== null

/**
 * `sr_replica_server_control`: START/STOP [IO_THREAD|SQL_THREAD], or reset (STOP; RESET; START).
 * pma: ReplicationGui::handleControlRequest, ::handleRequestForReplicaServerControl
 */
export async function replicaControl(
  ctx: AdminCtx,
  req: ReplicationRequest,
  action: string,
  control: string | null,
): Promise<ReplicationActionResponse> {
  return run(ctx, req, async () => {
    const { tr } = ctx
    const f = flavour(ctx)
    const exec = async (sql: string | null) =>
      sql === null ? false : ok(await ctx.dbi.tryQuery(sql, 'replication.control'))
    let result: boolean
    if (action === 'reset') {
      const stop = await exec(replicaControlSql(f, 'STOP'))
      const reset = await exec(resetReplicaSql(f))
      const start = await exec(replicaControlSql(f, 'START'))
      result = stop && reset && start
    } else {
      result = await exec(replicaControlSql(f, action, control))
    }
    const [success, error] =
      action === 'start'
        ? [tr.gettext('Replication started successfully.'), tr.gettext('Error starting replication.')]
        : action === 'stop'
          ? [tr.gettext('Replication stopped successfully.'), tr.gettext('Error stopping replication.')]
          : action === 'reset'
            ? [tr.gettext('Replication resetting successfully.'), tr.gettext('Error resetting replication.')]
            : [tr.gettext('Success.'), tr.gettext('Error.')]
    return {
      success: result,
      message: result ? { type: 'success', text: success } : { type: 'error', text: error },
    }
  })
}

/**
 * `sr_replica_skip_error`: STOP; SET GLOBAL SQL_[REPLICA|SLAVE]_SKIP_COUNTER = n; START. phpMyAdmin
 * reports nothing for it. pma: ReplicationGui::handleRequestForReplicaSkipError
 */
export async function replicaSkipErrors(
  ctx: AdminCtx,
  req: ReplicationRequest,
  count: number,
): Promise<ReplicationActionResponse> {
  return run(ctx, req, async () => {
    const f = flavour(ctx)
    const exec = async (sql: string | null) =>
      sql === null ? false : ok(await ctx.dbi.tryQuery(sql, 'replication.skip'))
    const stop = await exec(replicaControlSql(f, 'STOP'))
    const skip = await exec(skipCounterSql(f, count))
    const start = await exec(replicaControlSql(f, 'START'))
    return { success: stop && skip && start, message: null }
  })
}

/**
 * `replica_changeprimary`: needs AllowArbitraryServer; reads the new primary's binary log position
 * over an auxiliary connection (no connection set-up statements, like phpMyAdmin's), then STOP and
 * CHANGE REPLICATION SOURCE / CHANGE MASTER on the replica, which is not started again.
 * pma: ReplicationGui::handleRequestForReplicaChangePrimary, Replication::connectToPrimary,
 *      ::replicaBinLogPrimary, ::replicaChangePrimary
 */
export async function changePrimary(
  ctx: AdminCtx,
  req: ReplicationRequest,
  o: { username: string; password: string; hostname: string; port: number },
): Promise<ReplicationActionResponse> {
  return run(ctx, req, async () => {
    const { tr } = ctx
    const error = (text: string) => ({ success: false, message: { type: 'error' as const, text } })
    if (!ctx.cfg.AllowArbitraryServer) {
      return error(
        tr.gettext(
          "Connection to server is disabled, please enable $cfg['AllowArbitraryServer'] in phpMyAdmin configuration.",
        ),
      )
    }
    const f = flavour(ctx)
    const position = await primaryPosition(ctx, o, showBinLogStatusSql(f))
    if (position === null) return error(sprintf(tr.gettext('Unable to connect to primary %s.'), o.hostname))
    if (position === false) {
      return error(tr.gettext('Unable to read primary log position. Possible privilege problem on primary.'))
    }
    await ctx.dbi.tryQuery(replicaControlSql(f, 'STOP')!, 'replication.changePrimary')
    const sql = changePrimarySql(f, {
      user: o.username,
      password: o.password,
      host: o.hostname,
      port: o.port,
      ...position,
    })
    if (!ok(await ctx.dbi.tryQuery(sql, 'replication.changePrimary')))
      return error(tr.gettext('Unable to change primary!'))
    return {
      success: true,
      message: {
        type: 'success',
        text: sprintf(tr.gettext('Primary server changed successfully to %s.'), o.hostname),
      },
    }
  })
}

/** The primary's File/Position over an auxiliary link: null when it cannot connect, false when empty. */
async function primaryPosition(
  ctx: AdminCtx,
  o: { username: string; password: string; hostname: string; port: number },
  statement: string,
): Promise<{ file: string; position: string } | null | false> {
  // Replication::connectToPrimary: a Server with only user, password, host, port (no SSL, socket)
  const server = {
    ...ctx.server,
    host: sanitizeMySQLHost(o.hostname),
    socket: '',
    ssl: false,
    compress: false,
  }
  const pool = mysql.createPool({
    ...connectionOptions(server, { user: o.username, password: o.password, port: o.port }),
    connectionLimit: 1,
  })
  try {
    const raw = await pool.getConnection().catch(() => null)
    if (raw === null) return null
    try {
      const aux = new NavDbi(new Conn(raw, ctx.conn.log), {})
      const rows = await aux.fetchResultSimple(statement)
      const r = rows[0]
      if (r === undefined) return false
      return { file: r.File ?? '', position: r.Position ?? '' }
    } finally {
      raw.release()
    }
  } catch (e) {
    if (e instanceof MysqlError) return false
    throw e
  } finally {
    await pool.end().catch(() => {})
  }
}
