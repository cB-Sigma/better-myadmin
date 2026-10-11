import type { ExportRelation } from '@bettermyadmin/export'
import {
  type MetaConn,
  type RelationParameters,
  getForeignKeysData,
  getForeignersInternal,
  getMime,
  relationParametersToArray,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'

/**
 * The configuration storage as the export plugins see it (Relation / Transformations), reading
 * pmadb through the control link and SHOW CREATE TABLE through the user link.
 */
export function exportRelation(rp: RelationParameters, control: MetaConn | null, user: Conn): ExportRelation {
  const arr = relationParametersToArray(rp) as unknown as Record<string, unknown>
  const tables: Record<string, string | null> = {}
  for (const k of [
    'bookmark',
    'central_columns',
    'column_info',
    'export_templates',
    'pdf_pages',
    'relation',
    'savedsearches',
    'table_coords',
    'table_uiprefs',
    'tracking',
  ]) {
    const v = arr[k]
    tables[k] = typeof v === 'string' ? v : null
  }
  const conn = rp.db === null ? null : control
  return {
    pmadb: rp.db,
    relationFeature: rp.relationFeature !== null,
    browserTransformationFeature: rp.browserTransformationFeature !== null,
    pdfFeature:
      rp.pdfFeature === null
        ? null
        : { pdfPages: rp.pdfFeature.pdfPages, tableCoords: rp.pdfFeature.tableCoords },
    tables,
    getForeignersInternal: (db, table) => getForeignersInternal(conn, rp, db, table),
    async getForeignKeysData(db, table) {
      let create = ''
      try {
        const r = await user.query(`SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`, 'export.fk')
        create = r.resultSets[0]?.rows[0]?.[1]?.toString('utf8') ?? ''
      } catch {
        create = ''
      }
      return getForeignKeysData(create).map((k) => ({
        constraint: k.constraint ?? '',
        indexList: k.indexList,
        refDbName: k.refDbName,
        refTableName: k.refTableName ?? '',
        refIndexList: k.refIndexList,
        ...(k.onDelete !== null ? { onDelete: k.onDelete } : {}),
        ...(k.onUpdate !== null ? { onUpdate: k.onUpdate } : {}),
      }))
    },
    getMime: (db, table) => getMime(conn, rp, db, table, true),
  }
}
