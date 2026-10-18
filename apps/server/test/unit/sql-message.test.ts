import { describe, expect, it } from 'vitest'
import { lookForUse, reloadHints } from '../../src/query/import.ts'
import { formatError, getMessageCard, mysqlDie, sqlAsPhp } from '../../src/query/message.ts'
import { getDetailedProfilingStats } from '../../src/query/profiling.ts'
import { testConfig } from '../support/app.ts'

const cfg = testConfig()
const card = (sql: string, showAsPhp: boolean | null = null, profiling = true) =>
  getMessageCard(sql, {
    cfg,
    showAsPhp,
    db: 'd',
    table: '',
    profilingOn: false,
    profilingSupported: async () => profiling,
  })

describe('Generator::getMessage links', () => {
  it('Explain / Skip Explain / Skip Analyze [p02-aa2107] [p09-0c49c5]', async () => {
    expect((await card('SELECT 1;'))!.links.explain).toEqual({
      text: 'Explain SQL',
      sql: 'EXPLAIN SELECT 1;',
    })
    expect((await card('select\n1;'))!.links.explain?.text).toBe('Explain SQL')
    expect((await card('EXPLAIN SELECT 1;'))!.links.explain).toEqual({
      text: 'Skip Explain SQL',
      sql: 'SELECT 1;',
    })
    expect((await card('explain analyze format=tree select 1;'))!.links.explain).toEqual({
      text: 'Skip Explain SQL',
      sql: 'select 1;',
    })
    expect((await card('ANALYZE FORMAT=JSON SELECT 1;'))!.links.explain).toEqual({
      text: 'Skip Analyze SQL',
      sql: 'SELECT 1;',
    })
    expect((await card('EXPLAIN t;'))!.links.explain).toBeNull()
    expect((await card(' SELECT 1;'))!.links.explain).toBeNull()
  })

  it('Refresh only for ANALYZE/EXPLAIN/SELECT/SHOW and not with PHP; profiling next to it [p02-f44b2c p02-2a54e4] [p09-0c49c5] [p09-280f8a]', async () => {
    expect((await card('SHOW TABLES;'))!.links).toMatchObject({
      refresh: true,
      profiling: { checked: false },
    })
    expect((await card('UPDATE t SET a = 1;'))!.links).toMatchObject({ refresh: false, profiling: null })
    expect((await card('SELECT 1;', null, false))!.links.profiling).toBeNull()
    expect((await card('SELECT 1;', true))!.links).toMatchObject({
      refresh: false,
      php: 'without',
      edit: false,
      editInline: false,
    })
    expect((await card('SELECT 1;', false))!.links).toMatchObject({
      refresh: false,
      php: 'create',
      edit: true,
    })
  })

  it("$cfg['SQLQuery'] Edit / Explain / ShowAsPHP / Refresh off hide their links [p09-0c49c5]", async () => {
    const off = await getMessageCard('SELECT 1;', {
      cfg: testConfig({ SQLQuery: { Edit: false, Explain: false, ShowAsPHP: false, Refresh: false } }),
      showAsPhp: null,
      db: 'd',
      table: '',
      profilingOn: false,
      profilingSupported: async () => true,
    })
    expect(off!.links).toMatchObject({
      edit: false,
      editInline: false,
      explain: null,
      php: null,
      refresh: false,
    })
  })

  it('no card for empty SQL or ";" [p02-f22617] [p09-ac586d]', async () => {
    expect(await card('')).toBeNull()
    expect(await card(';')).toBeNull()
  })

  it('PHP code with continuation lines [p02-f4f624] [p09-550737]', () => {
    expect(sqlAsPhp('SELECT "a" FROM t\nWHERE x = \'y\'')).toBe(
      '$sql = "SELECT \\"a\\" FROM t\\n"\n    . "WHERE x = \\\'y\\\'";',
    )
  })
})

describe('Generator::mysqlDie / formatError', () => {
  it('static analysis, hidden SQL for connect, collapsed blank lines [p02-fa2d56] [p09-a25a57]', () => {
    const e = mysqlDie('#1064 - x', "SELECT 'abc", cfg, undefined)
    expect(e.staticAnalysis).toEqual([{ message: "Ending quote ' was expected.", token: '', position: 11 }])
    expect(e.sql).toBe("SELECT 'abc")
    expect(e.selectDoc).toBe(true)
    expect(mysqlDie('m', 'connect to x', cfg, undefined).sql).toBeNull()
    expect(mysqlDie('a\n\n\n\nb', 'SELECT 1', cfg, undefined).serverMessage).toBe('a\n\nb')
  })

  it('special error texts', () => {
    expect(formatError(2002, 'x').text).toBe(
      "#2002 - x — The server is not responding (or the local server's socket is not correctly configured).",
    )
    expect(formatError(2003, 'x').text).toBe('#2003 - x — The server is not responding.')
    expect(formatError(1698, 'x')).toEqual({
      text: '#1698 - x — Logout and try as another user.',
      hint: { kind: 'logout', text: 'Logout and try as another user.' },
    })
    expect(formatError(1005, "Can't create (errno: 13)").text).toMatch(/Please check privileges/)
    expect(formatError(1005, 'fk').hint?.kind).toBe('innodb-status')
    expect(formatError(1146, 'x').text).toBe('#1146 - x')
  })
})

describe('ImportController reload hints and Import::lookForUse', () => {
  it('reload hints [p02-b19bd5] [p09-410573]', () => {
    expect(reloadHints('DROP TABLE x')).toEqual({ reloadNavigation: true, ajaxReload: { reload: true } })
    expect(reloadHints('create view v as select 1')).toEqual({
      reloadNavigation: false,
      ajaxReload: { reload: true },
    })
    expect(reloadHints('RENAME TABLE `a` TO `b`;')).toEqual({
      reloadNavigation: false,
      ajaxReload: { reload: true, tableName: 'b' },
    })
    expect(reloadHints(' DROP TABLE x')).toEqual({ reloadNavigation: false, ajaxReload: {} })
    expect(reloadHints('SELECT 1')).toEqual({ reloadNavigation: false, ajaxReload: {} })
  })

  it('lookForUse [p02-b19bd5] [p09-410573]', () => {
    expect(lookForUse('USE `my``db`;')).toBe('my`db')
    // [\S]+ stops at the first space, like PHP
    expect(lookForUse('USE `my db`;')).toBe('`my')
    expect(lookForUse('  use test;')).toBe('test')
    expect(lookForUse('SELECT 1')).toBe('')
  })
})

describe('Sql::getDetailedProfilingStats', () => {
  it('aggregates by ucwords(state), sorted by total time [p09-33158a]', () => {
    const p = getDetailedProfilingStats([
      { Status: 'starting', Duration: '0.000050' },
      { Status: 'executing', Duration: '0.000200' },
      { Status: 'starting', Duration: '0.000030' },
    ])!
    expect(p.chart.labels).toEqual(['Executing', 'Starting'])
    expect(p.states[1]).toMatchObject({ state: 'Starting', calls: 2, totalTime: '80 µ', percent: '28.57' })
    expect(p.profile[0]).toEqual({ status: 'Starting', duration: '50 µ', durationRaw: '0.000050' })
    expect(getDetailedProfilingStats([{ Status: 'x', Duration: '0' }])).toBeNull()
  })
})
