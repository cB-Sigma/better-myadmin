import type { PrivForm, PrivilegesTable } from '@bettermyadmin/contracts'
import { N_ } from '@bettermyadmin/i18n'

/**
 * Pure logic of Server → User accounts: the browser's form submission as PHP reads it, the
 * privileges_table.twig model (sections, checkboxes, grant_count), the login presets and the
 * client-side checks of privileges.ts.
 * pma: resources/templates/server/privileges/privileges_table.twig, login_information_fields.twig,
 *      resources/js/server/privileges.ts, resources/js/modules/functions.ts
 */

/**
 * A submitted form the way PHP parses it into `$_POST`: successful controls only (no disabled
 * inputs, unchecked boxes or unselected options), `name[]` collected into a list, a repeated plain
 * name keeps its last value.
 */
export function formToPhp(entries: Iterable<[string, FormDataEntryValue]>): PrivForm {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue
    if (name.endsWith('[]')) {
      const key = name.slice(0, -2)
      const list = Array.isArray(out[key]) ? (out[key] as string[]) : []
      list.push(value)
      out[key] = list
    } else out[name] = value
  }
  return out
}

/** One privilege checkbox of the table. */
export interface PrivBox {
  name: string
  id: string
  /** the `<dfn>` text (the SQL privilege) */
  label: string
  /** msgid of the input's title */
  title: string
  /** msgid of the `<dfn title>` when it differs from the input's */
  dfnTitle?: string
  checked: boolean
}

export interface PrivGroup {
  id: 'Data' | 'Structure' | 'Administration' | 'Routine'
  label: string
  boxes: PrivBox[]
}

/** The column-privilege multi-selects of the table level. */
export interface ColumnSelect {
  key: 'Select' | 'Insert' | 'Update' | 'References'
  id: string
  label: string
  title: string
  options: Array<{ name: string; selected: boolean }>
}

export interface Limit {
  name: 'max_questions' | 'max_updates' | 'max_connections' | 'max_user_connections'
  label: string
  title: string
  value: string
}

export interface PrivilegesTableModel {
  variant: 'columns' | 'standard'
  /** card header msgid and the submenu label msgid */
  header: string
  submenuLabel: string
  groups: PrivGroup[]
  columns: ColumnSelect[]
  /** the table-level checkboxes next to the column selects */
  tableBoxes: PrivBox[]
  grantCount: number
  columnCount: number
  limits: Limit[] | null
  ssl: {
    type: string
    cipher: string
    issuer: string
    subject: string
  } | null
  hasSubmit: boolean
}

const GRANT_GLOBAL = N_('Allows adding users and privileges without reloading the privilege tables.')
const GRANT_OTHER = N_(
  'Allows user to give to other users or remove from other users the privileges that user possess yourself.',
)

/** pma: templates/server/privileges/privileges_table.twig */
export function privilegesTableModel(t: PrivilegesTable): PrivilegesTableModel {
  const row = t.row
  const y = (k: string) => (row[k] ?? null) === 'Y'
  const has = (k: string) => k in row
  const box = (
    name: string,
    label: string,
    title: string,
    checked = y(name),
    dfnTitle?: string,
  ): PrivBox => ({
    name,
    id: `checkbox_${name}`,
    label,
    title,
    ...(dfnTitle !== undefined ? { dfnTitle } : {}),
    checked,
  })
  const base = {
    limits: null,
    ssl: null,
    hasSubmit: t.hasSubmit,
  }
  if (t.columns !== null && t.columns.length > 0) {
    const cols = t.columns
    const select = (key: ColumnSelect['key'], label: string, title: string): ColumnSelect => ({
      key,
      id: `select_${key.toLowerCase()}_priv`,
      label,
      title,
      options: cols.map((c) => ({ name: c.name, selected: y(`${key}_priv`) || c[key] })),
    })
    const tableBoxes = [
      box('Delete_priv', 'DELETE', N_('Allows deleting data.')),
      box('Create_priv', 'CREATE', N_('Allows creating new tables.')),
      box('Drop_priv', 'DROP', N_('Allows dropping tables.')),
      box('Grant_priv', 'GRANT', GRANT_OTHER),
      box('Index_priv', 'INDEX', N_('Allows creating and dropping indexes.')),
      box('Alter_priv', 'ALTER', N_('Allows altering the structure of existing tables.')),
      box('Create_view_priv', 'CREATE VIEW', N_('Allows creating new views.'), y('Create View_priv')),
      box(
        'Show_view_priv',
        'SHOW VIEW',
        N_('Allows performing SHOW CREATE VIEW queries.'),
        y('Show view_priv'),
      ),
      box('Trigger_priv', 'TRIGGER', N_('Allows creating and dropping triggers.')),
      ...(has('Delete versioning rows_priv')
        ? [
            box(
              'Delete_history_priv',
              'DELETE HISTORY',
              N_('Allows deleting historical rows.'),
              y('Delete versioning rows_priv'),
            ),
          ]
        : []),
    ]
    return {
      ...base,
      variant: 'columns',
      header: 'Table-specific privileges',
      submenuLabel: 'Table',
      groups: [],
      columns: [
        select('Select', 'SELECT', N_('Allows reading data.')),
        select('Insert', 'INSERT', N_('Allows inserting and replacing data.')),
        select('Update', 'UPDATE', N_('Allows changing data.')),
        select('References', 'REFERENCES', N_('Has no effect in this MySQL version.')),
      ],
      tableBoxes,
      grantCount: Object.keys(row).length,
      columnCount: cols.length,
    }
  }
  const g = t.isGlobal
  const d = t.isDatabase
  const data: PrivBox[] = [
    box('Select_priv', 'SELECT', N_('Allows reading data.')),
    box('Insert_priv', 'INSERT', N_('Allows inserting and replacing data.')),
    box('Update_priv', 'UPDATE', N_('Allows changing data.')),
    box('Delete_priv', 'DELETE', N_('Allows deleting data.')),
    ...(g ? [box('File_priv', 'FILE', N_('Allows importing data from and exporting data into files.'))] : []),
  ]
  const structure: PrivBox[] = [
    box(
      'Create_priv',
      'CREATE',
      d ? N_('Allows creating new databases and tables.') : N_('Allows creating new tables.'),
    ),
    box('Alter_priv', 'ALTER', N_('Allows altering the structure of existing tables.')),
    box('Index_priv', 'INDEX', N_('Allows creating and dropping indexes.')),
    box('Drop_priv', 'DROP', d ? N_('Allows dropping databases and tables.') : N_('Allows dropping tables.')),
    box('Create_tmp_table_priv', 'CREATE TEMPORARY TABLES', N_('Allows creating temporary tables.')),
    box('Show_view_priv', 'SHOW VIEW', N_('Allows performing SHOW CREATE VIEW queries.')),
    box('Create_routine_priv', 'CREATE ROUTINE', N_('Allows creating stored routines.')),
    box('Alter_routine_priv', 'ALTER ROUTINE', N_('Allows altering and dropping stored routines.')),
    box('Execute_priv', 'EXECUTE', N_('Allows executing stored routines.')),
    ...(has('Create_view_priv')
      ? [box('Create_view_priv', 'CREATE VIEW', N_('Allows creating new views.'))]
      : []),
    ...(has('Create View_priv')
      ? [box('Create View_priv', 'CREATE VIEW', N_('Allows creating new views.'), y('Create View_priv'))]
      : []),
    ...(has('Event_priv')
      ? [
          box('Event_priv', 'EVENT', N_('Allows to set up events for the event scheduler.')),
          box('Trigger_priv', 'TRIGGER', N_('Allows creating and dropping triggers.')),
        ]
      : []),
  ]
  const references = t.supportsReferencesPrivilege
    ? N_('Allows creating foreign key relations.')
    : t.isMariaDb
      ? N_('Not used on MariaDB.')
      : N_('Not used for this MySQL version.')
  const administration: PrivBox[] = [
    ...(g
      ? [
          box('Grant_priv', 'GRANT', GRANT_GLOBAL),
          box(
            'Super_priv',
            'SUPER',
            N_(
              'Allows connecting, even if maximum number of connections is reached; required for most administrative operations like setting global variables or killing threads of other users.',
            ),
          ),
          box('Process_priv', 'PROCESS', N_('Allows viewing processes of all users.')),
          box(
            'Reload_priv',
            'RELOAD',
            N_("Allows reloading server settings and flushing the server's caches."),
          ),
          box('Shutdown_priv', 'SHUTDOWN', N_('Allows shutting down the server.')),
          box('Show_db_priv', 'SHOW DATABASES', N_('Gives access to the complete list of databases.')),
        ]
      : [box('Grant_priv', 'GRANT', GRANT_OTHER)]),
    box('Lock_tables_priv', 'LOCK TABLES', N_('Allows locking tables for the current thread.')),
    box(
      'References_priv',
      'REFERENCES',
      N_('Has no effect in this MySQL version.'),
      y('References_priv'),
      references,
    ),
    ...(g
      ? [
          box(
            'Repl_client_priv',
            'REPLICATION CLIENT',
            N_('Allows the user to ask where the replicas / primaries are.'),
          ),
          box('Repl_slave_priv', 'REPLICATION SLAVE', N_('Needed for the replication replicas.')),
          box('Create_user_priv', 'CREATE USER', N_('Allows creating, dropping and renaming user accounts.')),
        ]
      : []),
  ]
  const rendered = data.length + structure.length + administration.length
  return {
    ...base,
    variant: 'standard',
    header: g ? 'Global privileges' : d ? 'Database-specific privileges' : 'Table-specific privileges',
    submenuLabel: g ? 'Global' : d ? 'Database' : 'Table',
    groups: [
      { id: 'Data', label: 'Data', boxes: data },
      { id: 'Structure', label: 'Structure', boxes: structure },
      { id: 'Administration', label: 'Administration', boxes: administration },
    ],
    columns: [],
    tableBoxes: [],
    // `grant_count - (row['Grant_priv'] is defined ? 1 : 0)`: ALL PRIVILEGES never includes GRANT
    grantCount: rendered - (has('Grant_priv') ? 1 : 0),
    columnCount: 0,
    limits: g
      ? [
          {
            name: 'max_questions',
            label: 'MAX QUERIES PER HOUR',
            title: 'Limits the number of queries the user may send to the server per hour.',
            value: row.max_questions ?? '0',
          },
          {
            name: 'max_updates',
            label: 'MAX UPDATES PER HOUR',
            title:
              'Limits the number of commands that change any table or database the user may execute per hour.',
            value: row.max_updates ?? '0',
          },
          {
            name: 'max_connections',
            label: 'MAX CONNECTIONS PER HOUR',
            title: 'Limits the number of new connections the user may open per hour.',
            value: row.max_connections ?? '0',
          },
          {
            name: 'max_user_connections',
            label: 'MAX USER_CONNECTIONS',
            title: 'Limits the number of simultaneous connections the user may have.',
            value: row.max_user_connections ?? '0',
          },
        ]
      : null,
    ssl: g
      ? {
          type: row.ssl_type ?? '',
          cipher: row.ssl_cipher ?? '',
          issuer: row.x509_issuer ?? '',
          subject: row.x509_subject ?? '',
        }
      : null,
  }
}

/** The routine level (edit_routine_privileges.twig): GRANT, ALTER ROUTINE, EXECUTE. */
export function routinePrivilegesModel(privileges: Record<string, string>): PrivGroup {
  const y = (k: string) => privileges[k] === 'Y'
  return {
    id: 'Routine',
    label: 'Routine',
    boxes: [
      {
        name: 'Grant_priv',
        id: 'checkbox_Grant_priv',
        label: 'GRANT',
        title: N_(
          'Allows user to give to other users or remove from other users privileges that user possess on this routine.',
        ),
        checked: y('Grant_priv'),
      },
      {
        name: 'Alter_routine_priv',
        id: 'checkbox_Alter_routine_priv',
        label: 'ALTER ROUTINE',
        title: N_('Allows altering and dropping this routine.'),
        checked: y('Alter_routine_priv'),
      },
      {
        name: 'Execute_priv',
        id: 'checkbox_Execute_priv',
        label: 'EXECUTE',
        title: N_('Allows executing this routine.'),
        checked: y('Execute_priv'),
      },
    ],
  }
}

export interface CheckState {
  checked: boolean
  indeterminate: boolean
}

/**
 * A check-all box after a change of its boxes: checked as soon as one box is (indeterminate while
 * not all are), unchecked when none is.
 * pma: resources/js/modules/functions.ts::checkboxesChanged / subCheckboxesChanged
 */
export function checkAllState(checked: boolean[]): CheckState {
  const n = checked.filter(Boolean).length
  return { checked: n > 0, indeterminate: n > 0 && n < checked.length }
}

/**
 * The check-all boxes of the privileges table, which phpMyAdmin's handlers update unevenly: a
 * privilege box recomputes the overall `.checkall_box` only (the `.sub_checkall_box` lookup of
 * subCheckboxesChanged goes from the box's parent's parent, the card body, and never reaches the
 * header); the overall box sets every privilege and every group box; a group box sets its
 * privileges and itself. Group boxes start unchecked.
 */
export interface CheckAllModel {
  boxes: Record<string, boolean>
  overall: CheckState
  groups: Record<string, CheckState>
}

export function initCheckAll(
  groups: Array<{ id: string; boxes: Array<{ name: string; checked: boolean }> }>,
): CheckAllModel {
  const boxes = Object.fromEntries(
    groups.flatMap((g) => g.boxes.map((b) => [`${g.id}:${b.name}`, b.checked])),
  )
  return {
    boxes,
    overall: checkAllState(Object.values(boxes)),
    groups: Object.fromEntries(groups.map((g) => [g.id, { checked: false, indeterminate: false }])),
  }
}

export function toggleBox(m: CheckAllModel, key: string, v: boolean): CheckAllModel {
  const boxes = { ...m.boxes, [key]: v }
  return { ...m, boxes, overall: checkAllState(Object.values(boxes)) }
}

export function toggleOverall(m: CheckAllModel, v: boolean): CheckAllModel {
  const boxes = Object.fromEntries(Object.keys(m.boxes).map((k) => [k, v]))
  const all = { checked: v, indeterminate: false }
  return { boxes, overall: all, groups: Object.fromEntries(Object.keys(m.groups).map((g) => [g, all])) }
}

export function toggleGroup(m: CheckAllModel, group: string, v: boolean): CheckAllModel {
  const boxes = Object.fromEntries(
    Object.entries(m.boxes).map(([k, old]) => [k, k.startsWith(`${group}:`) ? v : old]),
  )
  return { ...m, boxes, groups: { ...m.groups, [group]: { checked: v, indeterminate: false } } }
}

/** onloadChangePasswordEvents `#select_pred_hostname`: the host the preset writes into the text field. */
export function hostnameForPreset(preset: string, current: string, thisHost: string | null): string {
  if (preset === 'any') return '%'
  if (preset === 'localhost') return 'localhost'
  if (preset === 'thishost' && thisHost !== null && thisHost !== '') return thisHost
  if (preset === 'hosttable') return ''
  return current
}

/** `data-thishost` of `#select_pred_hostname` (login_information_fields.twig) */
export function thisHostData(thisHost: string | null): string | null {
  return thisHost !== null && thisHost !== 'localhost' && thisHost !== '127.0.0.1' ? thisHost : null
}

/**
 * CheckAddUser + checkPassword: the alert msgid that stops the submit, or null.
 * pma: resources/js/server/privileges.ts::CheckAddUser, modules/functions.ts::checkPassword
 */
export function checkAddUser(f: {
  hostname?: string
  predUsername?: string
  username?: string
  predPassword?: string
  password: string
  password2: string
}): string | null {
  if (f.hostname !== undefined && f.hostname === '') return N_('The host name is empty!')
  if (f.predUsername === 'userdefined' && f.username === '') return N_('The user name is empty!')
  if (f.predPassword === 'none' || f.predPassword === 'keep') return null
  if (f.password === '') return N_('The password is empty!')
  if (f.password !== f.password2) return N_("The passwords aren't the same!")
  return null
}

/** The `selected_usr[]` value of an account (`user&amp;#27;host`, the literal separator). */
export const selectedUserValue = (user: string, host: string) => `${user}&amp;#27;${host}`

/** getUserLink 'edit' parameters → the SPA search of the user editor */
export function editSearch(
  username: string,
  hostname: string,
  p: { dbname?: string; tablename?: string; routinename?: string } = {},
) {
  return {
    username,
    hostname,
    ...(p.dbname !== undefined && p.dbname !== '' ? { dbname: p.dbname } : {}),
    ...(p.tablename !== undefined && p.tablename !== '' ? { tablename: p.tablename } : {}),
    ...(p.routinename !== undefined && p.routinename !== '' ? { routinename: p.routinename } : {}),
  }
}

/** `database|replace({'\\_': '_', '\\%': '%'})` */
export const unescapeWildcards = (db: string) => db.replace(/\\([_%])/g, '$1')
