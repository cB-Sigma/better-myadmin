import type { ReplicaUserResponse } from '@bettermyadmin/contracts'
import { quoteString } from '@bettermyadmin/sql-gen'
import { PrivilegeProbe } from '../shell/privileges.ts'
import type { AdminCtx } from './context.ts'

/**
 * "Add replica replication user" (primary_add_replica_user.twig): phpMyAdmin posts the form to
 * /server/privileges with `adduser_submit` and the single privilege `Repl_slave_priv=Y`, so this is
 * Privileges::addUser for exactly that form (no authentication plugin, no database for the user, no
 * SSL or resource limits): CREATE USER, GRANT REPLICATION SLAVE ON *.*, and on MySQL ≥ 8.0.11 the
 * ALTER USER … REQUIRE NONE. phpMyAdmin then renders the new user's edit page (Users & privileges).
 *
 * pma: src/Controllers/Server/PrivilegesController.php (adduser_submit), src/Server/Privileges.php
 *      ::getHostname, ::addUser, ::userExists, ::getSqlQueriesForDisplayAndAddUser,
 *      ::checkIfMariaDBPwdCheckPluginActive, ::getHashedPassword, ::addUserAndCreateDatabase
 */
export async function addReplicaUser(
  ctx: AdminCtx,
  req: {
    pred_username: 'any' | 'userdefined'
    username: string
    pred_hostname: 'any' | 'localhost' | 'thishost' | 'hosttable' | 'userdefined'
    hostname: string
    pred_password: 'none' | 'userdefined'
    pma_pw: string
  },
): Promise<ReplicaUserResponse> {
  const { dbi, tr } = ctx
  const v = ctx.versionInt
  const mysqlLike = !ctx.isMariaDb
  // Privileges::getHostname
  let hostname = req.hostname
  if (req.pred_hostname === 'any') hostname = '%'
  else if (req.pred_hostname === 'localhost') hostname = 'localhost'
  else if (req.pred_hostname === 'hosttable') hostname = ''
  else if (req.pred_hostname === 'thishost') {
    const current = await dbi.fetchValue('SELECT USER()')
    if (typeof current === 'string') hostname = current.slice(current.lastIndexOf('@') + 1)
  }
  const username = req.pred_username === 'any' ? '' : req.username
  const u = quoteString(username)
  const h = quoteString(hostname)

  // Privileges::userExists
  const exists = await dbi.fetchValue(
    `SELECT '1' FROM \`mysql\`.\`user\` WHERE \`User\` = ${u} AND \`Host\` = ${h};`,
  )
  if (exists !== false && exists !== null && exists !== '' && exists !== '0') {
    return {
      success: false,
      message: {
        type: 'error',
        text: tr
          .gettext('The user %s already exists!')
          .replace('%s', `<em>${escapeHtml(`'${username}'@'${hostname}'`)}</em>`),
      },
      sql: '',
    }
  }

  // Privileges::getSqlQueriesForDisplayAndAddUser
  const pluginActive = ctx.isMariaDb && v >= 100002 ? await mariaDbPasswordCheckActive(ctx) : false
  let createReal = `CREATE USER ${u}@${h}`
  let createShow = createReal
  if ((mysqlLike && v >= 50706) || (ctx.isMariaDb && v >= 50200)) {
    // no authentication_plugin is posted: MariaDB IDENTIFIED BY, MySQL ≥ 8.0.11 IDENTIFIED BY, else AS
    const clause = ctx.isMariaDb || v >= 80011 ? ' IDENTIFIED BY ' : ' AS '
    let secret: string
    if (req.pred_password === 'none') secret = "''"
    else if ((ctx.isMariaDb && pluginActive) || (mysqlLike && v >= 80011)) secret = quoteString(req.pma_pw)
    else
      secret = quoteString(
        String((await dbi.fetchValue(`SELECT PASSWORD(${quoteString(req.pma_pw)});`)) || ''),
      )
    createReal += clause + secret
    createShow += `${clause}'***'`
  }
  let grantReal = `GRANT REPLICATION SLAVE ON *.* TO ${u}@${h}`
  let alterReal = ''
  if (mysqlLike && v >= 80011) alterReal = `ALTER USER ${u}@${h} REQUIRE NONE;`
  else grantReal += ' REQUIRE NONE'
  createReal += ';'
  createShow += ';'
  grantReal += ';'
  let grantShow = grantReal
  // No Global GRANT_OPTION privilege
  const probe = new PrivilegeProbe(ctx.conn, ctx.server, dbi.cache)
  if (!(await probe.isGrantUser(v, ctx.isMariaDb))) {
    grantReal = ''
    grantShow = ''
  }

  // Privileges::addUser → addUserAndCreateDatabase (an error stops the following statements)
  let error = (await dbi.tryQuery(createReal, 'replicaUser.create')) === null
  let message = error ? dbi.lastError : ''
  let sql = createShow + grantShow
  if (!error && grantReal !== '' && (await dbi.tryQuery(grantReal, 'replicaUser.grant')) === null) {
    error = true
    message = dbi.lastError
  } else if (!error && alterReal !== '' && (await dbi.tryQuery(alterReal, 'replicaUser.alter')) === null) {
    error = true
    message = dbi.lastError
  } else if (!error) {
    sql += alterReal
  }
  return error
    ? { success: false, message: { type: 'error', text: escapeHtml(message) }, sql }
    : { success: true, message: { type: 'success', text: tr.gettext('You have added a new user.') }, sql }
}

/** Privileges::checkIfMariaDBPwdCheckPluginActive */
async function mariaDbPasswordCheckActive(ctx: AdminCtx): Promise<boolean> {
  const r = await ctx.dbi.tryQuery("SHOW PLUGINS SONAME LIKE '%_password_check%'", 'replicaUser.plugins')
  if (r === null) return false
  const status = r.fields.indexOf('Status')
  return r.rows.some((row) => row[status] === 'ACTIVE')
}

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
