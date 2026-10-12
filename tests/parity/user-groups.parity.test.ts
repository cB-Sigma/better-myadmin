import { readFileSync } from 'node:fs'
import type {
  ServerScope,
  UserGroupForm,
  UserGroupsResponse,
  UsersOverviewResponse,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareMetadataLogs } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { $$, pageHtml, parse, text } from './lib/html.ts'
import { type PmaShadow, canStartShadow, startPmaShadow } from './lib/pma-shadow.ts'
import { type PmaClient as Client, PmaClient, menuTabs } from './lib/pma.ts'
import { ROOT, pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of User groups (configurable menus): the group list, add / edit / delete, the users
 * of a group, assigning an account to a group from the overview, the pmadb clean-up when an account
 * is removed (RelationCleanup::user) and the menu restriction that follows. Both tools run with
 * their own control user `f06u_ctl` and configuration storage `f06u_pmadb` (a phpMyAdmin shadow
 * instance), so every statement on the control link is compared too.
 */
const PORT = 18946
const CTL = 'f06u_ctl'
const PMADB = 'f06u_pmadb'
const users = { pma: 'f06u_gpma', bma: 'f06u_gbma' }
const STORAGE = { controluser: CTL, controlpass: CTL, pmadb: PMADB }
const available = pmaReachable && canStartShadow()

let root: mysql.Connection
let log: GeneralLog
let shadow: PmaShadow
let pma: Client
let bma: ReturnType<typeof testApp>

const seed = () =>
  readFileSync(new URL('../../docker/seed/pmadb.sql', import.meta.url), 'utf8')
    .replaceAll('phpmyadmin', PMADB)
    .split('\n')
    .filter((l) => !/^\s*(GRANT|CREATE USER)\b/i.test(l))
    .join('\n')

/** Storage rows and accounts reset before each tool's turn. */
const RESET = `
DELETE FROM ${PMADB}.pma__usergroups; DELETE FROM ${PMADB}.pma__users; DELETE FROM ${PMADB}.pma__bookmark;
DROP USER IF EXISTS 'f06u_r'@'%'; CREATE USER 'f06u_r'@'%' IDENTIFIED BY 'f06u_r'; GRANT SELECT ON f06u_gdb.* TO 'f06u_r'@'%';
INSERT INTO ${PMADB}.pma__usergroups VALUES ('f06u_g0', 'server_databases', 'Y'), ('f06u_g0', 'server_sql', 'N'), ('f06u_g0', 'db_structure', 'Y');
INSERT INTO ${PMADB}.pma__users VALUES ('f06u_x', 'f06u_g0');
INSERT INTO ${PMADB}.pma__bookmark (dbase, user, label, query) VALUES ('f06u_gdb', 'f06u_r', 'b', 'SELECT 1');
`

async function pair<P, B>(
  pmaAction: () => Promise<P>,
  bmaAction: () => Promise<B>,
  setup = '',
): Promise<{ p: P; b: B; pmaLog: LogEntry[]; bmaLog: LogEntry[]; ctlP: LogEntry[]; ctlB: LogEntry[] }> {
  await root.query(RESET + setup)
  const m1 = await log.marker()
  const p = await pmaAction()
  const pmaLog = await log.since(users.pma, m1)
  const ctlP = await log.since(CTL, m1)
  await root.query(RESET + setup)
  const m2 = await log.marker()
  const b = await bmaAction()
  const bmaLog = await log.since(users.bma, m2)
  const ctlB = await log.since(CTL, m2)
  return { p, b, pmaLog, bmaLog, ctlP, ctlB }
}

/** Control-link statements: identical writes in order; every read we send, phpMyAdmin sent too. */
function sameControl(r: { ctlP: LogEntry[]; ctlB: LogEntry[] }) {
  const cmp = compareMetadataLogs(r.ctlP, r.ctlB, {})
  expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
  return cmp.bma.filter((s) => !/^(SELECT|SHOW)\b/.test(s))
}

const bmaJson = async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
  const r = await bma.req(method, `/api/servers/1/${path}`, body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as T
}

/** Every tab checkbox of phpMyAdmin's add-group form, `Y` for the given ones. */
function groupForm(allowed: string[]): Array<[string, string]> {
  return allowed.map((t): [string, string] => [t, 'Y'])
}

beforeAll(async () => {
  if (!available) return
  root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${PMADB}; ${seed()}`)
  await root.query(
    `DROP USER IF EXISTS '${CTL}'@'%'; CREATE USER '${CTL}'@'%' IDENTIFIED BY '${CTL}';
     GRANT SELECT, INSERT, UPDATE, DELETE ON \`${PMADB}\`.* TO '${CTL}'@'%'; GRANT SELECT ON mysql.* TO '${CTL}'@'%';
     DROP DATABASE IF EXISTS f06u_gdb; CREATE DATABASE f06u_gdb;`,
  )
  for (const u of [users.pma, users.bma]) {
    await root.query(
      `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%' WITH GRANT OPTION`,
    )
  }
  await root.query(RESET)
  log = await GeneralLog.open(ROOT)
  shadow = await startPmaShadow(PORT, { server: STORAGE })
  pma = new PmaClient(shadow.url)
  await pma.login(users.pma, users.pma)
  bma = testApp(testConfig({}, STORAGE))
  await bma.login(users.bma, users.bma)
  // warm both sessions (storage discovery, privilege probes)
  await pma.getJson('/server/user-groups', { ajax_page_request: 'true' })
  await bmaJson('GET', 'user-groups')
  await bmaJson('GET', 'privileges/users?showall=1')
})
afterAll(async () => {
  if (!available) return
  await bma?.close()
  await shadow?.stop()
  await log?.close()
  await root.query(
    `DROP DATABASE IF EXISTS ${PMADB}; DROP DATABASE IF EXISTS f06u_gdb; DROP USER IF EXISTS '${CTL}'@'%'; DROP USER IF EXISTS 'f06u_r'@'%';
     DROP USER IF EXISTS '${users.pma}'@'%'; DROP USER IF EXISTS '${users.bma}'@'%';`,
  )
  await root.end()
})

describe.skipIf(!available)('parity: user groups [p06-0bae9d]', () => {
  it('the list with each level’s allowed tabs', async () => {
    const r = await pair(
      () => pma.getJson('/server/user-groups', { ajax_page_request: 'true' }),
      () => bmaJson<UserGroupsResponse>('GET', 'user-groups'),
    )
    sameControl(r)
    const html = parse(pageHtml(r.p))
    const rows = $$(html, 'form#userGroupsForm tbody tr').map((tr) =>
      $$(tr, 'td')
        .slice(0, 4)
        .map((td) => text(td)),
    )
    expect(r.b.groups.map((g) => [g.name, g.serverTabs, g.dbTabs, g.tableTabs])).toEqual(rows)
    expect(rows.length).toBe(1)
  })

  it('add a group', async () => {
    const tabs = ['server_databases', 'server_sql', 'server_rights', 'db_structure', 'db_sql', 'table_browse']
    const r = await pair(
      () =>
        pma.postJson('/server/user-groups', [
          ['userGroup', 'f06u_g1'],
          ['addUserGroupSubmit', '1'],
          ...groupForm(tabs),
        ]),
      () =>
        bmaJson<UserGroupsResponse>('POST', 'user-groups', {
          userGroup: 'f06u_g1',
          addUserGroupSubmit: '1',
          ...Object.fromEntries(groupForm(tabs)),
        }),
    )
    const w = sameControl(r)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(
      /^INSERT INTO `f06u_pmadb`\.`pma__usergroups`\(`usergroup`, `tab`, `allowed`\) VALUES \('f06u_g1', 'server_databases', 'Y'\), \('f06u_g1', 'server_sql', 'Y'\), \('f06u_g1', 'server_status', 'N'\)/,
    )
  })

  it('edit a group', async () => {
    const r = await pair(
      () =>
        pma.postJson('/server/user-groups', [
          ['userGroup', 'f06u_g0'],
          ['editUserGroupSubmit', '1'],
          ...groupForm(['server_status', 'table_sql']),
        ]),
      () =>
        bmaJson<UserGroupsResponse>('POST', 'user-groups', {
          userGroup: 'f06u_g0',
          editUserGroupSubmit: '1',
          ...Object.fromEntries(groupForm(['server_status', 'table_sql'])),
        }),
    )
    const w = sameControl(r)
    expect(w[0]).toBe("DELETE FROM `f06u_pmadb`.`pma__usergroups` WHERE `usergroup`='f06u_g0'")
    expect(w).toHaveLength(2)
  })

  it('the edit form of a group', async () => {
    const r = await pair(
      () => pma.postJson('/server/user-groups', { editUserGroup: '1', userGroup: 'f06u_g0' }),
      () => bmaJson<UserGroupForm>('GET', 'user-groups/form?userGroup=f06u_g0'),
    )
    sameControl(r)
    const html = parse(pageHtml(r.p))
    const checked = $$(html, 'input.checkall')
      .filter((i) => 'checked' in i.attrs)
      .map((i) => i.attrs.name)
    expect(
      r.b.levels.flatMap((l) => l.tabs.filter((t) => t.allowed).map((t) => `${l.level}_${t.tab}`)),
    ).toEqual(checked)
    expect(r.b.levels.flatMap((l) => l.tabs.map((t) => t.name))).toEqual(
      $$(html, 'input.checkall').map((i) => text($$(html, `label[for=${i.attrs.id}]`)[0] ?? '')),
    )
  })

  it('the users of a group', async () => {
    const r = await pair(
      () => pma.postJson('/server/user-groups', { viewUsers: '1', userGroup: 'f06u_g0' }),
      () => bmaJson<{ users: string[] }>('GET', 'user-groups/users?userGroup=f06u_g0'),
    )
    // phpMyAdmin renders the groups table below the listing; the SPA reads it with its own request
    const listing = { ...r, ctlP: r.ctlP.filter((e) => !/ORDER BY `usergroup` ASC/.test(e.sql)) }
    sameControl(listing)
    expect(r.b.users).toEqual(['f06u_x'])
  })

  it('delete a group (its assignments first)', async () => {
    const r = await pair(
      () => pma.postJson('/server/user-groups', { deleteUserGroup: '1', userGroup: 'f06u_g0' }),
      () =>
        bmaJson<UserGroupsResponse>('POST', 'user-groups', { deleteUserGroup: '1', userGroup: 'f06u_g0' }),
    )
    expect(sameControl(r)).toEqual([
      "DELETE FROM `f06u_pmadb`.`pma__users` WHERE `usergroup`='f06u_g0'",
      "DELETE FROM `f06u_pmadb`.`pma__usergroups` WHERE `usergroup`='f06u_g0'",
    ])
  })
})

describe.skipIf(!available)('parity: user group of an account [p06-aa2020]', () => {
  it('the choice form', async () => {
    const r = await pair(
      () => pma.getJson('/server/user-groups/edit-form', { username: 'f06u_x' }),
      () =>
        bmaJson<{ userGroup: string | null; userGroups: string[] }>(
          'GET',
          'user-groups/edit-form?username=f06u_x',
        ),
    )
    sameControl(r)
    const html = parse(String(r.p.message))
    expect(['', ...r.b.userGroups]).toEqual($$(html, 'option').map((o) => o.attrs.value))
    expect(r.b.userGroup).toBe($$(html, 'option').find((o) => 'selected' in o.attrs)?.attrs.value ?? null)
  })

  for (const [name, user, group] of [
    ['assign', 'f06u_r', 'f06u_g0'],
    ['change', 'f06u_x', 'f06u_g9'],
    ['remove', 'f06u_x', ''],
  ] as const) {
    it(`${name} (setUserGroup)`, async () => {
      const r = await pair(
        () => pma.postJson('/server/privileges', { username: user, changeUserGroup: '1', userGroup: group }),
        () => bmaJson('POST', 'privileges', { username: user, changeUserGroup: '1', userGroup: group }),
      )
      expect(sameControl(r)).toHaveLength(1)
    })
  }

  it('the overview shows the group column and the edit-group action', async () => {
    const r = await pair(
      () => pma.getJson('/server/privileges', { initial: 'F', ajax_page_request: 'true' }),
      () => bmaJson<UsersOverviewResponse>('GET', 'privileges/users?initial=F'),
      "INSERT INTO f06u_pmadb.pma__users VALUES ('f06u_r', 'f06u_g0');",
    )
    sameControl(r)
    const html = parse(pageHtml(r.p))
    const pmaRow = $$(html, 'table#userRightsTable tbody tr').find((tr) =>
      ($$(tr, 'input')[0]?.attrs.value ?? '').startsWith('f06u_r&'),
    )
    expect(pmaRow).toBeDefined()
    const cell = $$(pmaRow ?? html, 'td.usrGroup')[0]
    expect(r.b.users?.find((u) => u.user === 'f06u_r')?.group).toBe(text(cell ?? ''))
    expect(r.b.userGroupCount > 0).toBe($$(html, 'button[data-bs-target=#editUserGroupModal]').length > 0)
  })

  it('removing an account clears its rows in the configuration storage (RelationCleanup::user)', async () => {
    const r = await pair(
      () =>
        pma.postJson('/server/privileges', [
          ['selected_usr[]', 'f06u_r&amp;#27;%'],
          ['mode', '2'],
          ['delete', 'Go'],
        ]),
      () => bmaJson('POST', 'privileges', { selected_usr: ['f06u_r&amp;#27;%'], mode: '2', delete: 'Go' }),
    )
    const w = sameControl(r)
    expect(w).toContain("DELETE FROM `f06u_pmadb`.`pma__bookmark` WHERE `user` = 'f06u_r'")
    expect(w).toContain("DELETE FROM `f06u_pmadb`.`pma__users` WHERE `username` = 'f06u_r'")
  })
})

describe.skipIf(!available)('parity: menus follow the user group', () => {
  it('a restricted account sees only the allowed server tabs', async () => {
    await root.query(RESET)
    await root.query(
      `INSERT INTO ${PMADB}.pma__users VALUES ('f06u_r', 'f06u_g0'); INSERT INTO ${PMADB}.pma__usergroups VALUES ('f06u_g0', 'server_status', 'N');`,
    )
    const p = new PmaClient(shadow.url)
    await p.login('f06u_r', 'f06u_r')
    const pmaTabs = menuTabs(await p.getPage('/'))
    const b = testApp(testConfig({}, STORAGE))
    try {
      await b.login('f06u_r', 'f06u_r')
      const scope = (await b.req('GET', '/api/servers/1')).json as unknown as ServerScope
      const label: Record<string, string> = {
        databases: 'Databases',
        sql: 'SQL',
        status: 'Status',
        export: 'Export',
        import: 'Import',
        settings: 'Settings',
        vars: 'Variables',
        charset: 'Charsets',
        engine: 'Engines',
        plugins: 'Plugins',
        rights: 'User accounts',
        binlog: 'Binary log',
        replication: 'Replication',
      }
      expect(scope.tabs.map((t) => label[t.key])).toEqual(pmaTabs.filter((t) => t !== 'More'))
      expect(pmaTabs).not.toContain('SQL')
      expect(pmaTabs).not.toContain('Status')
    } finally {
      await b.close()
    }
  })
})
