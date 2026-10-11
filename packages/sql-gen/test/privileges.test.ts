import { describe, expect, it } from 'vitest'
import {
  type PrivForm,
  accountLockQuery,
  addUserNeedsHash,
  addUserQueries,
  copyDbGrantQuery,
  copyTableGrantQuery,
  createUserDatabaseQueries,
  escapeGrantWildcards,
  extractPrivInfo,
  fillInTablePrivileges,
  isDatabaseNameWildcard,
  oldPasswordsQuery,
  parseProcPriv,
  phpInt,
  privText,
  quoteString,
  rangeOfUsers,
  requireClause,
  tablePrivSetMembers,
  unescapeGrantWildcards,
  updatePrivilegesQueries,
  wildcardEscapeForGrant,
  withClause,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

interface AddUserCase {
  vendor: 'mysql' | 'mariadb'
  version: number
  pwdCheck: boolean
  case: string
  post: PrivForm
  queries: string[]
  ran: string[]
}
interface UpdateCase {
  vendor: 'mysql' | 'mariadb'
  version: number
  case: string
  post: PrivForm
  itemType: string
  dbAndTable: string
  dbname: string
  queries: [string, string | null]
  require: string
  with: string
  privs: string[]
}
interface ExtractCase {
  case: string
  row: Record<string, string>
  privs: string[]
  html: string[]
}

const f = loadFixture<{ addUser: AddUserCase[]; update: UpdateCase[]; extract: ExtractCase[] }>(
  'privileges.json',
)
const flavour = (c: { vendor: string; version: number }) => ({
  versionInt: c.version,
  isMariaDb: c.vendor === 'mariadb',
})

describe('Add user statements (golden, executed phpMyAdmin over a server matrix)', () => {
  it('getSqlQueriesForDisplayAndAddUser', () => {
    expect(f.addUser.length).toBeGreaterThan(50)
    for (const c of f.addUser) {
      const fl = flavour(c)
      const label = `${c.vendor} ${c.version}${c.pwdCheck ? ' pwd-check' : ''}: ${c.case}`
      const needsHash = addUserNeedsHash(c.post, fl, c.pwdCheck)
      const pw = typeof c.post.pma_pw === 'string' ? c.post.pma_pw : ''
      const hashQuery = `SELECT PASSWORD(${quoteString(pw)});`
      // the statements phpMyAdmin runs while building them
      const ran: string[] = []
      if (c.vendor === 'mariadb' && c.version >= 100002)
        ran.push("SHOW PLUGINS SONAME LIKE '%_password_check%'")
      if (typeof c.post.authentication_plugin === 'string')
        ran.push(oldPasswordsQuery(c.post.authentication_plugin))
      if (needsHash) ran.push(hashQuery)
      expect(ran, label).toEqual(c.ran)
      const q = addUserQueries({
        user: 'f06u_n',
        host: 'h%',
        password: 'stored*hash',
        post: c.post,
        flavour: fl,
        pwdCheckPluginActive: c.pwdCheck,
        isGrantUser: true,
        privs: extractPrivInfo(null, c.post),
        hashed: needsHash ? `*HASHED-${Buffer.byteLength(hashQuery)}` : null,
      })
      expect(
        [
          q.createUserReal,
          q.createUserShow,
          q.realSqlQuery,
          q.sqlQuery,
          q.passwordSetReal,
          q.passwordSetShow,
          q.alterRealSqlQuery,
          q.alterSqlQuery,
        ],
        label,
      ).toEqual(c.queries)
    }
  })

  it('a user without GRANT gets no global GRANT', () => {
    const q = addUserQueries({
      user: 'u',
      host: '%',
      password: '',
      post: { pred_password: 'none' },
      flavour: { versionInt: 80400, isMariaDb: false },
      pwdCheckPluginActive: false,
      isGrantUser: false,
      privs: extractPrivInfo(null, {}),
      hashed: null,
    })
    expect(q.realSqlQuery).toBe('')
    expect(q.createUserReal).toBe("CREATE USER 'u'@'%' IDENTIFIED BY '';")
    expect(q.alterRealSqlQuery).toBe("ALTER USER 'u'@'%' REQUIRE NONE;")
  })
})

describe('Update privileges statements (golden)', () => {
  it('generateQueriesForUpdatePrivileges, getRequireClause, getWithClause, extractPrivInfo', () => {
    expect(f.update.length).toBeGreaterThan(100)
    for (const c of f.update) {
      const fl = flavour(c)
      const label = `${c.vendor} ${c.version}: ${c.case} on ${c.dbAndTable}`
      const privs = extractPrivInfo(null, c.post)
      expect(privText(privs), label).toEqual(c.privs)
      expect(requireClause(c.post), label).toBe(c.require)
      expect(withClause(c.post, fl), label).toBe(c.with)
      const q = updatePrivilegesQueries(c.post, fl, privs, c.itemType, c.dbAndTable, 'u', 'h', c.dbname)
      expect([q.grant, q.alter], label).toEqual(c.queries)
    }
  })
})

describe('extractPrivInfo on rows (golden)', () => {
  it('names and descriptions', () => {
    for (const c of f.extract) {
      const items = extractPrivInfo(c.row, {})
      expect(privText(items), c.case).toEqual(c.privs)
      expect(
        items.map((p) => `<dfn title="${p.title}">${p.name}</dfn>`),
        c.case,
      ).toEqual(c.html)
    }
  })
})

describe('account names and wildcards', () => {
  it('escapes and unescapes grant wildcards', () => {
    expect(escapeGrantWildcards('a_b%c\\d')).toBe('a\\_b\\%c\\d')
    expect(unescapeGrantWildcards('a\\_b\\%c\\d')).toBe('a_b%c\\d')
    expect(isDatabaseNameWildcard('a\\_b')).toBe(false)
    expect(isDatabaseNameWildcard('a_b')).toBe(true)
    expect(isDatabaseNameWildcard(['a_b'])).toBe(false)
  })
  it('wildcardEscapeForGrant', () => {
    expect(wildcardEscapeForGrant('', 'x')).toBe('*.*')
    expect(wildcardEscapeForGrant('d\\_b', '')).toBe('`d\\_b`.*')
    expect(wildcardEscapeForGrant('d\\_b', 't`1')).toBe('`d_b`.`t``1`')
  })
  it('rangeOfUsers', () => {
    expect(rangeOfUsers(null)).toBe('')
    expect(rangeOfUsers('')).toBe("WHERE `User` = ''")
    expect(rangeOfUsers('A_')).toBe("WHERE `User` LIKE 'A\\\\_%' OR `User` LIKE 'a\\\\_%'")
  })
  it('PHP (int) of posted limits', () => {
    expect([phpInt('12abc'), phpInt(' -3'), phpInt('x'), phpInt(undefined), phpInt('1e3')]).toEqual([
      12, -3, 0, 0, 1,
    ])
  })
})

describe('table and routine privileges', () => {
  it('reads the Table_priv SET and expands a row', () => {
    const members = tablePrivSetMembers(
      "set('Select','Insert','Update','Delete','Create','Drop','Grant','References','Index','Alter','Create View','Show view','Trigger')",
    )
    expect(members).toHaveLength(13)
    expect(members[10]).toBe('Create View')
    const row = fillInTablePrivileges({ Table_priv: 'Select,Grant,Show view', Db: 'd' }, members)
    expect(row.Table_priv).toBeUndefined()
    expect([row.Select_priv, row.Insert_priv, row['Show view_priv'], row.Db]).toEqual(['Y', 'N', 'Y', 'd'])
    expect(privText(extractPrivInfo(row, {}))).toEqual(['SELECT', 'SHOW VIEW'])
  })
  it('parseProcPriv', () => {
    expect(parseProcPriv('Execute,Alter Routine,Grant')).toEqual({
      Alter_routine_priv: 'Y',
      Execute_priv: 'Y',
      Grant_priv: 'Y',
    })
  })
  it('table level: only the TABLE_GRANTS keys (getAllPrivileges)', () => {
    const items = extractPrivInfo({ Delete: 'Y', 'Create View': 'Y', Trigger: 'N' }, {}, true)
    expect(privText(items)).toEqual(['DELETE', 'CREATE_VIEW'])
  })
})

describe('copy user and other statements', () => {
  it('copies database and table grants with column lists', () => {
    const dbRow = { Db: 'd\\_b', Select_priv: 'Y', Insert_priv: 'N', Grant_priv: 'Y' }
    expect(copyDbGrantQuery(dbRow, extractPrivInfo(dbRow, {}), 'n', '%')).toBe(
      "GRANT SELECT ON `d\\_b`.* TO 'n'@'%' WITH GRANT OPTION;",
    )
    const tRow = { Db: 'db', Table_name: 't', Select_priv: 'N', Insert_priv: 'Y', Table_priv: 'Insert,Grant' }
    expect(
      copyTableGrantQuery(
        tRow,
        extractPrivInfo({ Insert_priv: 'Y', Select_priv: 'N' }, {}),
        [
          { Column_name: 'a', Column_priv: 'Select,Update' },
          { Column_name: 'b', Column_priv: 'Select' },
        ],
        'n',
        '%',
      ),
    ).toBe("GRANT INSERT, SELECT (`a`, `b`), UPDATE (`a`) ON `db`.`t` TO 'n'@'%' WITH GRANT OPTION;")
  })
  it('the "Database for user account" statements', () => {
    expect(
      createUserDatabaseQueries('u_x', '%', 'other', { sameName: true, wildcard: true, database: true }),
    ).toEqual({
      createDatabase: 'CREATE DATABASE IF NOT EXISTS `u_x`;',
      grants: [
        "GRANT ALL PRIVILEGES ON `u\\_x`.* TO 'u_x'@'%';",
        "GRANT ALL PRIVILEGES ON `u\\_x\\_%`.* TO 'u_x'@'%';",
        "GRANT ALL PRIVILEGES ON `other`.* TO 'u_x'@'%';",
      ],
    })
  })
  it('account locking', () => {
    expect(accountLockQuery("o'k", 'h', true)).toBe("ALTER USER 'o\\'k'@'h' ACCOUNT LOCK;")
    expect(accountLockQuery('u', '%', false)).toBe("ALTER USER 'u'@'%' ACCOUNT UNLOCK;")
  })
})
