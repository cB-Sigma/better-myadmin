import type { UiPrefsTableInfo } from '@bettermyadmin/metadata'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'
import type { MetaRequest } from './service.ts'

/** DbTableExists::selectDatabase on the user link (`USE db`); false when it fails. */
export function selectDatabase(conn: Conn, db: string): Promise<boolean> {
  return conn.selectDb(db, 'favorite.select-db')
}

/** Table::isView / getStatusInfo('CREATE_TIME') / getColumns(false) on the user link. */
export function tableInfo(m: MetaRequest, db: string, table: string): UiPrefsTableInfo {
  let status: Promise<{ view: boolean; createTime: string | null }> | null = null
  const load = () => {
    status ??= (async () => {
      const conn = await m.userConn()
      const view =
        db === 'information_schema' ||
        (await conn.value(
          `SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
          'table.is-view',
        )) !== null
      const createTime = await conn.value(
        `SELECT CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
        'table.create-time',
      )
      return { view, createTime }
    })()
    return status
  }
  return {
    isView: async () => (await load()).view,
    createTime: async () => (await load()).createTime,
    columns: async () => {
      const conn = await m.userConn()
      const rows = await conn
        .rows(`SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)}`, 'table.columns')
        .catch(() => [])
      return rows.map((r) => `${db}.${table}.${r.Field ?? ''}`)
    },
  }
}
