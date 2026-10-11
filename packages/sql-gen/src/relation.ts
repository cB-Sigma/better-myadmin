/**
 * FOREIGN KEY statements of the Relation view.
 *
 * pma: src/Table/Table.php::getSQLToCreateForeignKey, templates/table/relation/foreign_key_row.twig
 */
import { backquote } from './quote.ts'

/**
 * ON DELETE / ON UPDATE choices (form value → SQL), in phpMyAdmin's order since 8847e08639: RESTRICT,
 * NO ACTION, CASCADE, SET NULL (RESTRICT is the default MySQL leaves out of SHOW CREATE TABLE).
 */
export const FK_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['RESTRICT', 'RESTRICT'],
  ['NO_ACTION', 'NO ACTION'],
  ['CASCADE', 'CASCADE'],
  ['SET_NULL', 'SET NULL'],
]

export const fkActionSql = (value: string): string | null =>
  FK_ACTIONS.find(([v]) => v === value)?.[1] ?? null

/** pma: Table::getSQLToCreateForeignKey */
export function getCreateForeignKeyQuery(
  db: string,
  table: string,
  fields: readonly string[],
  foreignDb: string,
  foreignTable: string,
  foreignFields: readonly string[],
  name: string | null,
  onDelete: string | null,
  onUpdate: string | null,
): string {
  let sql = `ALTER TABLE ${backquote(table)} ADD `
  if (name !== null && name !== '') sql += ` CONSTRAINT ${backquote(name)}`
  sql += ` FOREIGN KEY (${fields.map((f) => backquote(f)).join(', ')}) REFERENCES ${
    db !== foreignDb ? `${backquote(foreignDb)}.` : ''
  }${backquote(foreignTable)}(${foreignFields.map((f) => backquote(f)).join(', ')})`
  if (onDelete !== null && onDelete !== '') sql += ` ON DELETE ${onDelete}`
  if (onUpdate !== null && onUpdate !== '') sql += ` ON UPDATE ${onUpdate}`
  return `${sql};`
}

/** The "Drop" link of a constraint row (via /sql) */
export const getDropForeignKeyQuery = (db: string, table: string, constraint: string): string =>
  `ALTER TABLE ${backquote(db)}.${backquote(table)} DROP FOREIGN KEY ${backquote(constraint)};`

/** The DROP issued by Save when a constraint changed (Table::updateForeignKeys) */
export const getDropForeignKeyForUpdateQuery = (table: string, constraint: string): string =>
  `ALTER TABLE ${backquote(table)} DROP FOREIGN KEY ${backquote(constraint)};`
