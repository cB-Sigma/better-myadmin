import { AccountLockRequest, ExportPrivilegesRequest, PrivForm } from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import { parse, parseJson } from '../http/validate.ts'
import { recordHistory } from '../metadata/hooks.ts'
import {
  accountLock,
  addUserForm,
  dbPrivileges,
  exportPrivileges,
  privilegesAction,
  userProperties,
  usersOverview,
  validateUsername,
  withPrivileges,
} from '../privileges/service.ts'
import { userGroupChoice, userGroupForm, userGroupUsers, userGroupsPage } from '../privileges/user-groups.ts'
import type { ServerEnv } from './server.ts'

/**
 * Server → User accounts and User groups, Table → Privileges (docs/features/06-server-level.md).
 * Requests carry phpMyAdmin's field names: the query string is `$_GET`, a POST body `$_POST`
 * (`name[]` fields as arrays).
 */
export const privilegesRoutes = new Hono<ServerEnv>()

/** The query string as PHP's `$_GET`: `a[]=x&a[]=y` → `{ a: ['x', 'y'] }`, else the last value. */
// biome-ignore lint/suspicious/noExplicitAny: any route path/input
function getForm(c: Context<ServerEnv, any, any>): PrivForm {
  const out: Record<string, string | string[]> = {}
  for (const [k, vs] of Object.entries(c.req.queries())) {
    if (k.endsWith('[]')) out[k.slice(0, -2)] = vs
    else out[k] = vs[vs.length - 1] ?? ''
  }
  return parse(PrivForm, out)
}

/** pma: /server/privileges (overview) */
privilegesRoutes.get('/privileges/users', async (c) =>
  c.json(await withPrivileges(c, {}, getForm(c), usersOverview)),
)

/** pma: /server/privileges?adduser=1 */
privilegesRoutes.get('/privileges/add-user', async (c) =>
  c.json(await withPrivileges(c, {}, getForm(c), addUserForm)),
)

/** pma: /server/privileges?username=&hostname=[&dbname=[&tablename=|&routinename=]] */
privilegesRoutes.get('/privileges/user', async (c) =>
  c.json(await withPrivileges(c, {}, getForm(c), userProperties)),
)

/** pma: /server/privileges?validate_username=1&username= */
privilegesRoutes.get('/privileges/validate-username', async (c) => {
  const get = { ...getForm(c), validate_username: '1' }
  return c.json(await withPrivileges(c, {}, get, validateUsername))
})

/** pma: /server/privileges (POST: add user, update/revoke privileges, password, copy, delete, user group; ?flush_privileges=1) */
privilegesRoutes.post('/privileges', async (c) => {
  const post = await parseJson(c, PrivForm, {})
  const r = await withPrivileges(c, post, getForm(c), privilegesAction)
  await recordHistory(c, { db: '', table: '', sqlQuery: r.sql })
  return c.json(r)
})

/** pma: /server/privileges?export=1 (one account) / submit_mult=export (selected accounts) */
privilegesRoutes.post('/privileges/export', async (c) => {
  const req = await parseJson(c, ExportPrivilegesRequest, {})
  const post: PrivForm = {
    ...(req.username !== undefined ? { username: req.username } : {}),
    ...(req.hostname !== undefined ? { hostname: req.hostname } : {}),
  }
  return c.json(await withPrivileges(c, post, {}, (p) => exportPrivileges(p, req.selected_usr ?? null)))
})

/** pma: /server/privileges/account-lock */
privilegesRoutes.post('/privileges/account-lock', async (c) => {
  const req = await parseJson(c, AccountLockRequest)
  const message = await withPrivileges(c, {}, {}, (p) => accountLock(p, req.username, req.hostname, true))
  return c.json({ message }, message.type === 'error' ? 400 : 200)
})

/** pma: /server/privileges/account-unlock */
privilegesRoutes.post('/privileges/account-unlock', async (c) => {
  const req = await parseJson(c, AccountLockRequest)
  const message = await withPrivileges(c, {}, {}, (p) => accountLock(p, req.username, req.hostname, false))
  return c.json({ message }, message.type === 'error' ? 400 : 200)
})

/** pma: /server/user-groups */
privilegesRoutes.get('/user-groups', async (c) =>
  c.json(await withPrivileges(c, {}, {}, (p) => userGroupsPage(p))),
)

/** pma: /server/user-groups (POST deleteUserGroup / addUserGroupSubmit / editUserGroupSubmit) */
privilegesRoutes.post('/user-groups', async (c) => {
  const post = await parseJson(c, PrivForm, {})
  return c.json(await withPrivileges(c, post, {}, (p) => userGroupsPage(p, post)))
})

/** pma: /server/user-groups (viewUsers=1&userGroup=) */
privilegesRoutes.get('/user-groups/users', async (c) => {
  const userGroup = c.req.query('userGroup') ?? ''
  return c.json(await withPrivileges(c, {}, {}, (p) => userGroupUsers(p, userGroup)))
})

/** pma: /server/user-groups?addUserGroup=1 and editUserGroup=1&userGroup= */
privilegesRoutes.get('/user-groups/form', async (c) => {
  const userGroup = c.req.query('userGroup') ?? null
  return c.json(await withPrivileges(c, {}, {}, (p) => userGroupForm(p, userGroup)))
})

/** pma: /server/user-groups/edit-form */
privilegesRoutes.get('/user-groups/edit-form', async (c) => {
  const username = c.req.query('username') ?? ''
  return c.json(await withPrivileges(c, {}, {}, (p) => userGroupChoice(p, username)))
})

/** pma: /database/privileges */
privilegesRoutes.get('/databases/:db/privileges', async (c) => {
  const db = c.req.param('db')
  return c.json(await withPrivileges(c, {}, {}, (p) => dbPrivileges(p, db)))
})

/** pma: /table/privileges */
privilegesRoutes.get('/databases/:db/tables/:table/privileges', async (c) => {
  const { db, table } = c.req.param()
  return c.json(await withPrivileges(c, {}, {}, (p) => dbPrivileges(p, db, table)))
})
