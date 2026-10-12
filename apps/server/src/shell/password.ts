import type { ChangePasswordResponse, PasswordForm } from '@bettermyadmin/contracts'
import { N_ } from '@bettermyadmin/i18n'
import { quoteString } from '@bettermyadmin/sql-gen'
import { ForbiddenError, MysqlError, ValidationError } from '../http/errors.ts'
import { PrivilegeProbe } from './privileges.ts'
import type { ShellCtx } from './scope.ts'

export const NOT_ALLOWED = "You don't have sufficient privileges to be here right now!"

/** Plugins::getTranslatedDescription — msgids for the server's English descriptions. */
const PLUGIN_DESCRIPTIONS = new Set([
  N_('Native MySQL authentication'),
  N_('SHA256 password authentication'),
  N_('Caching sha2 authentication'),
  N_('Unix Socket based authentication'),
  N_('Old MySQL-4.0 authentication'),
])

function facts(ctx: ShellCtx) {
  const si = ctx.conn.serverInfo
  const v = si?.versionInt ?? 0
  const isMariaDb = si?.isMariaDb ?? false
  return { v, isMariaDb, isMySqlOrPercona: !isMariaDb }
}

/**
 * `$cfg['ShowChgPassword'] || $dbi->selectDb('mysql')`, refused for config auth.
 * pma: src/Controllers/UserPasswordController.php
 */
async function checkAccess(ctx: ShellCtx): Promise<void> {
  let allowed = ctx.cfg.ShowChgPassword
  if (!allowed) {
    try {
      await ctx.conn.query('USE `mysql`', 'password.selectDb')
      allowed = true
    } catch {
      allowed = false
    }
  }
  if (ctx.server.auth_type === 'config' || !allowed) throw new ForbiddenError(ctx.tr.gettext(NOT_ALLOWED))
}

/** Privileges::getCurrentAuthenticationPlugin (fallback when mysql.user cannot be read). */
async function currentAuthPlugin(ctx: ShellCtx, user: string, host: string): Promise<string> {
  try {
    const v = await ctx.conn.value(
      `SELECT \`plugin\` FROM \`mysql\`.\`user\` WHERE \`User\` = ${quoteString(user)} AND \`Host\` = ${quoteString(host)} LIMIT 1`,
      'password.plugin',
    )
    return v ?? 'mysql_native_password'
  } catch {
    return 'mysql_native_password'
  }
}

/**
 * The change-password form opened from the home page: called with an empty user and host, so the
 * preselected hashing plugin is the fallback `mysql_native_password` (quirk Q43).
 * pma: src/Server/Privileges.php::getFormForChangePassword, templates/server/privileges/change_password.twig
 */
export async function passwordForm(ctx: ShellCtx): Promise<PasswordForm> {
  await checkAccess(ctx)
  const { v, isMariaDb, isMySqlOrPercona } = facts(ctx)
  const origAuthPlugin = await currentAuthPlugin(ctx, '', '')
  const isNew = (isMySqlOrPercona && v >= 50507) || (isMariaDb && v >= 50200)
  const hasMore = isMySqlOrPercona && v >= 50706 // `|| ($dbi->isSuperUser() && $editOthers)`, editOthers = false
  let authPlugins = [{ name: 'mysql_native_password', description: N_('Native MySQL authentication') }]
  if (isNew && hasMore) {
    const rows = await ctx.conn.rows(
      "SELECT `PLUGIN_NAME`, `PLUGIN_DESCRIPTION` FROM `information_schema`.`PLUGINS` WHERE `PLUGIN_TYPE` = 'AUTHENTICATION';",
      'password.plugins',
    )
    authPlugins = rows
      .map((r) => ({ name: r.PLUGIN_NAME ?? '', description: r.PLUGIN_DESCRIPTION ?? '' }))
      .filter((p) => p.name !== 'mysql_old_password')
      .map((p) => ({
        ...p,
        description: PLUGIN_DESCRIPTIONS.has(p.description) ? ctx.tr.gettext(p.description) : p.description,
      }))
  }
  return {
    username: '',
    origAuthPlugin,
    showHashing: !isNew || (isNew && hasMore),
    showSslNotice: isNew && hasMore,
    authPlugins,
    allowNoPassword: ctx.server.AllowNoPassword,
  }
}

/** UserPassword::setChangePasswordMsg */
export function validatePassword(pw: string, pw2: string, noPassword: boolean): string | null {
  if (noPassword) return null
  if (pw === '' || pw2 === '') return N_('The password is empty!')
  if (pw !== pw2) return N_("The passwords aren't the same!")
  if (Buffer.byteLength(pw, 'utf8') > 256) return N_('Password is too long!')
  return null
}

/** UserPassword::getChangePasswordQueryAlterUserMySQL */
export function alterUserQuery(
  v: number,
  user: string,
  host: string,
  plugin: string,
  password: string,
  pluginChanged: boolean,
): string {
  const pw = password === '' ? "''" : quoteString(password)
  if (v >= 50706 && v < 50737) {
    return `ALTER USER ${quoteString(user)}@${quoteString(host)} IDENTIFIED WITH ${plugin} BY ${pw}`
  }
  return `ALTER USER ${quoteString(user)}@${quoteString(host)} IDENTIFIED${pluginChanged ? ` WITH ${plugin}` : ''} BY ${pw}`
}

/**
 * POST /user-password: validate, run the statement for the server flavour, FLUSH PRIVILEGES.
 * Returns the masked statement phpMyAdmin shows under "The profile has been updated.".
 * pma: src/UserPassword.php::changePassword, changePassUrlParamsAndSubmitQuery
 */
export async function changePassword(
  ctx: ShellCtx,
  req: { nopass: boolean; pma_pw: string; pma_pw2: string; authentication_plugin?: string | undefined },
): Promise<ChangePasswordResponse & { password: string }> {
  await checkAccess(ctx)
  const invalid = validatePassword(req.pma_pw, req.pma_pw2, req.nopass)
  if (invalid !== null) throw new ValidationError(ctx.tr.gettext(invalid))
  const password = req.nopass ? '' : req.pma_pw
  const posted = req.authentication_plugin ?? ''
  const hashing = posted === 'mysql_old_password' ? 'OLD_PASSWORD' : 'PASSWORD'
  const { v, isMariaDb, isMySqlOrPercona } = facts(ctx)
  const [username, hostname] = await new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache).currentUserAndHost()
  let origAuthPlugin = await currentAuthPlugin(ctx, username, hostname)
  let changed = false
  if (posted !== '') {
    if (origAuthPlugin !== posted) changed = true
    origAuthPlugin = posted
  }

  let sqlQuery = `SET password = ${password === '' ? "''" : `${hashing}('***')`}`
  if (isMySqlOrPercona && v >= 50706) {
    sqlQuery = alterUserQuery(v, username, hostname, origAuthPlugin, password === '' ? '' : '***', changed)
  } else if ((isMySqlOrPercona && v >= 50507) || (isMariaDb && v >= 50200)) {
    await ctx.conn
      .query(
        `SET \`old_passwords\` = ${origAuthPlugin === 'sha256_password' ? 2 : 0};`,
        'password.oldPasswords',
      )
      .catch(() => {})
  }

  let localQuery: string
  if (isMySqlOrPercona && v >= 50706) {
    localQuery = alterUserQuery(v, username, hostname, origAuthPlugin, password, changed)
  } else if (isMariaDb && v >= 50200 && v < 100100 && origAuthPlugin !== '') {
    if (origAuthPlugin === 'mysql_native_password') {
      await ctx.conn.query('SET old_passwords = 0;', 'password.oldPasswords').catch(() => {})
    } else if (origAuthPlugin === 'sha256_password') {
      await ctx.conn.query('SET `old_passwords` = 2;', 'password.oldPasswords').catch(() => {})
    }
    const hashed =
      (await ctx.conn.value(`SELECT PASSWORD(${quoteString(req.pma_pw)});`, 'password.hash')) ?? ''
    for (const entry of ctx.conn.log)
      if (entry.label === 'password.hash') entry.sql = "SELECT PASSWORD('***');"
    localQuery =
      `UPDATE \`mysql\`.\`user\` SET \`authentication_string\` = '${hashed}', \`Password\` = '',  \`plugin\` = ${quoteString(origAuthPlugin)}` +
      ` WHERE \`User\` = ${quoteString(username)} AND Host = ${quoteString(hostname)};`
  } else {
    localQuery = `SET password = ${password === '' ? "''" : `${hashing}(${quoteString(password)})`}`
  }

  try {
    await ctx.conn.query(localQuery, 'password.change')
  } catch (e) {
    // Generator::mysqlDie(error, $sqlQuery): the masked statement is shown with the error
    if (e instanceof MysqlError) {
      throw new MysqlError(
        {
          message: e.message,
          sqlMessage: e.message,
          ...(e.extra.errno !== undefined ? { errno: e.extra.errno } : {}),
        },
        sqlQuery,
      )
    }
    throw e
  } finally {
    // never keep the clear-text password in the request's statement log (Debug SQL)
    for (const entry of ctx.conn.log) if (entry.sql === localQuery) entry.sql = sqlQuery
  }
  await ctx.conn.query('FLUSH PRIVILEGES;', 'password.flush').catch(() => {})
  return { ok: true, message: ctx.tr.gettext('The profile has been updated.'), sql: sqlQuery, password }
}
