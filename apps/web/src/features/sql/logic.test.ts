import { describe, expect, it } from 'vitest'
import {
  autoSavedKey,
  canSimulate,
  checkSqlQuery,
  confirmationText,
  insertValueText,
  needsConfirmation,
  scanParameters,
  snippetQuery,
} from './logic'

describe('confirmQuery (resources/js/modules/functions.ts)', () => {
  it.each([
    ['DROP TABLE t', true],
    ['  drop table if exists t', true],
    ['DROP PROCEDURE p', true],
    ['DROP DATABASE d', false],
    ['DROP VIEW v', false],
    ['ALTER TABLE t DROP c', true],
    ['ALTER TABLE `my t` DROP COLUMN c', true],
    ['ALTER TABLE t ADD c INT', false],
    ['DELETE FROM t WHERE id = 1', true],
    ['DELETE t FROM t', false],
    ['TRUNCATE t', true],
    ['TRUNCATE TABLE t', true],
    ['UPDATE t SET a = 1', true],
    ['UPDATE t SET a = 1 WHERE id = 1', false],
    // `.` does not match a newline: a multi-line UPDATE never asks
    ['UPDATE t\nSET a = 1', false],
    // the regex is not anchored to a statement start: any "update" word without WHERE asks
    ['SELECT * FROM lastupdate', true],
    ['SELECT 1 -- UPDATE', true],
    ['INSERT INTO t VALUES (1)', false],
  ])('%s → %s', (sql, want) => {
    expect(needsConfirmation(sql)).toBe(want)
  })

  it('cuts the message at 100 characters [p09-e295f8]', () => {
    expect(confirmationText('TRUNCATE t')).toBe('Do you really want to execute "TRUNCATE t"?')
    const long = `DELETE FROM t WHERE ${'x'.repeat(200)}`
    expect(confirmationText(long)).toBe(`Do you really want to execute "${long.slice(0, 100)}\n    ..."?`)
  })

  it('checkSqlQuery: empty, Confirm off [p09-331963]', () => {
    expect(checkSqlQuery('', true)).toBe('empty')
    expect(checkSqlQuery(' \n ', true)).toBe('empty')
    expect(checkSqlQuery('TRUNCATE t', false)).toBe('ok')
    expect(checkSqlQuery('TRUNCATE t', true)).toBe('confirm')
    expect(checkSqlQuery('SELECT 1', true)).toBe('ok')
  })
})

describe('updateQueryParameters', () => {
  it('finds unique :names in order [p09-ec9fe2]', () => {
    expect(scanParameters('SELECT :a, :b1, :a, :_x FROM t WHERE c = ":q"')).toEqual([
      ':a',
      ':b1',
      ':_x',
      ':q',
    ])
    expect(scanParameters('SELECT 1')).toEqual([])
    expect(scanParameters("SELECT '12:30:00'")).toEqual([':30', ':00'])
  })
})

describe('insertQuery / insertValueQuery (resources/js/sql.ts)', () => {
  const cols = ['`id`', '`name`', '`a``b`']
  it('uses every column of the list [p09-625a43]', () => {
    expect(snippetQuery('selectall', 'my`t', cols)).toBe('SELECT * FROM `my``t` WHERE 1')
    expect(snippetQuery('select', 't', cols)).toBe('SELECT `id`, `name`, `a``b` FROM `t` WHERE 1')
    expect(snippetQuery('insert', 't', cols)).toBe(
      "INSERT INTO `t`(`id`, `name`, `a``b`) VALUES ('[value-1]','[value-2]','[value-3]')",
    )
    expect(snippetQuery('update', 't', cols)).toBe(
      "UPDATE `t` SET `id`='[value-1]',`name`='[value-2]',`a``b`='[value-3]' WHERE 1",
    )
    expect(snippetQuery('delete', 't', cols)).toBe('DELETE FROM `t` WHERE 0')
    expect(snippetQuery('select', 't', [])).toBeNull()
  })
  it('inserts the selected columns comma separated [p09-0cd66f]', () => {
    expect(insertValueText(['`a`', '`b`'])).toBe('`a`, `b`')
  })
})

describe('handleSimulateQueryButton', () => {
  it.each([
    ['UPDATE t SET a = 1', true],
    ['update `db`.`my t` set a = 1', true],
    ['UPDATE t1, t2 SET a = 1', false],
    ['DELETE FROM t', true],
    ['DELETE t FROM t', true],
    ['DELETE LOW_PRIORITY FROM t', true],
    ['SELECT 1', false],
    ['  UPDATE x SET y = 2', true],
  ])('%s → %s', (sql, want) => {
    expect(canSimulate(sql)).toBe(want)
  })
})

describe('getAutoSavedKey', () => {
  it('db[.table], "undefined" at server scope [p09-d68993]', () => {
    expect(autoSavedKey('', '')).toBe('autoSavedSql_undefined')
    expect(autoSavedKey('db', '')).toBe('autoSavedSql_db')
    expect(autoSavedKey('db', 't')).toBe('autoSavedSql_db.t')
  })
})
