import type {
  AddUserForm,
  DbPrivilegesResponse,
  ExportPrivilegesResponse,
  PrivActionResponse,
  UserGroupsResponse,
  UserProperties,
  UsersOverviewResponse,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'

/**
 * Server → User accounts against a real server (MySQL 8.x or MariaDB, the CI matrix): the effects
 * of every action are checked with SHOW GRANTS / mysql.user, so the test holds on each flavour
 * (the statements themselves are compared with phpMyAdmin in tests/parity/privileges.parity.test.ts).
 */
let t: ReturnType<typeof testApp>
let limited: ReturnType<typeof testApp>
let root: mysql.Connection
const ACCOUNTS = [
  "'f06u_it_a'@'%'",
  "'f06u_it_b'@'%'",
  "'f06u_it_c'@'localhost'",
  "'f06u_it_cp'@'%'",
  "'f06u_it_lim'@'%'",
]
const DROP = `${ACCOUNTS.map((a) => `DROP USER IF EXISTS ${a};`).join(' ')} DROP DATABASE IF EXISTS f06u_it_db; DROP DATABASE IF EXISTS f06u_it_a;`

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`${DROP}
    CREATE DATABASE f06u_it_db; CREATE TABLE f06u_it_db.t (a INT, b INT);
    CREATE PROCEDURE f06u_it_db.p() SELECT 1;
    CREATE USER 'f06u_it_b'@'%' IDENTIFIED BY 'f06u_it_b';
    GRANT SELECT ON f06u_it_db.* TO 'f06u_it_b'@'%';
    GRANT INSERT (a) ON f06u_it_db.t TO 'f06u_it_b'@'%';
    CREATE USER 'f06u_it_lim'@'%' IDENTIFIED BY 'f06u_it_lim'; GRANT SELECT ON f06u_it_db.* TO 'f06u_it_lim'@'%';`)
  t = testApp()
  await t.login()
  limited = testApp()
  await limited.login('f06u_it_lim', 'f06u_it_lim')
})
afterAll(async () => {
  await t?.close()
  await limited?.close()
  await root.query(DROP)
  await root.end()
})

const get = async <T>(path: string, app = t) => {
  const r = await app.req('GET', `/api/servers/1${path}`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as T
}
const post = async (form: Record<string, string | string[]>, query = '') => {
  const r = await t.req('POST', `/api/servers/1/privileges${query}`, form)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as PrivActionResponse
}
const grants = async (account: string) => {
  const [rows] = (await root.query(`SHOW GRANTS FOR ${account}`)) as unknown as [
    Array<Record<string, string>>,
  ]
  return rows.map((r) => Object.values(r)[0] as string)
}
const exists = async (user: string, host: string) => {
  const [rows] = (await root.query('SELECT 1 FROM mysql.user WHERE User = ? AND Host = ?', [
    user,
    host,
  ])) as unknown as [unknown[]]
  return rows.length > 0
}

describe('user accounts', () => {
  it('the overview lists the accounts with their global privileges [p06-74795d]', async () => {
    const d = await get<UsersOverviewResponse>('/privileges/users?initial=F')
    expect(d.gate.noPrivileges).toBe(false)
    const b = d.users?.find((u) => u.user === 'f06u_it_b')
    expect(b).toMatchObject({ host: '%', hasPassword: true, hasGrant: false, hasSelectPriv: true })
    expect(b?.privileges.map((p) => p.name)).toEqual(['USAGE'])
  })

  it('an account without user administration privileges is turned away [p06-0e0e8b]', async () => {
    const d = await get<UsersOverviewResponse>('/privileges/users', limited)
    expect(d.gate.noPrivileges).toBe(true)
    expect(d.users).toBeNull()
  })

  it('adds an account with a database of the same name and global privileges [p06-dc46b3]', async () => {
    const form = await get<AddUserForm>('/privileges/add-user')
    expect(form.login.authPlugins.length).toBeGreaterThan(0)
    const plugin = form.login.authPlugins.some((p) => p.name === form.login.authPlugin)
      ? (form.login.authPlugin as string)
      : (form.login.authPlugins[0]?.name as string)
    const r = await post({
      pred_username: 'userdefined',
      username: 'f06u_it_a',
      pred_hostname: 'any',
      hostname: '%',
      pred_password: 'userdefined',
      pma_pw: 'Pw_it_a1',
      pma_pw2: 'Pw_it_a1',
      authentication_plugin: plugin,
      'createdb-1': 'on',
      Select_priv: 'Y',
      Process_priv: 'Y',
      // without grant_count every posted privilege counts as all of them (ALL PRIVILEGES)
      grant_count: '99',
      max_questions: '9',
      ssl_type: 'NONE',
      adduser_submit: '1',
    })
    expect(r.message.text).toBe('You have added a new user.')
    expect(r.account).toEqual({ username: 'f06u_it_a', hostname: '%' })
    const g = (await grants("'f06u_it_a'@'%'")).join('\n')
    expect(g).toMatch(/GRANT SELECT, PROCESS ON \*\.\* TO [`']f06u_it_a[`']@[`']%[`']/)
    expect(g).toMatch(/GRANT ALL PRIVILEGES ON [`']f06u\\_it\\_a[`']\.\*/)
    // the password works
    const c = await mysql.createConnection({ ...MYSQL, user: 'f06u_it_a', password: 'Pw_it_a1' })
    await c.end()
    const again = await post({
      pred_username: 'userdefined',
      username: 'f06u_it_a',
      pred_hostname: 'any',
      hostname: '%',
      pred_password: 'none',
      adduser_submit: '1',
    })
    expect(again.success).toBe(false)
    expect(again.addUserError).toBe(true)
  })

  it('the user editor: global table, database rights, password and login forms [p06-b6e1bb]', async () => {
    const d = await get<UserProperties>('/privileges/user?username=f06u_it_b&hostname=%25')
    expect(d.userDoesNotExist).toBe(false)
    expect(d.privilegesTable?.isGlobal).toBe(true)
    expect(d.rights.map((r) => r.type)).toEqual(['database'])
    // the column grant is listed under the escaped name, the database grant (given without escapes)
    // under its own: two rows, as in phpMyAdmin
    expect(d.rights[0]?.rows.map((r) => [r.name, r.sub])).toEqual([
      ['f06u\\_it\\_db', true],
      ['f06u_it_db', false],
    ])
    expect(d.changePassword?.username).toBe('f06u_it_b')
    expect(d.changeLogin?.isChange).toBe(true)
    const db = await get<UserProperties>(
      `/privileges/user?username=f06u_it_b&hostname=%25&dbname=${encodeURIComponent('f06u\\_it\\_db')}`,
    )
    expect(db.rights.map((r) => [r.type, r.rows.map((x) => x.name)])).toEqual([
      ['table', ['t']],
      ['routine', []],
    ])
    expect(db.rights[1]?.routines).toEqual(['p'])
    const tbl = await get<UserProperties>(
      `/privileges/user?username=f06u_it_b&hostname=%25&dbname=${encodeURIComponent('f06u\\_it\\_db')}&tablename=t`,
    )
    expect(tbl.privilegesTable?.columns?.map((c) => [c.name, c.Insert])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('updates privileges at global, database, table and routine level, then revokes [p06-de1797]', async () => {
    await post({
      username: 'f06u_it_b',
      hostname: '%',
      Select_priv: 'Y',
      Reload_priv: 'Y',
      grant_count: '27',
      update_privs: '1',
    })
    expect((await grants("'f06u_it_b'@'%'")).join('\n')).toMatch(/GRANT SELECT, RELOAD ON \*\.\*/)
    await post({
      username: 'f06u_it_b',
      hostname: '%',
      dbname: 'f06u\\_it\\_db',
      Insert_priv: 'Y',
      Grant_priv: 'Y',
      grant_count: '19',
      update_privs: '1',
    })
    // the grant option is kept on every server: on MySQL ≥ 8.0.11 phpMyAdmin drops it, exception X40
    expect((await grants("'f06u_it_b'@'%'")).join('\n')).toMatch(
      /GRANT INSERT ON [`']f06u\\_it\\_db[`']\.\* TO .* WITH GRANT OPTION/,
    )
    await post({
      username: 'f06u_it_b',
      hostname: '%',
      dbname: 'f06u\\_it\\_db',
      tablename: 't',
      column_count: '2',
      grant_count: '13',
      Select_priv: ['b'],
      Delete_priv: 'Y',
      update_privs: '1',
    })
    expect((await grants("'f06u_it_b'@'%'")).join('\n')).toMatch(
      /GRANT SELECT \(`?b`?\), DELETE ON [`']f06u_it_db[`']\.[`']t[`']/,
    )
    await post({ username: 'f06u_it_b', hostname: '%', dbname: 'f06uitroutine' })
    await post({ username: 'f06u_it_b', hostname: '%', dbname: 'f06u\\_it\\_db', revokeall: '1' })
    expect((await grants("'f06u_it_b'@'%'")).join('\n')).not.toMatch(/ON [`']f06u\\_it\\_db[`']\.\*/)
  })

  it('X40: Grant_priv keeps the grant option at global, table and routine level (phpmyadmin#19605)', async () => {
    const edit = (form: Record<string, string>) =>
      post({ username: 'f06u_it_b', hostname: '%', Grant_priv: 'Y', update_privs: '1', ...form })
    await edit({ Select_priv: 'Y', grant_count: '27', ssl_type: 'NONE' })
    const g = async () => (await grants("'f06u_it_b'@'%'")).join('\n')
    expect(await g()).toMatch(/GRANT SELECT ON \*\.\* TO .* WITH GRANT OPTION/)
    await edit({
      dbname: 'f06u\\_it\\_db',
      tablename: 't',
      column_count: '2',
      grant_count: '13',
      Delete_priv: 'Y',
    })
    expect(await g()).toMatch(/GRANT DELETE ON [`']f06u_it_db[`']\.[`']t[`'] TO .* WITH GRANT OPTION/)
    // (the routine type is looked up with the posted name: unescaped here, see the phpMyAdmin quirk)
    await edit({ dbname: 'f06u_it_db', routinename: 'p', grant_count: '3', Execute_priv: 'Y' })
    expect(await g()).toMatch(
      /GRANT EXECUTE ON PROCEDURE [`']f06u_it_db[`']\.[`']p[`'] TO .* WITH GRANT OPTION/,
    )
    // back to the state of the next tests: no global grant option (on MySQL 8.4 the global REVOKE ALL
    // of this edit also drops the routine grant; elsewhere it is revoked explicitly)
    await post({
      username: 'f06u_it_b',
      hostname: '%',
      Select_priv: 'Y',
      grant_count: '27',
      update_privs: '1',
    })
    if ((await g()).includes('f06u_it_db`.`p`') || (await g()).includes("f06u_it_db'.'p'")) {
      await root.query("REVOKE EXECUTE, GRANT OPTION ON PROCEDURE f06u_it_db.p FROM 'f06u_it_b'@'%'")
    }
  })

  it('changes the password of another account [p06-d38b0c]', async () => {
    const d = await get<UserProperties>('/privileges/user?username=f06u_it_b&hostname=%25')
    const r = await post({
      username: 'f06u_it_b',
      hostname: '%',
      nopass: '0',
      pma_pw: 'New_pw_b1',
      pma_pw2: 'New_pw_b1',
      authentication_plugin: d.changePassword?.origAuthPlugin ?? '',
      change_pw: '1',
    })
    expect(r.message.text).toBe("The password for 'f06u_it_b'@'%' was changed successfully.")
    const c = await mysql.createConnection({ ...MYSQL, user: 'f06u_it_b', password: 'New_pw_b1' })
    await c.end()
    const bad = await post({
      username: 'f06u_it_b',
      hostname: '%',
      pma_pw: 'x',
      pma_pw2: 'y',
      change_pw: '1',
    })
    expect(bad.message).toEqual({ type: 'error', text: "The passwords aren't the same!" })
  })

  it('copies an account (mode 4), then renames it (mode 1) [p06-128720]', async () => {
    await root.query("GRANT SELECT ON f06u_it_db.* TO 'f06u_it_b'@'%'")
    const copy = await post({
      old_username: 'f06u_it_b',
      old_hostname: '%',
      pred_username: 'userdefined',
      username: 'f06u_it_cp',
      pred_hostname: 'any',
      hostname: '%',
      pred_password: 'none',
      mode: '4',
      change_copy: '1',
    })
    expect(copy.success).toBe(true)
    expect(await exists('f06u_it_b', '%')).toBe(true)
    expect((await grants("'f06u_it_cp'@'%'")).join('\n')).toMatch(
      /GRANT SELECT ON [`']f06u(\\)?_it(\\)?_db[`']\.\*/,
    )
    const same = await post({
      old_username: 'f06u_it_cp',
      old_hostname: '%',
      username: 'f06u_it_cp',
      hostname: '%',
      change_copy: '1',
    })
    expect(same.success).toBe(false)
    const move = await post({
      old_username: 'f06u_it_cp',
      old_hostname: '%',
      pred_username: 'userdefined',
      username: 'f06u_it_c',
      pred_hostname: 'localhost',
      hostname: 'localhost',
      pred_password: 'none',
      mode: '1',
      change_copy: '1',
    })
    expect(move.success).toBe(true)
    expect(await exists('f06u_it_cp', '%')).toBe(false)
    expect(await exists('f06u_it_c', 'localhost')).toBe(true)
  })

  it('exports the grants of one account and of a selection [p06-180eb0]', async () => {
    const one = (
      await t.req('POST', '/api/servers/1/privileges/export', { username: 'f06u_it_b', hostname: '%' })
    ).json as unknown as ExportPrivilegesResponse
    expect(one.title).toBe('User `f06u_it_b`@`%`')
    expect(one.grants).toMatch(/^GRANT .* ON \*\.\* TO /)
    const many = (
      await t.req('POST', '/api/servers/1/privileges/export', {
        selected_usr: ['f06u_it_b&amp;#27;%', 'f06u_it_c&amp;#27;localhost'],
      })
    ).json as unknown as ExportPrivilegesResponse
    expect(many.title).toBe('Privileges')
    expect(many.grants).toContain('# Privileges for `f06u_it_c`@`localhost`')
  })

  it('locks and unlocks an account [p06-306802]', async () => {
    const lock = await t.req('POST', '/api/servers/1/privileges/account-lock', {
      username: 'f06u_it_b',
      hostname: '%',
    })
    expect(lock.status).toBe(200)
    const d = await get<UsersOverviewResponse>('/privileges/users?initial=F')
    expect(d.users?.find((u) => u.user === 'f06u_it_b')?.isAccountLocked).toBe(true)
    const unlock = await t.req('POST', '/api/servers/1/privileges/account-unlock', {
      username: 'f06u_it_b',
      hostname: '%',
    })
    expect((unlock.json as { message: { text: string } }).message.text).toBe(
      'The account f06u_it_b@% has been successfully unlocked.',
    )
  })

  it('reloads the privileges and checks a user name', async () => {
    const r = await post({}, '?flush_privileges=1')
    expect(r.message.text).toBe('The privileges were reloaded successfully.')
    const v = await get<{ userExists: boolean }>('/privileges/validate-username?username=f06u_it_b')
    expect(v.userExists).toBe(true)
  })

  it('Table → Privileges lists the accounts with access to the table', async () => {
    // (on MySQL 8.4 the global REVOKE ALL above also dropped the table and column grants)
    await root.query("GRANT UPDATE (b) ON f06u_it_db.t TO 'f06u_it_b'@'%'")
    const d = await get<DbPrivilegesResponse>('/databases/f06u_it_db/tables/t/privileges')
    const b = d.accounts.find((a) => a.user === 'f06u_it_b')
    expect(b?.privileges.map((p) => p.type)).toContain('t')
  })

  it('removes the selected accounts and their databases [p06-140d4c]', async () => {
    const r = await post({
      selected_usr: ['f06u_it_a&amp;#27;%', 'f06u_it_c&amp;#27;localhost'],
      drop_users_db: 'on',
      mode: '2',
      delete: 'Go',
    })
    expect(r.message.text).toBe('The selected users have been deleted successfully.')
    expect(r.reload).toBe(true)
    expect(await exists('f06u_it_a', '%')).toBe(false)
    const [dbs] = (await root.query("SHOW DATABASES LIKE 'f06u\\_it\\_a'")) as unknown as [unknown[]]
    expect(dbs).toHaveLength(0)
    const none = await post({ mode: '2', delete: 'Go' })
    expect(none.message).toEqual({ type: 'error', text: 'No users selected for deleting!' })
  })

  it('user groups need the configuration storage', async () => {
    const d = await get<UserGroupsResponse>('/user-groups')
    // the shared server may carry a `phpmyadmin` storage (ZeroConf): then the list is answered
    expect(d.gate.enabled ? d.gate.isSuperUser : d.groups.length === 0).toBe(true)
  })
})
