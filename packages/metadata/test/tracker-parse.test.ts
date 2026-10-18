import { describe, expect, it } from 'vitest'
import { parseTrackedQuery } from '../src/tracking.ts'

/** Tracker::parseQuery: the identifier, DDL / DML and the table of the first statement. */
describe('Tracker::parseQuery', () => {
  const p = (q: string) => parseTrackedQuery(q)
  it('DDL statements', () => {
    expect(p('CREATE TABLE t (a INT);')).toMatchObject({
      type: 'DDL',
      identifier: 'CREATE TABLE',
      tablename: 't',
    })
    expect(p('CREATE VIEW v AS SELECT 1;')).toMatchObject({ identifier: 'CREATE VIEW', tablename: 'v' })
    expect(p('CREATE DATABASE nd;')).toMatchObject({
      identifier: 'CREATE DATABASE',
      tablename: '',
      database: 'nd',
    })
    expect(p('ALTER TABLE `d`.`t` ADD c INT;')).toMatchObject({ identifier: 'ALTER TABLE', tablename: 't' })
    expect(p('DROP TABLE t;')).toMatchObject({ identifier: 'DROP TABLE', tablename: 't' })
    expect(p('DROP DATABASE od;')).toMatchObject({
      identifier: 'DROP DATABASE',
      tablename: '',
      database: 'od',
    })
    expect(p('RENAME TABLE a TO b;')).toMatchObject({
      identifier: 'RENAME TABLE',
      tablename: 'a',
      tablename_after_rename: 'b',
    })
  })
  it('DML statements', () => {
    expect(p('INSERT INTO t VALUES (1);')).toMatchObject({
      type: 'DML',
      identifier: 'INSERT',
      tablename: 't',
    })
    expect(p('UPDATE t SET a = 1;')).toMatchObject({ identifier: 'UPDATE', tablename: 't' })
    expect(p('DELETE FROM t WHERE a = 1;')).toMatchObject({ identifier: 'DELETE', tablename: 't' })
    expect(p('TRUNCATE t;')).toMatchObject({ identifier: 'TRUNCATE', tablename: 't' })
  })
  it('statements that are not tracked', () => {
    expect(p('SELECT 1;').identifier).toBeUndefined()
    expect(p('SHOW TABLES;').identifier).toBeUndefined()
    expect(p('USE other;').database).toBe('other')
  })
})
