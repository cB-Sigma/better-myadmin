import type { DbPrivilegesResponse } from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import { isSuperUser } from '../server-admin/context.ts'
import { PrivilegeProbe } from '../shell/privileges.ts'
import type { DbCtx } from './context.ts'

/**
 * Database → Privileges: the accounts with access to the database (read-only, linking to the user
 * editor).
 * pma: src/Controllers/Database/PrivilegesController.php, src/Server/Privileges.php::getAllPrivileges,
 *      ::extractPrivInfo, ::getGrantsArray, templates/database/privileges/index.twig
 */

/** Privileges::getGrantsArray */
function grants(tr: Translator): Array<[string, string, string]> {
  const g = (k: string, n: string, d: string): [string, string, string] => [k, n, tr.gettext(d)]
  return [
    g('Select_priv', 'SELECT', 'Allows reading data.'),
    g('Insert_priv', 'INSERT', 'Allows inserting and replacing data.'),
    g('Update_priv', 'UPDATE', 'Allows changing data.'),
    g('Delete_priv', 'DELETE', 'Allows deleting data.'),
    g('Create_priv', 'CREATE', 'Allows creating new databases and tables.'),
    g('Drop_priv', 'DROP', 'Allows dropping databases and tables.'),
    g('Reload_priv', 'RELOAD', "Allows reloading server settings and flushing the server's caches."),
    g('Shutdown_priv', 'SHUTDOWN', 'Allows shutting down the server.'),
    g('Process_priv', 'PROCESS', 'Allows viewing processes of all users.'),
    g('File_priv', 'FILE', 'Allows importing data from and exporting data into files.'),
    g('References_priv', 'REFERENCES', 'Has no effect in this MySQL version.'),
    g('Index_priv', 'INDEX', 'Allows creating and dropping indexes.'),
    g('Alter_priv', 'ALTER', 'Allows altering the structure of existing tables.'),
    g('Show_db_priv', 'SHOW DATABASES', 'Gives access to the complete list of databases.'),
    g(
      'Super_priv',
      'SUPER',
      'Allows connecting, even if maximum number of connections is reached; required for most administrative operations like setting global variables or killing threads of other users.',
    ),
    g('Create_tmp_table_priv', 'CREATE TEMPORARY TABLES', 'Allows creating temporary tables.'),
    g('Lock_tables_priv', 'LOCK TABLES', 'Allows locking tables for the current thread.'),
    g('Repl_slave_priv', 'REPLICATION SLAVE', 'Needed for the replication replicas.'),
    g('Repl_client_priv', 'REPLICATION CLIENT', 'Allows the user to ask where the replicas / primaries are.'),
    g('Create_view_priv', 'CREATE VIEW', 'Allows creating new views.'),
    g('Event_priv', 'EVENT', 'Allows to set up events for the event scheduler.'),
    g('Trigger_priv', 'TRIGGER', 'Allows creating and dropping triggers.'),
    g('Create View_priv', 'CREATE VIEW', 'Allows creating new views.'),
    g('Show_view_priv', 'SHOW VIEW', 'Allows performing SHOW CREATE VIEW queries.'),
    g('Show view_priv', 'SHOW VIEW', 'Allows performing SHOW CREATE VIEW queries.'),
    g('Delete_history_priv', 'DELETE HISTORY', 'Allows deleting historical rows.'),
    g('Delete versioning rows_priv', 'DELETE HISTORY', 'Allows deleting historical rows.'),
    g('Create_routine_priv', 'CREATE ROUTINE', 'Allows creating stored routines.'),
    g('Alter_routine_priv', 'ALTER ROUTINE', 'Allows altering and dropping stored routines.'),
    g('Create_user_priv', 'CREATE USER', 'Allows creating, dropping and renaming user accounts.'),
    g('Execute_priv', 'EXECUTE', 'Allows executing stored routines.'),
  ]
}

/** Privileges::extractPrivInfo($row, enableHTML) as {name, title} */
function extractPrivInfo(
  tr: Translator,
  row: Record<string, string | null>,
): Array<{ name: string; title: string }> {
  const privs: Array<{ name: string; title: string }> = []
  let all = true
  for (const [key, name, title] of grants(tr)) {
    const v = row[key]
    if (v === undefined || v === null) continue
    if (v === 'Y') privs.push({ name, title })
    else all = false
  }
  if (privs.length === 0) return [{ name: 'USAGE', title: tr.gettext('No privileges.') }]
  if (all) return [{ name: 'ALL PRIVILEGES', title: tr.gettext('Includes all privileges except GRANT.') }]
  return privs
}

const PRIV_LIST = [
  'Select_priv',
  'Insert_priv',
  'Update_priv',
  'Delete_priv',
  'Create_priv',
  'Drop_priv',
  'Grant_priv',
  'Index_priv',
  'Alter_priv',
  'References_priv',
  'Create_tmp_table_priv',
  'Lock_tables_priv',
  'Create_view_priv',
  'Show_view_priv',
  'Create_routine_priv',
  'Alter_routine_priv',
  'Execute_priv',
  'Event_priv',
  'Trigger_priv',
]

export async function dbPrivileges(ctx: DbCtx): Promise<DbPrivilegesResponse> {
  const { tr } = ctx
  let db = ctx.db
  if ((await ctx.dbi.getLowerCaseNames()) === 1) db = db.toLowerCase()
  const v = ctx.conn.serverInfo?.versionInt ?? 0
  const maria = ctx.conn.serverInfo?.isMariaDb ?? false
  const p = new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache)
  const grant = await p.isGrantUser(v, maria)
  const create = await p.isCreateUser(v, maria)
  const superUser = await isSuperUser(ctx.dbi)
  const base: DbPrivilegesResponse = {
    db,
    isSuperUser: superUser,
    isGrantUser: grant,
    isCreateUser: create,
    error: null,
    notice: null,
    accounts: [],
  }
  if (!superUser && !grant && !create) return { ...base, error: tr.gettext('No Privileges') }
  if (!grant && !create) base.notice = tr.gettext('You do not have the privileges to administrate the users!')
  if (!superUser) return base
  const list = PRIV_LIST.map((x) => `\`${x}\``).join(',\n            ')
  const compared = PRIV_LIST.filter((x) => x !== 'Index_priv' && x !== 'Alter_priv')
    .map((x) => `BINARY \`${x}\` = 'N'`)
    .join(' AND\n            ')
  const rows = await ctx.dbi.fetchResultSimple(`
            (
                SELECT \`User\`, \`Host\`, ${list}, '*' AS \`Db\`, 'g' AS \`Type\`
                FROM \`mysql\`.\`user\`
                WHERE NOT (${compared})
            )
            UNION
            (
                SELECT \`User\`, \`Host\`, ${list}, \`Db\`, 'd' AS \`Type\`
                FROM \`mysql\`.\`db\`
                WHERE ${ctx.dbi.quoteString(db)} LIKE \`Db\` AND NOT (${compared})
            )
            ORDER BY \`User\` ASC, \`Host\` ASC, \`Db\` ASC;
        `)
  const routines = await ctx.dbi.fetchResultSimple(`
            SELECT *, 'r' AS \`Type\`
            FROM \`mysql\`.\`procs_priv\`
            WHERE Db = ${ctx.dbi.quoteString(db)};`)
  const accounts = new Map<string, DbPrivilegesResponse['accounts'][number]>()
  for (const r of [...rows, ...routines]) {
    const key = `${r.User ?? ''}@${r.Host ?? ''}`
    let a = accounts.get(key)
    if (a === undefined) {
      a = { user: r.User ?? '', host: r.Host ?? '', privileges: [] }
      accounts.set(key, a)
    }
    const type = (r.Type ?? 'g') as 'g' | 'd' | 'r'
    if (type === 'r') {
      const procPriv = r.Proc_priv ?? ''
      a.privileges.push({
        type,
        database: r.Db ?? '',
        routine: r.Routine_name ?? '',
        hasGrant: procPriv.includes('Grant'),
        privileges: procPriv.split(',').map((x) => ({ name: x.toUpperCase(), title: '' })),
      })
    } else {
      a.privileges.push({
        type,
        database: r.Db ?? '',
        routine: null,
        hasGrant: r.Grant_priv === 'Y',
        privileges: extractPrivInfo(tr, r),
      })
    }
  }
  return { ...base, accounts: [...accounts.values()] }
}
