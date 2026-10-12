import type {
  AddUserForm,
  PrivActionResponse,
  UserProperties,
  UsersOverviewResponse,
} from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AllowedDiff, compareLogs } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { $, $$, type Node, pageHtml, parse, text } from './lib/html.ts'
import type { PmaForm, PmaJson } from './lib/pma.ts'
import { type Harness, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Server → User accounts (docs/features/06-server-level.md): the overview, the
 * Add user form and action, the user editor at global / database / table / routine level, update
 * and revoke privileges, passwords, copy user (modes 1–4), export, delete, flush, account locking
 * and Table → Privileges. Every GRANT / REVOKE / CREATE USER / ALTER USER / DROP USER statement
 * must be identical: each action runs against the same fixture state in both tools (the state is
 * reset as root in between), so the accounts have the same names.
 *
 * Accounts: f06u_pma / f06u_bma (the tools), f06u_t* (the edited accounts), all dropped afterwards.
 */
const users = { pma: 'f06u_pma', bma: 'f06u_bma' }
const STORAGE = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
let h: Harness

const DROP_ACCOUNTS = [
  "'f06u_t1'@'%'",
  "'f06u_t1'@'localhost'",
  "'f06u_t2'@'%'",
  "'f06u_t3'@'%'",
  "'f06u_new'@'%'",
  "'f06u_new'@'localhost'",
  "'f06u_new'@'10.1.2.3'",
  "''@'f06u.example'",
  "'f06u_cp'@'%'",
]
  .map((a) => `DROP USER IF EXISTS ${a};`)
  .join(' ')

/** The fixture accounts and objects (run as root before each tool's turn). */
const FIXTURE = `
${DROP_ACCOUNTS}
DROP DATABASE IF EXISTS f06u_db; DROP DATABASE IF EXISTS f06u_new; DROP DATABASE IF EXISTS f06u_t1; DROP DATABASE IF EXISTS f06uroutines;
CREATE DATABASE f06u_db; CREATE DATABASE f06uroutines;
CREATE PROCEDURE f06uroutines.p1() SELECT 1;
CREATE FUNCTION f06uroutines.f1() RETURNS INT DETERMINISTIC RETURN 1;
CREATE TABLE f06u_db.t1 (a INT, b VARCHAR(10), \`c\`\`q\` INT);
CREATE TABLE f06u_db.t2 (x INT);
CREATE PROCEDURE f06u_db.p1() SELECT 1;
CREATE FUNCTION f06u_db.f1() RETURNS INT DETERMINISTIC RETURN 1;
CREATE USER 'f06u_t1'@'%' IDENTIFIED BY 'pw_t1' WITH MAX_QUERIES_PER_HOUR 7;
GRANT SELECT, INSERT ON *.* TO 'f06u_t1'@'%';
CREATE USER 'f06u_t1'@'localhost';
CREATE USER 'f06u_t2'@'%' IDENTIFIED BY 'pw_t2' REQUIRE SSL;
GRANT SELECT, UPDATE ON \`f06u\\_db\`.* TO 'f06u_t2'@'%' WITH GRANT OPTION;
GRANT DELETE ON \`f06u\\_d%\`.* TO 'f06u_t2'@'%';
GRANT INSERT, TRIGGER ON f06u_db.t1 TO 'f06u_t2'@'%';
GRANT SELECT (a, b), UPDATE (b) ON f06u_db.t1 TO 'f06u_t2'@'%';
GRANT SELECT (x) ON f06u_db.t2 TO 'f06u_t2'@'%';
GRANT EXECUTE ON PROCEDURE f06u_db.p1 TO 'f06u_t2'@'%';
GRANT EXECUTE, ALTER ROUTINE ON FUNCTION f06u_db.f1 TO 'f06u_t2'@'%' WITH GRANT OPTION;
GRANT EXECUTE ON PROCEDURE f06uroutines.p1 TO 'f06u_t2'@'%';
GRANT EXECUTE, ALTER ROUTINE ON FUNCTION f06uroutines.f1 TO 'f06u_t2'@'%';
CREATE USER 'f06u_t3'@'%' ACCOUNT LOCK;
`

const PER_SUITE: AllowedDiff[] = [
  {
    tool: 'pma',
    pattern: '^SELECT @@lower_case_table_names$',
    why: 'Util::getCollateForIS reads it on every request; BetterMyAdmin keeps it for the session.',
  },
]

/**
 * Runs `pmaAction` and `bmaAction` against the same fixture state (FIXTURE then `setup`, as root,
 * before each), returning both results and each tool's statements.
 */
async function pair<P, B>(
  pmaAction: () => Promise<P>,
  bmaAction: () => Promise<B>,
  setup = '',
  /** an account whose SHOW GRANTS is read (as root) after each tool's action */
  grantsOf?: string,
): Promise<{ p: P; b: B; pmaLog: LogEntry[]; bmaLog: LogEntry[]; pmaGrants: string[]; bmaGrants: string[] }> {
  const grants = async () => {
    if (grantsOf === undefined) return []
    const [rows] = (await h.root.query(`SHOW GRANTS FOR ${grantsOf}`)) as unknown as [
      Array<Record<string, string>>,
    ]
    return rows.map((r) => Object.values(r)[0] ?? '')
  }
  await h.root.query(FIXTURE + setup)
  const m1 = await h.log.marker()
  const p = await pmaAction()
  const pmaLog = await h.log.since(users.pma, m1)
  const pmaGrants = await grants()
  await h.root.query(FIXTURE + setup)
  const m2 = await h.log.marker()
  const b = await bmaAction()
  const bmaLog = await h.log.since(users.bma, m2)
  const bmaGrants = await grants()
  return { p, b, pmaLog, bmaLog, pmaGrants, bmaGrants }
}

/**
 * The statements of both tools are identical. Stricter than the shared defaults: phpMyAdmin's
 * `SHOW TABLES FROM` and authentication-plugin reads are part of these pages, so they are compared.
 */
function same(r: { pmaLog: LogEntry[]; bmaLog: LogEntry[] }, extra: AllowedDiff[] = []) {
  const cmp = compareLogs(r.pmaLog, r.bmaLog, h.dbMap, {
    extra: [...PER_SUITE, ...extra],
    exclude: ['^SHOW TABLES FROM `[^`]+`$'],
  })
  expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
  return cmp
}

const qs = (params: Record<string, string | string[]>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) u.append(`${k}[]`, x)
    else u.append(k, v)
  }
  const s = u.toString()
  return s === '' ? '' : `?${s}`
}

const pmaView = (params: Record<string, string>) =>
  h.pma.getJson('/server/privileges', { ...params, ajax_page_request: 'true' })
const pmaPost = (form: PmaForm) => h.pma.postJson('/server/privileges', form)
const bmaGet = async <T>(path: string, params: Record<string, string | string[]> = {}) => {
  const r = await h.bma.req('GET', `/api/servers/1/${path}${qs(params)}`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as T
}
const bmaPost = async (
  form: Record<string, string | string[]>,
  query: Record<string, string> = {},
  failing = false,
) => {
  const r = await h.bma.req('POST', `/api/servers/1/privileges${qs(query)}`, form)
  if (failing) {
    // a statement phpMyAdmin runs with DatabaseInterface::query() failed: Generator::mysqlDie
    expect(r.status, JSON.stringify(r.json)).toBe(400)
    const e = (r.json as { error: { message: string; errno: number } }).error
    return {
      success: false,
      message: { type: 'error', text: `#${e.errno} - ${e.message}` },
      sql: '',
    } as unknown as PrivActionResponse
  }
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as unknown as PrivActionResponse
}

/** The form's pairs → our JSON body (`name[]` → array) */
function toBody(form: Array<[string, string]>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of form) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2)
      const list = (out[key] as string[] | undefined) ?? []
      list.push(v)
      out[key] = list
    } else out[k] = v
  }
  return out
}

/** The text of phpMyAdmin's export textarea (entities decoded, whitespace kept) */
function textarea(html: string): string {
  const m = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(html)
  return (m?.[1] ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&')
}

/** The message text of a phpMyAdmin AJAX answer */
const pmaMessage = (j: PmaJson) =>
  text(parse(String(j.message ?? j.error ?? '')))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Exception X40 (phpmyadmin/phpmyadmin#19605) applies: MySQL/Percona ≥ 8.0.11, where phpMyAdmin's
 * Edit privileges GRANT silently drops the requested grant option and ours keeps it.
 */
let x40 = false
const WGO = ' WITH GRANT OPTION'
/** SHOW GRANTS lines on `target` of each tool: ours has the grant option, phpMyAdmin's lacks it (X40) */
function expectX40(r: { pmaGrants: string[]; bmaGrants: string[] }, target: RegExp) {
  const on = (xs: string[]) => xs.filter((g) => target.test(g))
  expect(on(r.bmaGrants).length, JSON.stringify(r.bmaGrants)).toBeGreaterThan(0)
  expect(
    on(r.bmaGrants).every((g) => g.endsWith(WGO)),
    JSON.stringify(r.bmaGrants),
  ).toBe(true)
  if (x40) {
    // phpMyAdmin's grants of this level: no grant option (recorded, the bug)
    expect(
      on(r.pmaGrants).some((g) => g.endsWith(WGO)),
      JSON.stringify(r.pmaGrants),
    ).toBe(false)
  } else {
    expect(on(r.pmaGrants)).toEqual(on(r.bmaGrants))
  }
}

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, STORAGE)
  const [v] = (await h.root.query('SELECT VERSION() AS v')) as unknown as [Array<{ v: string }>]
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v[0]?.v ?? '')
  x40 =
    !/mariadb/i.test(v[0]?.v ?? '') &&
    m !== null &&
    Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) >= 80011
  await h.root.query(FIXTURE)
  // warm both sessions up (session-cached privilege probes, storage discovery)
  await pmaView({})
  await bmaGet('privileges/users')
})
afterAll(async () => {
  await h?.root.query(
    `${DROP_ACCOUNTS} DROP DATABASE IF EXISTS f06u_db; DROP DATABASE IF EXISTS f06u_new; DROP DATABASE IF EXISTS f06u_t1; DROP DATABASE IF EXISTS f06uroutines;`,
  )
  await h?.close()
})

// ------------------------------------------------------------------ overview

/** users_overview.twig rows of the f06u_t* accounts */
function overviewRows(html: Node) {
  return $$(html, 'table#userRightsTable tbody tr')
    .map((tr) => {
      const tds = $$(tr, 'td')
      return {
        value: $(tr, 'input')?.attrs.value ?? '',
        user: text(tds[1] as Node).trim(),
        host: text(tds[2] as Node).trim(),
        password: text(tds[3] as Node).trim(),
        privileges: $$(tds[4] as Node, 'dfn').map((d) => [text(d), d.attrs.title]),
        privText: text($(tds[4] as Node, 'code') as Node).trim(),
        locked: $(tr, 'button.jsAccountLocking')?.attrs['data-is-locked'] ?? null,
      }
    })
    .filter((r) => r.value.startsWith('f06u_t'))
}

function bmaOverviewRows(d: UsersOverviewResponse) {
  return (d.users ?? [])
    .filter((u) => u.user.startsWith('f06u_t'))
    .map((u) => ({
      value: `${u.user}&amp;#27;${u.host}`,
      user: u.user === '' ? 'Any' : u.user,
      host: u.host,
      password: `${u.hasPassword ? 'Yes' : 'No'}`,
      privileges: u.privileges.filter((p) => p.title !== '').map((p) => [p.name, p.title]),
      privText: u.privileges.map((p) => p.name).join(', '),
      locked: d.hasAccountLocking ? String(u.isAccountLocked) : null,
    }))
}

describe.skipIf(!pmaReachable)('parity: user accounts overview', () => {
  for (const [name, params] of [
    ['all accounts [p06-74795d]', { showall: '1' }],
    ['initial F [p06-74795d]', { initial: 'F' }],
    ['empty initial (anonymous accounts) [p06-74795d]', { initial: '' }],
  ] as const) {
    it(name, async () => {
      const r = await pair(
        () => pmaView(params),
        () => bmaGet<UsersOverviewResponse>('privileges/users', params),
      )
      same(r)
      const html = parse(pageHtml(r.p))
      expect(bmaOverviewRows(r.b)).toEqual(overviewRows(html))
      expect(r.b.flushNote === 'reload').toBe($(html, 'a#reload_privileges_anchor') !== undefined)
      expect(r.b.initials !== null).toBe($(html, 'ul#userAccountsPagination') !== undefined)
    })
  }
})

// ------------------------------------------------------------------ add user form

describe.skipIf(!pmaReachable)('parity: add user form', () => {
  for (const [name, params] of [
    ['plain [p06-dc46b3]', { adduser: '1' }],
    ['from a database (createdb-3) [p06-dc46b3]', { adduser: '1', dbname: 'f06u_db' }],
  ] as const) {
    it(name, async () => {
      const r = await pair(
        () => pmaView(params),
        () => bmaGet<AddUserForm>('privileges/add-user', params),
      )
      same(r)
      const html = parse(pageHtml(r.p))
      const plugins = $$(html, 'select#select_authentication_plugin option').map((o) => [
        o.attrs.value,
        text(o).trim(),
        'selected' in o.attrs,
      ])
      expect(
        r.b.login.authPlugins.map((pl) => [pl.name, pl.description, pl.name === r.b.login.authPlugin]),
      ).toEqual(plugins)
      expect(r.b.login.usernameLength).toBe($(html, 'input#pma_username')?.attrs.maxlength)
      expect(r.b.login.hostnameLength).toBe($(html, 'input#pma_hostname')?.attrs.maxlength)
      expect(r.b.database).toBe($(html, 'input[name=dbname]')?.attrs.value ?? '')
      // the global privileges table: every checkbox, checked state from the new-user defaults
      const boxes = $$(html, 'form#addUsersForm input.checkall').map((i) => i.attrs.name)
      expect(boxes.length).toBeGreaterThan(20)
      expect(Object.keys(r.b.privilegesTable?.row ?? {}).filter((k) => k.endsWith('_priv'))).toEqual(
        expect.arrayContaining(boxes.filter((b): b is string => b !== undefined && b !== 'Create View_priv')),
      )
    })
  }
})

// ------------------------------------------------------------------ user editor views

describe.skipIf(!pmaReachable)('parity: edit privileges views', () => {
  const VIEWS: Array<[string, Record<string, string>]> = [
    [
      'global level [p06-b6e1bb]',
      { username: 'f06u_t2', hostname: '%', dbname: '', tablename: '', routinename: '' },
    ],
    ['global level, user with password and limits [p06-b6e1bb]', { username: 'f06u_t1', hostname: '%' }],
    ['database level [p06-b6e1bb]', { username: 'f06u_t2', hostname: '%', dbname: 'f06u\\_db' }],
    ['wildcard database [p06-b6e1bb]', { username: 'f06u_t2', hostname: '%', dbname: 'f06u\\_d%' }],
    [
      'table level with columns [p06-b6e1bb]',
      { username: 'f06u_t2', hostname: '%', dbname: 'f06u\\_db', tablename: 't1' },
    ],
    [
      'table without privileges [p06-b6e1bb]',
      { username: 'f06u_t1', hostname: '%', dbname: 'f06u\\_db', tablename: 't2' },
    ],
    [
      'routine level [p06-b6e1bb]',
      { username: 'f06u_t2', hostname: '%', dbname: 'f06uroutines', routinename: 'f1' },
    ],
    [
      'routine of a database with `_` [p06-b6e1bb]',
      { username: 'f06u_t2', hostname: '%', dbname: 'f06u\\_db', routinename: 'f1' },
    ],
    ['user not found [p06-b6e1bb]', { username: 'f06u_none', hostname: '%' }],
  ]
  for (const [name, params] of VIEWS) {
    it(name, async () => {
      const r = await pair(
        () => pmaView(params),
        () => bmaGet<UserProperties>('privileges/user', params),
      )
      same(r)
      const html = parse(pageHtml(r.p))
      const checked = $$(html, 'form#addUsersForm input[type=checkbox]')
        .filter((i) => 'checked' in i.attrs && i.attrs.name !== undefined)
        .map((i) => i.attrs.name)
      const row = r.b.routine?.privileges ?? r.b.privilegesTable?.row ?? {}
      const alias: Record<string, string> = {
        Create_view_priv: 'Create View_priv',
        Show_view_priv: 'Show view_priv',
      }
      for (const n of checked) {
        const key =
          r.b.privilegesTable?.columns != null && alias[n as string] !== undefined
            ? (alias[n as string] as string)
            : (n as string)
        expect([n, row[key] ?? row[n as string]]).toEqual([n, 'Y'])
      }
      const summary = (id: string) =>
        $$(html, `form#${id} tbody tr`).map((tr) =>
          $$(tr, 'td')
            .slice(0, 4)
            .map((td) => text(td).replace(/\s+/g, ' ').trim()),
        )
      for (const rights of r.b.rights) {
        const id = `${rights.type}_specific_priv`
        const rows = rights.rows.map((x) => [
          x.name,
          x.privileges.map((pr) => (pr.columns === null ? pr.name : `${pr.name} (${pr.columns})`)).join(','),
          x.grant ? 'Yes' : 'No',
          ...(rights.type === 'routine' ? [] : [x.sub ? 'Yes' : 'No']),
        ])
        const pmaRows = summary(id).filter((cells) => cells.length > 1)
        expect(rows.map((cells) => cells.slice(0, pmaRows[0]?.length ?? cells.length))).toEqual(
          pmaRows.map((cells) => cells.slice(0, rows[0]?.length ?? cells.length)),
        )
      }
      expect(r.b.userDoesNotExist).toBe(
        text(html).includes('The selected user was not found in the privilege table.'),
      )
    })
  }
})

// ------------------------------------------------------------------ actions

/** The `grant_count` the global privileges table renders (from phpMyAdmin's Add user form). */
async function globalGrantCount(): Promise<string> {
  const html = parse(pageHtml(await pmaView({ adduser: '1' })))
  return $$(html, 'input[name=grant_count]').at(-1)?.attrs.value ?? ''
}

/** Every checkbox of the global privileges table (ALL PRIVILEGES when all are posted). */
async function allGlobalBoxes(): Promise<string[]> {
  const html = parse(pageHtml(await pmaView({ adduser: '1' })))
  return $$(html, 'form#addUsersForm input.checkall')
    .map((i) => i.attrs.name ?? '')
    .filter((n) => n.endsWith('_priv'))
}

/** An action in both tools; the message texts must match too. */
async function action(
  form: Array<[string, string]>,
  opts: {
    setup?: string
    query?: Record<string, string>
    extra?: AllowedDiff[]
    failing?: boolean
    grantsOf?: string
  } = {},
) {
  const query = opts.query ?? {}
  const r = await pair(
    () =>
      Object.keys(query).length > 0
        ? h.pma.getJson('/server/privileges', { ...Object.fromEntries(form), ...query })
        : pmaPost(form),
    () => bmaPost(toBody(form), query, opts.failing),
    opts.setup,
    opts.grantsOf,
  )
  const cmp = same(r, opts.extra)
  if (opts.failing === true) {
    expect(r.p.success).toBe(false)
    // mysqlDie: "#errno - message" plus the statement
    expect(pmaMessage(r.p)).toContain(r.b.message.text.replace(/^#\d+ - /, ''))
  } else {
    expect(
      r.b.message.text
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe(pmaMessage(r.p))
  }
  expect(r.b.success).toBe(r.p.success)
  return { ...r, cmp }
}

/** After CREATE DATABASE phpMyAdmin makes it current and its response reads the new database's tabs. */
const NEW_DB_MENU: AllowedDiff[] = [
  {
    tool: 'pma',
    pattern:
      '^SHOW TABLES FROM `f06u_new`$|^SELECT `PRIVILEGE_TYPE` FROM `INFORMATION_SCHEMA`\\.`USER_PRIVILEGES` WHERE GRANTE',
    why: 'Add user with "Create database with same name" sets Current::$database; the response middleware checks it and its menu tabs. The SPA opens the database with its own requests.',
  },
]

const writes = (c: { bma: string[] }) => c.bma.filter((s) => !/^(SELECT|SHOW|USE)\b/.test(s))

describe.skipIf(!pmaReachable)('parity: add user [p06-dc46b3]', () => {
  it('text fields, password, plugin, same-name database, wildcard grant, privileges, limits', async () => {
    const r = await action(
      [
        ['pred_username', 'userdefined'],
        ['username', 'f06u_new'],
        ['pred_hostname', 'any'],
        ['hostname', '%'],
        ['pred_password', 'userdefined'],
        ['pma_pw', 'Secret_123'],
        ['pma_pw2', 'Secret_123'],
        ['authentication_plugin', 'caching_sha2_password'],
        ['createdb-1', 'on'],
        ['createdb-2', 'on'],
        ['Select_priv', 'Y'],
        ['Insert_priv', 'Y'],
        ['Create_tmp_table_priv', 'Y'],
        ['Grant_priv', 'Y'],
        ['max_questions', '5'],
        ['max_updates', '-3'],
        ['max_connections', 'x'],
        ['max_user_connections', '2'],
        ['ssl_type', 'NONE'],
        ['grant_count', await globalGrantCount()],
        ['adduser_submit', '1'],
      ],
      { extra: NEW_DB_MENU },
    )
    expect(writes(r.cmp)).toEqual([
      "CREATE USER 'f06u_new'@'%' IDENTIFIED WITH 'caching_sha2_password' BY <secret>",
      "GRANT SELECT, INSERT, CREATE TEMPORARY TABLES ON *.* TO 'f06u_new'@'%' WITH GRANT OPTION",
      "ALTER USER 'f06u_new'@'%' REQUIRE NONE WITH MAX_QUERIES_PER_HOUR 5 MAX_CONNECTIONS_PER_HOUR 0 MAX_UPDATES_PER_HOUR 0 MAX_USER_CONNECTIONS 2",
      'CREATE DATABASE IF NOT EXISTS `f06u_new`',
      "GRANT ALL PRIVILEGES ON `f06u\\_new`.* TO 'f06u_new'@'%'",
      "GRANT ALL PRIVILEGES ON `f06u\\_new\\_%`.* TO 'f06u_new'@'%'",
    ])
    expect(r.b.sql).toBe(
      "CREATE USER 'f06u_new'@'%' IDENTIFIED WITH caching_sha2_password BY '***';GRANT SELECT, INSERT, CREATE TEMPORARY TABLES ON *.* TO 'f06u_new'@'%' WITH GRANT OPTION;ALTER USER 'f06u_new'@'%' REQUIRE NONE WITH MAX_QUERIES_PER_HOUR 5 MAX_CONNECTIONS_PER_HOUR 0 MAX_UPDATES_PER_HOUR 0 MAX_USER_CONNECTIONS 2;CREATE DATABASE IF NOT EXISTS `f06u_new`;GRANT ALL PRIVILEGES ON `f06u\\_new`.* TO 'f06u_new'@'%';GRANT ALL PRIVILEGES ON `f06u\\_new\\_%`.* TO 'f06u_new'@'%';",
    )
    expect(r.b.reload).toBe(true)
  })

  it('local host, no password, every privilege (ALL PRIVILEGES), SPECIFIED requirements', async () => {
    const boxes = await allGlobalBoxes()
    const r = await action([
      ['pred_username', 'userdefined'],
      ['username', 'f06u_new'],
      ['pred_hostname', 'localhost'],
      ['hostname', 'localhost'],
      ['pred_password', 'none'],
      ['pma_pw', ''],
      ['pma_pw2', ''],
      ['authentication_plugin', 'caching_sha2_password'],
      ...boxes.map((b): [string, string] => [b, 'Y']),
      ['max_questions', '0'],
      ['max_updates', '0'],
      ['max_connections', '0'],
      ['max_user_connections', '0'],
      ['ssl_type', 'SPECIFIED'],
      ['ssl_cipher', 'EDH-RSA-DES-CBC3-SHA'],
      ['x509_issuer', "/C=SE/O=f06u's CA"],
      ['x509_subject', ''],
      ['grant_count', await globalGrantCount()],
      ['adduser_submit', '1'],
    ])
    expect(writes(r.cmp)[1]).toBe("GRANT ALL PRIVILEGES ON *.* TO 'f06u_new'@'localhost' WITH GRANT OPTION")
    expect(writes(r.cmp)[2]).toContain("REQUIRE CIPHER 'EDH-RSA-DES-CBC3-SHA' AND ISSUER")
  })

  it('a text-field host, the SHA256 plugin, X509, the database of the context (createdb-3)', async () => {
    const r = await action([
      ['pred_username', 'userdefined'],
      ['username', 'f06u_new'],
      ['pred_hostname', 'userdefined'],
      ['hostname', '10.1.2.3'],
      ['pred_password', 'userdefined'],
      ['pma_pw', 'Secret_456'],
      ['pma_pw2', 'Secret_456'],
      ['authentication_plugin', 'sha256_password'],
      ['createdb-3', 'on'],
      ['dbname', 'f06u\\_db'],
      ['Execute_priv', 'Y'],
      ['ssl_type', 'X509'],
      ['grant_count', await globalGrantCount()],
      ['adduser_submit', '1'],
    ])
    expect(writes(r.cmp)).toEqual([
      "CREATE USER 'f06u_new'@'10.1.2.3' IDENTIFIED WITH 'sha256_password' BY <secret>",
      "GRANT EXECUTE ON *.* TO 'f06u_new'@'10.1.2.3'",
      "ALTER USER 'f06u_new'@'10.1.2.3' REQUIRE X509",
      "GRANT ALL PRIVILEGES ON `f06u\\_db`.* TO 'f06u_new'@'10.1.2.3'",
    ])
  })

  it('"This host" and REQUIRE SSL, no resource fields posted', async () => {
    const thisHost =
      "DROP USER IF EXISTS 'f06u_new'@'172.17.0.1'; DROP USER IF EXISTS 'f06u_new'@'127.0.0.1';"
    await action(
      [
        ['pred_username', 'userdefined'],
        ['username', 'f06u_new'],
        ['pred_hostname', 'thishost'],
        ['hostname', ''],
        ['pred_password', 'userdefined'],
        ['pma_pw', 'Secret_789'],
        ['pma_pw2', 'Secret_789'],
        ['ssl_type', 'ANY'],
        ['adduser_submit', '1'],
      ],
      { setup: thisHost },
    )
    await h.root.query(thisHost)
  })

  it('an existing account is refused', async () => {
    const r = await action([
      ['pred_username', 'userdefined'],
      ['username', 'f06u_t1'],
      ['pred_hostname', 'any'],
      ['hostname', '%'],
      ['pred_password', 'none'],
      ['adduser_submit', '1'],
    ])
    expect(r.b.addUserError).toBe(true)
    expect(writes(r.cmp)).toEqual([])
  })

  it('the exists-warning check (validate_username)', async () => {
    const r = await pair(
      () => h.pma.getJson('/server/privileges', { validate_username: '1', username: 'f06u_t1' }),
      () => bmaGet<{ userExists: boolean }>('privileges/validate-username', { username: 'f06u_t1' }),
    )
    same(r)
    expect(r.b.userExists).toBe(r.p.user_exists)
    expect(r.b.userExists).toBe(true)
  })
})

describe.skipIf(!pmaReachable)('parity: update privileges [p06-de1797] [p06-cee965]', () => {
  const acc = (user: string): Array<[string, string]> => [
    ['username', user],
    ['hostname', '%'],
  ]
  it('global level: privileges, limits, REQUIRE (ALTER USER on MySQL ≥ 8.0.11)', async () => {
    const r = await action([
      ...acc('f06u_t1'),
      ['dbname', ''],
      ['Select_priv', 'Y'],
      ['Reload_priv', 'Y'],
      ['Process_priv', 'Y'],
      ['max_questions', '10'],
      ['max_updates', '20'],
      ['max_connections', '30'],
      ['max_user_connections', '40'],
      ['ssl_type', 'X509'],
      ['grant_count', await globalGrantCount()],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp)).toEqual([
      "REVOKE ALL PRIVILEGES ON *.* FROM 'f06u_t1'@'%'",
      "REVOKE GRANT OPTION ON *.* FROM 'f06u_t1'@'%'",
      "GRANT SELECT, RELOAD, PROCESS ON *.* TO 'f06u_t1'@'%'",
      "ALTER USER 'f06u_t1'@'%' REQUIRE X509 WITH MAX_QUERIES_PER_HOUR 10 MAX_CONNECTIONS_PER_HOUR 30 MAX_UPDATES_PER_HOUR 20 MAX_USER_CONNECTIONS 40",
    ])
  })

  it('global level with GRANT (X40: ours keeps the grant option)', async () => {
    const r = await action(
      [
        ...acc('f06u_t1'),
        ['Select_priv', 'Y'],
        ['Grant_priv', 'Y'],
        ['ssl_type', 'NONE'],
        ['grant_count', await globalGrantCount()],
        ['update_privs', '1'],
      ],
      { grantsOf: "'f06u_t1'@'%'" },
    )
    expect(writes(r.cmp)[0]).toBe("REVOKE ALL PRIVILEGES ON *.* FROM 'f06u_t1'@'%'")
    expect(writes(r.cmp)[1]).toBe(`GRANT SELECT ON *.* TO 'f06u_t1'@'%'${WGO}`)
    if (x40) {
      // phpMyAdmin's statements: no grant option anywhere, the ALTER USER is sent by both unchanged
      expect(r.cmp.pma.find((x) => x.startsWith('GRANT'))).toBe("GRANT SELECT ON *.* TO 'f06u_t1'@'%'")
      expect(writes(r.cmp)[2]).toBe("ALTER USER 'f06u_t1'@'%' REQUIRE NONE")
    }
    expectX40(r, /^GRANT .* ON \*\.\* TO /)
  })

  it('database level', async () => {
    const r = await action([
      ...acc('f06u_t2'),
      ['dbname', 'f06u\\_db'],
      ['Select_priv', 'Y'],
      ['Create_view_priv', 'Y'],
      ['Event_priv', 'Y'],
      ['grant_count', '19'],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp).slice(0, 3)).toEqual([
      "REVOKE ALL PRIVILEGES ON `f06u\\_db`.* FROM 'f06u_t2'@'%'",
      "REVOKE GRANT OPTION ON `f06u\\_db`.* FROM 'f06u_t2'@'%'",
      "GRANT SELECT, CREATE VIEW, EVENT ON `f06u\\_db`.* TO 'f06u_t2'@'%'",
    ])
  })

  it('a wildcard database with GRANT (X40: ours keeps the grant option)', async () => {
    const r = await action(
      [
        ...acc('f06u_t2'),
        ['dbname', 'f06u\\_d%'],
        ['Delete_priv', 'Y'],
        ['Grant_priv', 'Y'],
        ['grant_count', '19'],
        ['update_privs', '1'],
      ],
      { grantsOf: "'f06u_t2'@'%'" },
    )
    expect(writes(r.cmp)[1]).toBe("GRANT DELETE ON `f06u\\_d%`.* TO 'f06u_t2'@'%' WITH GRANT OPTION")
    if (x40) {
      expect(r.cmp.pma.find((x) => x.startsWith('GRANT'))).toBe(
        "GRANT DELETE ON `f06u\\_d%`.* TO 'f06u_t2'@'%'",
      )
      expect(writes(r.cmp)[2]).toBe("ALTER USER 'f06u_t2'@'%'")
    }
    expectX40(r, /^GRANT .* ON `f06u\\_d%`\.\* TO /)
  })

  it('table level with GRANT (X40)', async () => {
    const r = await action(
      [
        ...acc('f06u_t2'),
        ['dbname', 'f06u\\_db'],
        ['tablename', 't2'],
        ['grant_count', '13'],
        ['column_count', '1'],
        ['Delete_priv', 'Y'],
        ['Grant_priv', 'Y'],
        ['update_privs', '1'],
      ],
      { grantsOf: "'f06u_t2'@'%'" },
    )
    expect(writes(r.cmp).find((s) => s.startsWith('GRANT'))).toBe(
      "GRANT DELETE ON `f06u_db`.`t2` TO 'f06u_t2'@'%' WITH GRANT OPTION",
    )
    expectX40(r, /^GRANT .* ON `f06u_db`\.`t2` TO /)
  })

  it('routine level with GRANT (X40)', async () => {
    const r = await action(
      [
        ...acc('f06u_t2'),
        ['dbname', 'f06uroutines'],
        ['routinename', 'p1'],
        ['grant_count', '3'],
        ['Execute_priv', 'Y'],
        ['Grant_priv', 'Y'],
        ['update_privs', '1'],
      ],
      { grantsOf: "'f06u_t2'@'%'" },
    )
    expect(writes(r.cmp).find((s) => s.startsWith('GRANT'))).toBe(
      "GRANT EXECUTE ON PROCEDURE `f06uroutines`.`p1` TO 'f06u_t2'@'%' WITH GRANT OPTION",
    )
    expectX40(r, /^GRANT .* ON PROCEDURE `f06uroutines`\.`p1` TO /)
  })

  it('several databases at once (pred_dbname[])', async () => {
    const r = await action([
      ...acc('f06u_t2'),
      ['pred_dbname[]', 'f06u\\_db'],
      ['pred_dbname[]', 'f06u\\_new'],
      ['Select_priv', 'Y'],
      ['grant_count', '19'],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp).filter((s) => s.startsWith('GRANT'))).toEqual([
      "GRANT SELECT ON `f06u\\_db`.* TO 'f06u_t2'@'%'",
      "GRANT SELECT ON `f06u\\_new`.* TO 'f06u_t2'@'%'",
    ])
  })

  it('table level: column lists, every column, None, table privileges', async () => {
    const r = await action([
      ...acc('f06u_t2'),
      ['dbname', 'f06u\\_db'],
      ['tablename', 't1'],
      ['grant_count', '13'],
      ['column_count', '3'],
      ['Select_priv[]', 'a'],
      ['Select_priv[]', 'c`q'],
      ['Insert_priv[]', 'a'],
      ['Insert_priv[]', 'b'],
      ['Insert_priv[]', 'c`q'],
      ['Update_priv[]', 'b'],
      ['Update_priv_none', 'on'],
      ['References_priv[]', 'b'],
      ['Delete_priv', 'Y'],
      ['Create_view_priv', 'Y'],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp).slice(0, 3)).toEqual([
      "REVOKE ALL PRIVILEGES ON `f06u_db`.`t1` FROM 'f06u_t2'@'%'",
      "REVOKE GRANT OPTION ON `f06u_db`.`t1` FROM 'f06u_t2'@'%'",
      "GRANT SELECT (`a`, `c``q`), INSERT, DELETE, REFERENCES (`b`), CREATE VIEW ON `f06u_db`.`t1` TO 'f06u_t2'@'%'",
    ])
  })

  it('table level with nothing selected: no GRANT USAGE', async () => {
    const r = await action([
      ...acc('f06u_t2'),
      ['dbname', 'f06u\\_db'],
      ['tablename', 't2'],
      ['grant_count', '13'],
      ['column_count', '1'],
      ['Select_priv_none', 'on'],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp).some((s) => s.startsWith('GRANT'))).toBe(false)
  })

  it('routine level (FUNCTION)', async () => {
    const r = await action([
      ...acc('f06u_t2'),
      ['dbname', 'f06uroutines'],
      ['routinename', 'f1'],
      ['grant_count', '3'],
      ['Execute_priv', 'Y'],
      ['update_privs', '1'],
    ])
    expect(writes(r.cmp).slice(0, 3)).toEqual([
      "REVOKE ALL PRIVILEGES ON FUNCTION `f06uroutines`.`f1` FROM 'f06u_t2'@'%'",
      "REVOKE GRANT OPTION ON FUNCTION `f06uroutines`.`f1` FROM 'f06u_t2'@'%'",
      "GRANT EXECUTE ON FUNCTION `f06uroutines`.`f1` TO 'f06u_t2'@'%'",
    ])
  })

  it('a routine of a database with `_`: no routine type is found, the GRANT fails like phpMyAdmin', async () => {
    // getRoutineType looks the routine up with the wildcard-escaped name (`f06u\_db`)
    const r = await action(
      [
        ...acc('f06u_t2'),
        ['dbname', 'f06u\\_db'],
        ['routinename', 'f1'],
        ['grant_count', '3'],
        ['Execute_priv', 'Y'],
        ['update_privs', '1'],
      ],
      { failing: true },
    )
    expect(writes(r.cmp).at(-1)).toBe("GRANT EXECUTE ON `f06u_db`.`f1` TO 'f06u_t2'@'%'")
  })
})

describe.skipIf(!pmaReachable)('parity: revoke [p06-b6e1bb]', () => {
  const CASES: Array<[string, Array<[string, string]>]> = [
    ['database', [['dbname', 'f06u\\_db']]],
    [
      'table',
      [
        ['dbname', 'f06u\\_db'],
        ['tablename', 't1'],
      ],
    ],
    [
      'routine (PROCEDURE)',
      [
        ['dbname', 'f06uroutines'],
        ['routinename', 'p1'],
      ],
    ],
  ]
  for (const [name, form] of CASES) {
    it(name, async () => {
      const r = await action([['username', 'f06u_t2'], ['hostname', '%'], ...form, ['revokeall', '1']])
      expect(writes(r.cmp)[0]).toMatch(/^REVOKE ALL PRIVILEGES ON /)
    })
  }
  it('a routine of a database with `_` fails like phpMyAdmin', async () => {
    await action(
      [
        ['username', 'f06u_t2'],
        ['hostname', '%'],
        ['dbname', 'f06u\\_db'],
        ['routinename', 'p1'],
        ['revokeall', '1'],
      ],
      { failing: true },
    )
  })
})

describe.skipIf(!pmaReachable)('parity: change password of another account [p06-d38b0c]', () => {
  const acc: Array<[string, string]> = [
    ['username', 'f06u_t1'],
    ['hostname', '%'],
  ]
  it('a new password with a plugin', async () => {
    const r = await action([
      ...acc,
      ['nopass', '0'],
      ['pma_pw', 'Neu_pw_1'],
      ['pma_pw2', 'Neu_pw_1'],
      ['authentication_plugin', 'caching_sha2_password'],
      ['change_pw', '1'],
    ])
    expect(writes(r.cmp)).toEqual([
      "ALTER USER 'f06u_t1'@'%' IDENTIFIED WITH 'caching_sha2_password' BY <secret>",
      'FLUSH PRIVILEGES',
    ])
  })
  it('no password', async () => {
    await action([...acc, ['nopass', '1'], ['pma_pw', ''], ['pma_pw2', ''], ['change_pw', '1']])
  })
  it('mismatching passwords', async () => {
    const r = await action([...acc, ['nopass', '0'], ['pma_pw', 'a1'], ['pma_pw2', 'a2'], ['change_pw', '1']])
    expect(writes(r.cmp)).toEqual([])
  })
})

describe.skipIf(!pmaReachable)('parity: change login information / copy user [p06-128720]', () => {
  const copy = (mode: string, extra: Array<[string, string]> = []): Array<[string, string]> => [
    ['old_username', 'f06u_t2'],
    ['old_hostname', '%'],
    ['pred_username', 'userdefined'],
    ['username', 'f06u_cp'],
    ['pred_hostname', 'any'],
    ['hostname', '%'],
    ['authentication_plugin', 'caching_sha2_password'],
    ['mode', mode],
    ['change_copy', '1'],
    ...(extra.some(([k]) => k === 'pred_password')
      ? []
      : ([['pred_password', 'keep']] as Array<[string, string]>)),
    ...extra,
  ]
  it('mode 4: keep the old account, keep the password; database, table and column grants', async () => {
    const r = await action(copy('4'))
    const w = writes(r.cmp)
    expect(w[0]).toMatch(/^CREATE USER 'f06u_cp'@'%' IDENTIFIED WITH 'caching_sha2_password'/)
    expect(w).toContain(
      "GRANT INSERT, TRIGGER, SELECT (`a`, `b`), UPDATE (`b`) ON `f06u_db`.`t1` TO 'f06u_cp'@'%'",
    )
    expect(w.some((s) => s.startsWith('DROP USER'))).toBe(false)
  })
  for (const mode of ['1', '2', '3']) {
    it(`mode ${mode}: the old account is dropped`, async () => {
      const r = await action(copy(mode, [['pred_password', 'none']]))
      expect(writes(r.cmp).at(-1)).toBe("DROP USER 'f06u_t2'@'%'")
    })
  }
  it('a new password and another host', async () => {
    const local = "DROP USER IF EXISTS 'f06u_cp'@'localhost';"
    await action(
      [
        ...copy('4', [['pred_password', 'userdefined']]).filter(
          ([k]) => !['pred_hostname', 'hostname'].includes(k),
        ),
        ['pred_hostname', 'localhost'],
        ['hostname', 'localhost'],
        ['pma_pw', 'Copy_pw_1'],
        ['pma_pw2', 'Copy_pw_1'],
      ],
      { setup: local },
    )
    await h.root.query(local)
  })
  it('a column name with a backquote: the copied column GRANT fails like phpMyAdmin', async () => {
    // getTablePrivsQueriesForChangeOrCopyUser pastes column names between backquotes unescaped
    await action(copy('4'), { setup: "GRANT UPDATE (`c``q`) ON f06u_db.t1 TO 'f06u_t2'@'%';", failing: true })
  })
  it('unchanged user name and host are refused', async () => {
    const r = await action([...copy('4').filter(([k]) => k !== 'username'), ['username', 'f06u_t2']])
    expect(writes(r.cmp)).toEqual([])
  })
})

describe.skipIf(!pmaReachable)('parity: export privileges [p06-180eb0]', () => {
  it('one account', async () => {
    const r = await pair(
      () =>
        h.pma.getJson('/server/privileges', { username: 'f06u_t2', hostname: '%', initial: '', export: '1' }),
      () => h.bma.req('POST', '/api/servers/1/privileges/export', { username: 'f06u_t2', hostname: '%' }),
    )
    same(r)
    expect((r.b.json as { grants: string }).grants).toBe(textarea(String(r.p.message)))
    expect((r.b.json as { title: string }).title).toBe(text(parse(String(r.p.title))))
  })
  it('selected accounts', async () => {
    const sel = ['f06u_t1&amp;#27;%', 'f06u_t2&amp;#27;%', 'f06u_t1&amp;#27;%']
    const r = await pair(
      () =>
        h.pma.postJson('/server/privileges', [
          ...sel.map((s): [string, string] => ['selected_usr[]', s]),
          ['submit_mult', 'export'],
        ]),
      () => h.bma.req('POST', '/api/servers/1/privileges/export', { selected_usr: sel }),
    )
    same(r)
    expect((r.b.json as { grants: string }).grants).toBe(textarea(String(r.p.message)))
  })
})

describe.skipIf(!pmaReachable)('parity: remove accounts, reload, lock [p06-140d4c] [p06-306802]', () => {
  it('remove selected accounts with their databases', async () => {
    const r = await action(
      [
        ['selected_usr[]', 'f06u_t1&amp;#27;%'],
        ['selected_usr[]', 'f06u_t3&amp;#27;%'],
        ['drop_users_db', 'on'],
        ['mode', '2'],
        ['delete', 'Go'],
      ],
      { setup: 'CREATE DATABASE f06u_t1;' },
    )
    expect(writes(r.cmp)).toEqual([
      "DROP USER 'f06u_t1'@'%'",
      'DROP DATABASE IF EXISTS `f06u_t1`',
      "DROP USER 'f06u_t3'@'%'",
      'DROP DATABASE IF EXISTS `f06u_t3`',
    ])
  })
  it('nothing selected', async () => {
    await action([
      ['mode', '2'],
      ['delete', 'Go'],
    ])
  })
  it('reload the privileges', async () => {
    const r = await action([], { query: { flush_privileges: '1' } })
    expect(writes(r.cmp)).toEqual(['FLUSH PRIVILEGES'])
  })
  for (const lock of [true, false]) {
    it(lock ? 'lock an account' : 'unlock an account', async () => {
      const route = lock ? 'account-lock' : 'account-unlock'
      const r = await pair(
        () => h.pma.postJson(`/server/privileges/${route}`, { username: 'f06u_t1', hostname: '%' }),
        () => h.bma.req('POST', `/api/servers/1/privileges/${route}`, { username: 'f06u_t1', hostname: '%' }),
        lock ? '' : "ALTER USER 'f06u_t1'@'%' ACCOUNT LOCK;",
      )
      const cmp = same(r)
      expect(writes(cmp)).toEqual([`ALTER USER 'f06u_t1'@'%' ACCOUNT ${lock ? 'LOCK' : 'UNLOCK'}`])
      expect((r.b.json as { message: { text: string } }).message.text).toBe(pmaMessage(r.p))
    })
  }
})

describe.skipIf(!pmaReachable)('parity: table → privileges', () => {
  it('users having access to a table', async () => {
    const r = await pair(
      () => h.pma.getJson('/table/privileges', { db: 'f06u_db', table: 't1', ajax_page_request: 'true' }),
      () =>
        bmaGet<{ accounts: Array<{ user: string; host: string }> }>('databases/f06u_db/tables/t1/privileges'),
      "GRANT SELECT ON `f06u\\_d%`.* TO 'f06u_t1'@'%';",
    )
    same(r, [
      {
        tool: 'pma',
        pattern: '^SELECT 1 FROM `f06u_db`\\.`t1` LIMIT 1$',
        why: 'DbTableExists::hasTable for the table-scope request; the SPA checks the scope with its own request.',
      },
    ])
    const html = parse(pageHtml(r.p))
    const pmaUsers = $$(html, 'form#usersForm tbody tr input')
      .map((i) => i.attrs.value ?? '')
      .filter((v) => v.startsWith('f06u_t'))
    expect(
      r.b.accounts.filter((a) => a.user.startsWith('f06u_t')).map((a) => `${a.user}&amp;#27;${a.host}`),
    ).toEqual(pmaUsers)
    expect(pmaUsers.length).toBeGreaterThan(0)
  })
})
