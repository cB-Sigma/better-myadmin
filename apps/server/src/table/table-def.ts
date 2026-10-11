/**
 * The table definition the SQL export plugin produces for a table copy / move and for a tracking
 * version: `ExportSql::getTableDef` itself (packages/export), on the request's user link.
 *
 * pma: src/Table/TableMover.php::moveCopy (getPlugin('export', 'sql'), useSqlBackquotes(true),
 *      setAutoIncrement, getTableDef($db, $table, false, $isView) + the deferred sqlConstraintsQuery /
 *      sqlIndexes / sqlAutoIncrements), src/Tracking/Tracker.php::createVersion
 */
import { type ExportSql, structurePlugin } from '@bettermyadmin/export'
import type { Translator } from '@bettermyadmin/i18n'
import { Context } from '@bettermyadmin/sql-lexer'
import type { AppConfig, ServerConfig } from '../config.ts'
import { ServerExportDbi } from '../export/dbi.ts'
import type { TableReader } from './read.ts'

export interface TableDef {
  /** CREATE statement (no trailing semicolon: getTableDef(…, $addSemicolon = false)) */
  create: string
  /** `ALTER TABLE t\n  ADD CONSTRAINT …;\n` ('' when none) */
  constraints: string
  /** index ALTERs (null when none) */
  indexes: string | null
  /** AUTO_INCREMENT MODIFY (null when none) */
  autoIncrements: string | null
}

interface DefCtx {
  reader: TableReader
  cfg: AppConfig
  tr: Translator
  server: ServerConfig
}

/** Plugins::getPlugin('export', 'sql', ExportType::Table) + useSqlBackquotes(true) on the user link */
export function sqlStructurePlugin(ctx: DefCtx, autoIncrement = false): ExportSql {
  const conn = ctx.reader.conn
  return structurePlugin({
    dbi: new ServerExportDbi(conn, {
      disableIS: ctx.server.DisableIS,
      naturalOrder: ctx.cfg.NaturalOrder,
      databaseList: async () => [],
    }),
    tr: ctx.tr,
    parserContext: conn.serverInfo?.context ?? new Context(),
    settings: ctx.cfg.Export as unknown as Record<string, unknown>,
    autoIncrement,
  })
}

/** TableMover::moveCopy's structure: the CREATE statement and the deferred ALTERs */
export async function getTableDef(
  ctx: DefCtx,
  db: string,
  table: string,
  isView: boolean,
  autoIncrement: boolean,
): Promise<TableDef> {
  const plugin = sqlStructurePlugin(ctx, autoIncrement)
  const create = await plugin.getTableDef(db, table, false, isView)
  return {
    create,
    constraints: plugin.sqlConstraintsQuery,
    indexes: plugin.sqlIndexes,
    autoIncrements: plugin.sqlAutoIncrements,
  }
}
