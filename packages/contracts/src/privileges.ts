import { z } from 'zod'
import { SqlCard } from './query.ts'

/**
 * Server → User accounts (/server/privileges, /server/user-groups, /table/privileges): the models
 * phpMyAdmin's Privileges class hands to its templates. Write requests carry phpMyAdmin's form
 * fields unchanged (`pred_username`, `Select_priv`, `Select_priv[]` as an array, `createdb-1`, …)
 * because the statements are built from exactly those fields.
 * docs/features/06-server-level.md#user-accounts--overview-serverprivileges-without-username
 */

/** A posted phpMyAdmin form: `name[]` fields as arrays, unchecked boxes absent. */
export const PrivForm = z.record(z.string(), z.union([z.string(), z.array(z.string())]))
export type PrivForm = z.infer<typeof PrivForm>

/** A translated message; `html` when it carries markup (Message's `[em]` BB code, links). */
export const PrivMessage = z.object({
  type: z.enum(['success', 'notice', 'error']),
  text: z.string(),
  html: z.boolean().optional(),
})
export type PrivMessage = z.infer<typeof PrivMessage>

/** One `<dfn title>` entry of extractPrivInfo (title translated). */
export const PrivItem = z.object({ name: z.string(), title: z.string(), columns: z.string().nullable() })
export type PrivItem = z.infer<typeof PrivItem>

/** The access gate of every privileges page (PrivilegesController). */
export const PrivGate = z.object({
  /** `No Privileges` (not superuser, grant user or create user) */
  noPrivileges: z.boolean(),
  /** "You do not have the privileges to administrate the users!" */
  notice: z.string().nullable(),
  isSuperUser: z.boolean(),
  isGrantUser: z.boolean(),
  isCreateUser: z.boolean(),
  /** subnav.twig: rendered when the configurable-menus feature works */
  menusWork: z.boolean(),
})
export type PrivGate = z.infer<typeof PrivGate>

// ------------------------------------------------------------------ overview

export const UsersOverviewQuery = z.object({
  initial: z.string().optional(),
  showall: z.string().optional(),
})
export type UsersOverviewQuery = z.infer<typeof UsersOverviewQuery>

export const UserOverviewRow = z.object({
  user: z.string(),
  host: z.string(),
  hasPassword: z.boolean(),
  /** false: "The selected user was not found in the privilege table." hint */
  hasSelectPriv: z.boolean(),
  privileges: z.array(PrivItem),
  group: z.string(),
  hasGrant: z.boolean(),
  isAccountLocked: z.boolean(),
})
export type UserOverviewRow = z.infer<typeof UserOverviewRow>

export const UsersOverviewResponse = z.object({
  gate: PrivGate,
  /** "Not enough privilege to view users." / the old-structure raw error */
  error: PrivMessage.nullable(),
  /** the ''@'localhost' notice (with the problems-connecting doc link) */
  emptyUserNotice: z.boolean(),
  /** initials_row.twig: null when ≤ 20 users */
  initials: z.array(z.object({ initial: z.string(), available: z.boolean() })).nullable(),
  /** `?initial=` as given (null when absent) */
  selectedInitial: z.string().nullable(),
  /** users_overview.twig rendered (initial / showall / fewer than 50 users) */
  users: z.array(UserOverviewRow).nullable(),
  userGroupCount: z.number(),
  hasAccountLocking: z.boolean(),
  /** flush note variant: RELOAD privilege (link to reload) or not; null when not rendered */
  flushNote: z.enum(['reload', 'noReload']).nullable(),
  docs: z.object({ problemsConnecting: z.string(), privReload: z.string() }),
})
export type UsersOverviewResponse = z.infer<typeof UsersOverviewResponse>

// ------------------------------------------------------------------ forms

/** login_information_fields.twig */
export const LoginInformation = z.object({
  predefinedUsername: z.enum(['any', 'userdefined']),
  predefinedHostname: z.enum(['any', 'localhost', 'userdefined']),
  usernameLength: z.string(),
  hostnameLength: z.string(),
  username: z.string().nullable(),
  hostname: z.string().nullable(),
  /** host part of USER() ('' when unknown) */
  thisHost: z.string().nullable(),
  isChange: z.boolean(),
  authPlugin: z.string().nullable(),
  authPlugins: z.array(z.object({ name: z.string(), description: z.string() })),
  isNew: z.boolean(),
})
export type LoginInformation = z.infer<typeof LoginInformation>

/** privileges_table.twig: the stored row (or the new-user defaults) and the column privileges. */
export const PrivilegesTable = z.object({
  isGlobal: z.boolean(),
  isDatabase: z.boolean(),
  row: z.record(z.string(), z.string().nullable()),
  /** table level: every column with its column privileges */
  columns: z
    .array(
      z.object({
        name: z.string(),
        Select: z.boolean(),
        Insert: z.boolean(),
        Update: z.boolean(),
        References: z.boolean(),
      }),
    )
    .nullable(),
  hasSubmit: z.boolean(),
  supportsReferencesPrivilege: z.boolean(),
  isMariaDb: z.boolean(),
})
export type PrivilegesTable = z.infer<typeof PrivilegesTable>

/** change_password.twig inside the user editor */
export const ChangePasswordFields = z.object({
  username: z.string(),
  hostname: z.string(),
  isNew: z.boolean(),
  hasMoreAuthPlugins: z.boolean(),
  authPlugins: z.array(z.object({ name: z.string(), description: z.string() })),
  origAuthPlugin: z.string(),
  allowNoPassword: z.boolean(),
})
export type ChangePasswordFields = z.infer<typeof ChangePasswordFields>

export const AddUserQuery = z.object({ dbname: z.string().optional(), tablename: z.string().optional() })
export type AddUserQuery = z.infer<typeof AddUserQuery>

/** add_user.twig */
export const AddUserForm = z.object({
  gate: PrivGate,
  /** the db context (wildcard-escaped), '' when none */
  database: z.string(),
  login: LoginInformation,
  isGrantUser: z.boolean(),
  privilegesTable: PrivilegesTable.nullable(),
})
export type AddUserForm = z.infer<typeof AddUserForm>

/** One row of privileges_summary.twig. Links are the editor parameters (`revoke` posts revokeall). */
export const SpecificRight = z.object({
  name: z.string(),
  grant: z.boolean(),
  /** database level: table-specific privileges exist; table level: column-specific */
  sub: z.boolean(),
  privileges: z.array(PrivItem),
  edit: z.object({ dbname: z.string(), tablename: z.string(), routinename: z.string() }).nullable(),
  revoke: z.object({ dbname: z.string(), tablename: z.string(), routinename: z.string() }).nullable(),
})
export type SpecificRight = z.infer<typeof SpecificRight>

export const SpecificRights = z.object({
  type: z.enum(['database', 'table', 'routine']),
  rows: z.array(SpecificRight),
  database: z.string(),
  escapedDatabase: z.string(),
  /** database level: the databases not yet listed (display name, escaped value) */
  databases: z.array(z.object({ name: z.string(), value: z.string() })),
  tables: z.array(z.string()),
  routines: z.array(z.string()),
})
export type SpecificRights = z.infer<typeof SpecificRights>

export const UserPropertiesQuery = z.object({
  username: z.string(),
  hostname: z.string().default(''),
  /** one database, or several from the "Add privileges on the following database(s)" list */
  dbname: z.union([z.string(), z.array(z.string())]).optional(),
  tablename: z.string().optional(),
  routinename: z.string().optional(),
  pred_dbname: z.array(z.string()).optional(),
  pred_tablename: z.string().optional(),
  pred_routinename: z.string().optional(),
})
export type UserPropertiesQuery = z.infer<typeof UserPropertiesQuery>

/** user_properties.twig (or edit_routine_privileges.twig when `routine` is set) */
export const UserProperties = z.object({
  gate: PrivGate,
  username: z.string(),
  hostname: z.string(),
  /** the resolved database(s) ('' = global level) */
  database: z.union([z.string(), z.array(z.string())]),
  /** wildcard-escaped database for links */
  dbname: z.string(),
  table: z.string(),
  isDatabases: z.boolean(),
  isWildcard: z.boolean(),
  userDoesNotExist: z.boolean(),
  isCurrentUser: z.boolean(),
  /** login fields shown so a missing user can be created */
  login: LoginInformation.nullable(),
  privilegesTable: PrivilegesTable.nullable(),
  rights: z.array(SpecificRights),
  changePassword: ChangePasswordFields.nullable(),
  changeLogin: LoginInformation.nullable(),
  userGroup: z.string().nullable(),
  databaseTab: z.object({ path: z.string(), title: z.string() }),
  tableTab: z.object({ path: z.string(), title: z.string() }),
  /** routine level */
  routine: z.object({ name: z.string(), privileges: z.record(z.string(), z.string()) }).nullable(),
})
export type UserProperties = z.infer<typeof UserProperties>

// ------------------------------------------------------------------ actions

/** The answer of every privileges action (the AJAX JSON of PrivilegesController). */
export const PrivActionResponse = z.object({
  success: z.boolean(),
  message: PrivMessage,
  /** the SQL shown under the message (Generator::getMessage) */
  sql: z.string(),
  /** Generator::getMessage's query card for `sql` (null: no SQL shown) */
  card: SqlCard.nullable(),
  /** add user / copy user: the account to open next */
  account: z.object({ username: z.string(), hostname: z.string() }).nullable(),
  /** add user failed: the form is shown again */
  addUserError: z.boolean(),
  /** databases were created or dropped (navigation reload) */
  reload: z.boolean(),
})
export type PrivActionResponse = z.infer<typeof PrivActionResponse>

export const ValidateUsernameResponse = z.object({ userExists: z.boolean() })
export type ValidateUsernameResponse = z.infer<typeof ValidateUsernameResponse>

export const ExportPrivilegesRequest = z.object({
  username: z.string().optional(),
  hostname: z.string().optional(),
  /** `user&amp;#27;host` entries of the overview */
  selected_usr: z.array(z.string()).optional(),
})
export type ExportPrivilegesRequest = z.infer<typeof ExportPrivilegesRequest>

export const ExportPrivilegesResponse = z.object({ title: z.string(), grants: z.string() })
export type ExportPrivilegesResponse = z.infer<typeof ExportPrivilegesResponse>

export const AccountLockRequest = z.object({ username: z.string(), hostname: z.string() })
export type AccountLockRequest = z.infer<typeof AccountLockRequest>

// ------------------------------------------------------------------ user groups

export const UserGroupTabs = z.array(z.object({ tab: z.string(), name: z.string(), allowed: z.boolean() }))

export const UserGroupsResponse = z.object({
  gate: z.object({ enabled: z.boolean(), isSuperUser: z.boolean() }),
  groups: z.array(
    z.object({ name: z.string(), serverTabs: z.string(), dbTabs: z.string(), tableTabs: z.string() }),
  ),
})
export type UserGroupsResponse = z.infer<typeof UserGroupsResponse>

export const UserGroupUsersResponse = z.object({ userGroup: z.string(), users: z.array(z.string()) })
export type UserGroupUsersResponse = z.infer<typeof UserGroupUsersResponse>

/** edit_user_groups.twig: the tab checkboxes of each level */
export const UserGroupForm = z.object({
  userGroup: z.string().nullable(),
  levels: z.array(
    z.object({ level: z.enum(['server', 'db', 'table']), title: z.string(), tabs: UserGroupTabs }),
  ),
})
export type UserGroupForm = z.infer<typeof UserGroupForm>

/** choose_user_group.twig (/server/user-groups/edit-form) */
export const ChooseUserGroupResponse = z.object({
  username: z.string(),
  userGroup: z.string().nullable(),
  userGroups: z.array(z.string()),
})
export type ChooseUserGroupResponse = z.infer<typeof ChooseUserGroupResponse>

// ------------------------------------------------------------------ table → privileges

/** getAllPrivileges: one account with its global / database / table / routine privileges */
export const AccountPrivileges = z.object({
  user: z.string(),
  host: z.string(),
  privileges: z.array(
    z.object({
      type: z.enum(['g', 'd', 't', 'r']),
      database: z.string(),
      table: z.string().nullable(),
      routine: z.string().nullable(),
      hasGrant: z.boolean(),
      privileges: z.array(PrivItem),
    }),
  ),
})
export type AccountPrivileges = z.infer<typeof AccountPrivileges>

/**
 * Database → Privileges and Table → Privileges (with `table`): the users of a database or a table.
 * `db` and `table` are lower-cased under lower_case_table_names=1.
 * pma: templates/database/privileges/index.twig, templates/table/privileges/index.twig
 */
export const DbPrivilegesResponse = z.object({
  gate: PrivGate,
  db: z.string(),
  table: z.string().optional(),
  accounts: z.array(AccountPrivileges),
})
export type DbPrivilegesResponse = z.infer<typeof DbPrivilegesResponse>
