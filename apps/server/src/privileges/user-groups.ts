import type {
  ChooseUserGroupResponse,
  PrivForm,
  UserGroupForm,
  UserGroupUsersResponse,
  UserGroupsResponse,
} from '@bettermyadmin/contracts'
import {
  MENU_TAB_LIST,
  USER_GROUP_LEVELS,
  allowedTabNames,
  deleteUserGroup,
  editUserGroup,
  chooseUserGroup as storedChoice,
  userGroupAllowedTabs,
  userGroupsTable,
  usersOfUserGroup,
} from '@bettermyadmin/metadata'
import { ForbiddenError, ValidationError } from '../http/errors.ts'
import type { Privileges } from './privileges.ts'

/**
 * Server → User accounts → User groups (configurable menus), every statement on the control link.
 * pma: src/Controllers/Server/UserGroupsController.php, UserGroupsFormController.php,
 *      src/ConfigStorage/UserGroups.php
 */

const str = (v: string | readonly string[] | undefined): string => (typeof v === 'string' ? v : '')

function feature(p: Privileges) {
  const menus = p.menus
  if (menus === null || p.storage === null) return null
  return { conn: p.storage.conn, menus }
}

/** The groups table (UserGroups::getHtmlForUserGroupsTable) */
async function groups(p: Privileges): Promise<UserGroupsResponse['groups']> {
  const f = feature(p)
  if (f === null) return []
  const t = (s: string) => p.ctx.tr.gettext(s)
  return (await userGroupsTable(f.conn, f.menus)).map((g) => ({
    name: g.name,
    serverTabs: allowedTabNames(g.tabs, 'server', t),
    dbTabs: allowedTabNames(g.tabs, 'db', t),
    tableTabs: allowedTabNames(g.tabs, 'table', t),
  }))
}

/**
 * UserGroupsController: without the feature an empty answer, superuser only; the POSTed actions
 * (deleteUserGroup, addUserGroupSubmit, editUserGroupSubmit) run before the table is read.
 */
export async function userGroupsPage(p: Privileges, post: PrivForm = {}): Promise<UserGroupsResponse> {
  const f = feature(p)
  if (f === null) return { gate: { enabled: false, isSuperUser: false }, groups: [] }
  const superUser = await p.isSuperUser()
  if (!superUser) return { gate: { enabled: true, isSuperUser: false }, groups: [] }
  const userGroup = typeof post.userGroup === 'string' ? post.userGroup : null
  if (post.deleteUserGroup !== undefined && userGroup !== null && userGroup !== '') {
    await deleteUserGroup(f.conn, f.menus, userGroup)
  }
  if (post.addUserGroupSubmit !== undefined) {
    await editUserGroup(f.conn, f.menus, str(post.userGroup), true, (tab) => post[tab] === 'Y')
  }
  if (post.editUserGroupSubmit !== undefined) {
    await editUserGroup(f.conn, f.menus, str(post.userGroup), false, (tab) => post[tab] === 'Y')
  }
  return { gate: { enabled: true, isSuperUser: true }, groups: await groups(p) }
}

async function requireSuperUser(p: Privileges) {
  const f = feature(p)
  if (f === null) throw new ValidationError(p.ctx.tr.gettext('User groups management is not enabled.'))
  if (!(await p.isSuperUser())) throw new ForbiddenError(p.ctx.tr.gettext('No Privileges'))
  return f
}

/** `viewUsers=1&userGroup=` (UserGroups::getHtmlForListingUsersofAGroup) */
export async function userGroupUsers(p: Privileges, userGroup: string): Promise<UserGroupUsersResponse> {
  const f = await requireSuperUser(p)
  return { userGroup, users: await usersOfUserGroup(f.conn, f.menus, userGroup) }
}

/** `?addUserGroup=1` / `editUserGroup=1&userGroup=` (UserGroups::getHtmlToEditUserGroup) */
export async function userGroupForm(p: Privileges, userGroup: string | null): Promise<UserGroupForm> {
  const f = await requireSuperUser(p)
  const t = (s: string) => p.ctx.tr.gettext(s)
  const allowed =
    userGroup !== null
      ? await userGroupAllowedTabs(f.conn, f.menus, userGroup)
      : { server: [], db: [], table: [] }
  const titles = {
    server: 'Server-level tabs',
    db: 'Database-level tabs',
    table: 'Table-level tabs',
  } as const
  return {
    userGroup,
    levels: USER_GROUP_LEVELS.map((level) => ({
      level,
      title: t(titles[level]),
      tabs: MENU_TAB_LIST[level].map(([tab, name]) => ({
        tab,
        name: t(name),
        allowed: allowed[level].includes(tab),
      })),
    })),
  }
}

/** UserGroupsFormController (`/server/user-groups/edit-form?username=`) */
export async function userGroupChoice(p: Privileges, username: string): Promise<ChooseUserGroupResponse> {
  if (username === '') throw new ValidationError(`${p.ctx.tr.gettext('Missing parameter:')} username`)
  const f = feature(p)
  if (f === null) throw new ValidationError(p.ctx.tr.gettext('User groups management is not enabled.'))
  const r = await storedChoice(f.conn, f.menus, username)
  return { username, userGroup: r.userGroup, userGroups: r.userGroups }
}
