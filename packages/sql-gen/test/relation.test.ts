import { describe, expect, it } from 'vitest'
import { FK_ACTIONS, fkActionSql, getCreateForeignKeyQuery, getDropForeignKeyQuery } from '../src/relation.ts'

describe('Relation view statements (Table::getSQLToCreateForeignKey)', () => {
  it('names, columns, other database and actions', () => {
    expect(
      getCreateForeignKeyQuery('d', 't', ['a', 'b'], 'e', 'u', ['x', 'y'], 'fk', 'CASCADE', 'SET NULL'),
    ).toBe(
      'ALTER TABLE `t` ADD  CONSTRAINT `fk` FOREIGN KEY (`a`, `b`) REFERENCES `e`.`u`(`x`, `y`) ON DELETE CASCADE ON UPDATE SET NULL;',
    )
    expect(getCreateForeignKeyQuery('d', 't', ['a'], 'd', 'u', ['x'], '', null, null)).toBe(
      'ALTER TABLE `t` ADD  FOREIGN KEY (`a`) REFERENCES `u`(`x`);',
    )
    expect(getDropForeignKeyQuery('d', 't', 'f`k')).toBe('ALTER TABLE `d`.`t` DROP FOREIGN KEY `f``k`;')
  })

  it('lists the actions in upstream order, RESTRICT first', () => {
    expect(FK_ACTIONS.map(([v]) => v)).toEqual(['RESTRICT', 'NO_ACTION', 'CASCADE', 'SET_NULL'])
    expect(fkActionSql('NO_ACTION')).toBe('NO ACTION')
  })
})
