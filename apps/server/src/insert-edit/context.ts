import { createHash } from 'node:crypto'
import type { Translator } from '@bettermyadmin/i18n'
import {
  type ForeignColumn,
  type Foreigners,
  type InternalRelation,
  type MimeInfo,
  type RelationParameters,
  getDisplayField,
  getForeigners,
  getMime,
  searchColumnInForeigners,
} from '@bettermyadmin/metadata'
import { type ColumnMeta, type ServerInfo, getTypeClass } from '@bettermyadmin/mysql-types'
import { type UniqueFieldMeta, backquote } from '@bettermyadmin/sql-gen'
import type { Field } from '@bettermyadmin/contracts'
import type { AppConfig } from '../config.ts'
import type { Conn, RawRow } from '../db/connection.ts'
import type { MetaRequest } from '../metadata/service.ts'
import { signSql } from '../query/signature.ts'
import type { TableReader } from '../table/read.ts'

/**
 * What every Insert/Edit request works with: the user's connection (through the table reader), the
 * settings with the user's preferences applied, the configuration storage and the signing secret.
 */
export interface IeCtx {
  reader: TableReader
  conn: Conn
  cfg: AppConfig
  tr: Translator
  db: string
  table: string
  meta: MetaRequest
  rp: RelationParameters
  /** the logged-in MySQL user (UploadDir %u) */
  user: string
  hmacSecret: string
  /** `/api/servers/:s/databases/:db/tables/:t` (wrapper links) */
  apiBase: string
}

/** /transformation/wrapper URL of one cell (WrapperController parameters). */
export function wrapperUrl(ctx: IeCtx, key: string, whereClause: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ key, where: whereClause, sig: sign(ctx, whereClause), ...extra })
  return `${ctx.apiBase}/transformation/wrapper?${p}`
}

export const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

export const sign = (ctx: IeCtx, sql: string) => signSql(sql, ctx.hmacSecret, ctx.cfg.blowfish_secret)

export function serverOf(ctx: IeCtx): ServerInfo {
  return ctx.reader.server
}

/** mysql2 field → the subset UniqueCondition needs */
export function uniqueMeta(f: Field): UniqueFieldMeta {
  return {
    name: f.name,
    orgName: f.orgName,
    table: f.table,
    orgTable: f.orgTable,
    mappedType: f.mappedType as UniqueFieldMeta['mappedType'],
    charsetNr: f.charsetNr,
    length: f.length,
    isPrimaryKey: f.flags.primaryKey,
    isUniqueKey: f.flags.uniqueKey,
    isNumeric: f.flags.numeric,
    isBinary: f.flags.binary,
    isMappedTypeBit: f.mappedType === 'bit',
    isMappedTypeGeometry: f.mappedType === 'geometry',
  }
}

/** A raw row as phpMyAdmin's fetchAssoc: column name → bytes. */
export function assoc(fields: Field[], row: RawRow): Map<string, Buffer | null> {
  const m = new Map<string, Buffer | null>()
  fields.forEach((f, i) => m.set(f.name, row[i] ?? null))
  return m
}

/** pma: Transformations::getMime (control link) */
export async function mimeMap(ctx: IeCtx): Promise<Record<string, MimeInfo>> {
  if (ctx.rp.browserTransformationFeature === null) return {}
  return (await getMime(ctx.meta.control, ctx.rp, ctx.db, ctx.table)) ?? {}
}

/** pma: Relation::getForeigners(db, table) */
export async function foreignersOf(ctx: IeCtx): Promise<Foreigners> {
  return getForeigners(ctx.rp.db === null ? null : ctx.meta.control, ctx.rp, ctx.db, ctx.table, '', () =>
    ctx.reader.showCreate(ctx.db, ctx.table),
  )
}

export interface ForeignData {
  foreignLink: boolean
  theTotal: number
  foreignDisplay: string
  /** rows of the foreign table: [key, display] as raw bytes */
  dispRow: Array<{ key: Buffer | null; display: Buffer | null }> | null
  foreignField: string | null
}

const isForeignEmpty = (f: Foreigners) => Object.keys(f.data).length === 0 && f.keysData.length === 0

/**
 * pma: src/ConfigStorage/Relation.php::getForeignData (+ Table::checkIfMinRecordsExist)
 */
export async function getForeignData(
  ctx: IeCtx,
  foreigners: Foreigners,
  field: string,
  overrideTotal: boolean,
  foreignFilter: string,
  foreignLimit: string,
  getTotal = false,
): Promise<ForeignData> {
  let foreignLink = false
  let dispRow: ForeignData['dispRow'] = null
  let foreignDisplay = ''
  let theTotal = 0
  let foreignField: string | null = null
  let fdb: string | null = null
  let ftable: string | null = null
  const dbi = ctx.reader.dbi
  do {
    if (isForeignEmpty(foreigners)) break
    const foreigner: InternalRelation | ForeignColumn | false = searchColumnInForeigners(foreigners, field, ctx.db)
    if (foreigner === false) break
    fdb = foreigner.foreign_db
    ftable = foreigner.foreign_table ?? ''
    foreignField = foreigner.foreign_field ?? ''
    const moreThanLimit = await checkIfMinRecordsExist(ctx, fdb, ftable, ctx.cfg.ForeignKeyMaxLimit)
    if (overrideTotal || !moreThanLimit) {
      foreignDisplay = await getDisplayField(
        ctx.rp.displayFeature === null ? null : ctx.meta.control,
        ctx.rp,
        fdb,
        ftable,
        async () =>
          (await ctx.reader.getColumns(fdb as string, ftable as string)).map((c: ColumnMeta) => ({
            field: c.Field,
            type: c.Type,
          })),
      )
      const main = `SELECT ${backquote(foreignField)}${foreignDisplay === '' ? '' : `, ${backquote(foreignDisplay)}`}`
      const from = ` FROM ${backquote(fdb)}.${backquote(ftable)}`
      const like = (s: string) => dbi.quoteString(`%${escapeMysqlWildcards(s)}%`)
      const filter =
        foreignFilter === ''
          ? ''
          : ` WHERE ${backquote(foreignField)} LIKE ${like(foreignFilter)}${foreignDisplay === '' ? '' : ` OR ${backquote(foreignDisplay)} LIKE ${like(foreignFilter)}`}`
      const order = foreignDisplay === '' ? '' : ` ORDER BY ${backquote(ftable)}.${backquote(foreignDisplay)}`
      if (foreignFilter !== '') {
        theTotal = Number((await dbi.fetchValue(`SELECT COUNT(*)${from}${filter}`)) || 0)
      }
      let r: Awaited<ReturnType<Conn['query']>> | null = null
      try {
        r = await ctx.conn.query(main + from + filter + order + foreignLimit, 'insert.foreign')
      } catch {
        r = null
      }
      const set = r?.resultSets[0]
      if (set !== undefined && set.rows.length > 0) {
        dispRow = set.rows.map((row) => ({ key: row[0] ?? null, display: foreignDisplay === '' ? null : (row[1] ?? null) }))
      } else {
        dispRow = null
        foreignLink = true
      }
    } else {
      dispRow = null
      foreignLink = true
    }
  } while (false)
  if (getTotal && fdb !== null && ftable !== null) {
    theTotal = await countRecordsExact(ctx, fdb, ftable)
  }
  return { foreignLink, theTotal, foreignDisplay, dispRow, foreignField }
}

function escapeMysqlWildcards(s: string): string {
  return s.replaceAll('_', '\\_').replaceAll('%', '\\%')
}

/** pma: Table::checkIfMinRecordsExist */
async function checkIfMinRecordsExist(ctx: IeCtx, db: string, table: string, min: number): Promise<boolean> {
  let cols: string[] = []
  try {
    const indexes = await ctx.reader.getIndexes(db, table)
    // getUniqueColumns(true, false): single-column unique indexes
    for (const idx of indexes) {
      if (idx.nonUnique || idx.columns.length > 1) continue
      const c = backquote(idx.columns[0]?.name ?? '')
      if (!cols.includes(c)) cols.push(c)
    }
    if (cols.length === 0) {
      // getIndexedColumns(true, false)
      const seen: string[] = []
      for (const idx of indexes) for (const c of idx.columns) if (!seen.includes(c.name)) seen.push(c.name)
      cols = seen.map((c) => backquote(c))
    }
  } catch {
    cols = []
  }
  const sql = `SELECT ${cols.length > 0 ? cols.join(', ') : '*'} FROM ${backquote(db)}.${backquote(table)} LIMIT ${min}`
  try {
    const r = await ctx.conn.query(sql, 'insert.foreign-count')
    return (r.resultSets[0]?.rows.length ?? 0) >= min
  } catch {
    return false
  }
}

/** pma: Table::countRecords(forceExact = true) */
async function countRecordsExact(ctx: IeCtx, db: string, table: string): Promise<number> {
  if (await ctx.reader.isView(db, table)) {
    const max = ctx.cfg.MaxExactCountViews
    if (max === 0) return -1
    const r = await ctx.reader.dbi.tryQuery(`SELECT 1 FROM ${backquote(db)}.${backquote(table)} LIMIT ${max}`)
    const n = r?.rows.length ?? 0
    return n === max ? -1 : n
  }
  return Number((await ctx.reader.dbi.fetchValue(`SELECT COUNT(*) FROM ${backquote(db)}.${backquote(table)}`)) || 0)
}

export const typeClassOf = (trueType: string) => getTypeClass(trueType)
