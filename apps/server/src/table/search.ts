/**
 * Table Search (query by example), Zoom search and Find and replace.
 *
 * pma: src/Controllers/Table/SearchController.php, ZoomSearchController.php, FindReplaceController.php,
 *      src/Table/Search.php, src/ConfigStorage/Relation.php::getForeignData/foreignDropdown/
 *      buildForeignDropdown, templates/table/search/input_box.twig
 */
import type {
  FindReplacePreviewResponse,
  FindReplaceRequest,
  FindReplaceResponse,
  RangeResponse,
  SearchCriterion,
  SearchPageResponse,
  SearchRequest,
  SearchResponse,
  ZoomRequest,
  ZoomResponse,
  ZoomRowRequest,
  ZoomRowResponse,
} from '@bettermyadmin/contracts'
import { getDisplayField, getForeigners, searchColumnInForeigners } from '@bettermyadmin/metadata'
import {
  displayOfOperator,
  extractColumnSpec,
  getFloatTypes,
  getIntegerRange,
  getIntegerTypes,
  getTypeClass,
  getTypeOperators,
  parseEnumSetValues,
  printableBitValue,
} from '@bettermyadmin/mysql-types'
import {
  GIS_DATA_TYPES,
  backquote,
  buildSearchQuery,
  escapeMysqlWildcards,
  getGisFunctions,
  getUniqueCondition,
} from '@bettermyadmin/sql-gen'
import type { z } from 'zod'
import { ValidationError } from '../http/errors.ts'
import { strnatcasecmp } from '../navigation/php.ts'
import { checkSqlSignature } from '../query/signature.ts'
import type { OpsCtx } from './operations.ts'

type Out<T extends z.ZodTypeAny> = z.output<T>

interface TableInfo {
  names: string[]
  types: string[]
  originalTypes: string[]
  nullable: boolean[]
  collations: string[]
  geom: boolean
}

/** pma: SearchController::loadTableInfo (types re-formatted like the form shows them) */
async function loadTableInfo(ctx: OpsCtx): Promise<TableInfo> {
  const cols = await ctx.reader.getColumns(ctx.db, ctx.table)
  const out: TableInfo = {
    names: [],
    types: [],
    originalTypes: [],
    nullable: [],
    collations: [],
    geom: false,
  }
  for (const c of cols) {
    out.names.push(c.Field)
    let type = c.Type
    out.originalTypes.push(type.toLowerCase())
    if (GIS_DATA_TYPES.includes(type)) out.geom = true
    if (/^set/i.test(type) || /^enum/i.test(type)) type = type.replaceAll(',', ', ')
    else {
      if (!/BINARY\(/i.test(type)) type = type.replace(/BINARY/gi, '')
      type = type
        .replace(/ZEROFILL/gi, '')
        .replace(/UNSIGNED/gi, '')
        .toLowerCase()
    }
    if (type === '') type = '&nbsp;'
    out.types.push(type)
    out.nullable.push(c.Null === 'YES')
    out.collations.push(
      c.Collation !== null && c.Collation !== '' && c.Collation !== 'NULL' ? c.Collation : '',
    )
  }
  return out
}

/** pma: Relation::getForeignData + foreignDropdown (dispRow → options; null = no dropdown) */
async function foreignOptions(
  ctx: OpsCtx,
  column: string,
  foreigners: Awaited<ReturnType<typeof getForeigners>> | null,
): Promise<Array<{ value: string; label: string }> | null | 'browse'> {
  if (foreigners === null) return null
  const f = searchColumnInForeigners(foreigners, column, ctx.db)
  if (f === false) return null
  const fdb = f.foreign_db
  const ftable = f.foreign_table ?? ''
  const ffield = f.foreign_field ?? ''
  const { reader, cfg } = ctx
  // Table::checkIfMinRecordsExist(ForeignKeyMaxLimit)
  const r = await reader.dbi.tryQuery(
    `SELECT * FROM ${backquote(fdb)}.${backquote(ftable)} LIMIT ${cfg.ForeignKeyMaxLimit}`,
  )
  if (r !== null && r.rows.length >= cfg.ForeignKeyMaxLimit) return 'browse'
  const rp = ctx.meta?.rp
  const display =
    rp === undefined
      ? ''
      : await getDisplayField(ctx.meta?.control ?? null, rp, fdb, ftable, async () =>
          (await reader.getColumns(fdb, ftable)).map((c) => ({ field: c.Field, type: c.Type })),
        )
  const sql = `SELECT ${backquote(ffield)}${display === '' ? '' : `, ${backquote(display)}`} FROM ${backquote(fdb)}.${backquote(ftable)}${display === '' ? '' : ` ORDER BY ${backquote(ftable)}.${backquote(display)}`}`
  const rows = await reader.dbi.tryQuery(sql)
  if (rows === null || rows.rows.length === 0) return 'browse'
  const foreign = new Map<string, string>()
  for (const row of rows.rows) foreign.set(row[0] ?? '', display === '' ? '' : (row[1] ?? ''))
  const build = (mode: string) => {
    const entries = [...foreign]
    if (mode === 'content-id')
      entries.sort((a, b) => (cfg.NaturalOrder ? strnatcasecmp(a[1], b[1]) : a[1] < b[1] ? -1 : 1))
    else entries.sort((a, b) => (cfg.NaturalOrder ? strnatcasecmp(a[0], b[0]) : a[0] < b[0] ? -1 : 1))
    return entries.map(([k, v]) => ({
      value: k,
      label: mode === 'content-id' ? `${v} - ${k}` : mode === 'id-content' ? `${k} - ${v}` : k,
    }))
  }
  const order = cfg.ForeignKeyDropdownOrder as string[]
  const opts: Array<{ value: string; label: string }> = [{ value: '', label: ' ' }]
  const top = display === '' ? build('id-only') : build(order[0] ?? 'content-id')
  if (top.length < cfg.ForeignKeyMaxLimit) {
    opts.push(...top)
    if (display !== '' && top.length > 0) opts.push({ value: '', label: ' ' })
  }
  if (display !== '' && order[1] !== undefined) opts.push(...build(order[1]))
  return opts
}

export async function searchPage(ctx: OpsCtx): Promise<SearchPageResponse> {
  const { reader, cfg, tr } = ctx
  const info = await loadTableInfo(ctx)
  const rp = ctx.meta?.rp
  const foreigners =
    rp === undefined
      ? null
      : await getForeigners(ctx.meta?.control ?? null, rp, ctx.db, ctx.table, '', () =>
          reader.showCreate(ctx.db, ctx.table),
        )
  const version = reader.server.version
  const columns: SearchPageResponse['columns'] = []
  for (const [i, name] of info.names.entries()) {
    const type = info.types[i] ?? ''
    const clean = type.replace(/\(.*/s, '')
    const isInt = getIntegerTypes().includes(clean)
    const isFloat = getFloatTypes().includes(clean)
    const operators = getTypeOperators(clean, info.nullable[i] ?? false).map((op) => ({
      value: op,
      label: displayOfOperator(op, (m) => tr.gettext(m)),
    }))
    let input: SearchPageResponse['columns'][number]['input']
    const foreign = await foreignOptions(ctx, name, foreigners)
    if (Array.isArray(foreign)) input = { kind: 'foreign', foreign }
    else if (foreign === 'browse') input = { kind: 'foreignLink' }
    else if (GIS_DATA_TYPES.includes(type)) input = { kind: 'gis' }
    else if (type.startsWith('enum')) input = { kind: 'enum', values: parseEnumSetValues(type, false) }
    else if (isInt || isFloat) {
      input = { kind: 'number' }
      if (isInt) {
        const spec = extractColumnSpec(info.originalTypes[i] ?? '')
        const [min, max] = getIntegerRange(clean, !spec.unsigned)
        input.min = min
        input.max = max
      }
    } else {
      let cls = 'textfield'
      if (type === 'date') cls += ' datefield'
      else if (type === 'datetime' || type.startsWith('timestamp')) cls += ' datetimefield'
      else if (type.startsWith('bit')) cls += ' bit'
      input = { kind: 'text', className: cls }
    }
    const col: SearchPageResponse['columns'][number] = {
      name,
      type,
      collation: info.collations[i] ?? '',
      nullable: info.nullable[i] ?? false,
      operators,
      dataType: isInt ? 'INT' : isFloat ? 'FLOAT' : clean.toUpperCase(),
      input,
    }
    if (info.geom && GIS_DATA_TYPES.includes(type)) {
      col.geomFunctions = getGisFunctions(type, true, true, version).map((f) => f.name)
    }
    columns.push(col)
  }
  const charColumns = info.names
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => getTypeClass((info.types[index] ?? '').split('(')[0] ?? '') === 'CHAR')
  return {
    columns,
    geomColumnFlag: info.geom,
    maxRows: cfg.MaxRows,
    maxPlotLimit: cfg.maxRowPlotLimit,
    slidersState: cfg.InitialSlidersState as 'open' | 'closed' | 'disabled',
    displayField:
      rp === undefined
        ? ''
        : await getDisplayField(ctx.meta?.control ?? null, rp, ctx.db, ctx.table, async () =>
            (await reader.getColumns(ctx.db, ctx.table)).map((c) => ({ field: c.Field, type: c.Type })),
          ),
    charColumns,
  }
}

const criteria = (cs: ReadonlyArray<Out<typeof SearchCriterion>>) =>
  cs.map((c) => ({ name: c.name, type: c.type, operator: c.operator, value: c.value, geomFunc: c.geomFunc }))

/** pma: SearchController::doSelectionAction — the query, signed for the /sql link */
export async function search(ctx: OpsCtx, req: Out<typeof SearchRequest>): Promise<SearchResponse> {
  const sql = buildSearchQuery({
    table: ctx.table,
    distinct: req.distinct,
    columns: req.columns,
    customWhere: req.customWhere,
    criteria: criteria(req.criteria),
    orderBy: req.orderBy,
    order: req.order,
    version: ctx.reader.server.version,
  })
  return { sql, sig: ctx.sign(sql) }
}

/** pma: SearchController::getColumnMinMax (range_search) */
export async function rangeSearch(ctx: OpsCtx, column: string): Promise<RangeResponse> {
  const rows = await ctx.reader.dbi.fetchResultSimple(
    `SELECT MIN(${backquote(column)}) AS \`min\`, MAX(${backquote(column)}) AS \`max\` FROM ${backquote(ctx.db)}.${backquote(ctx.table)}`,
  )
  return { min: rows[0]?.min ?? null, max: rows[0]?.max ?? null }
}

/** pma: ZoomSearchController::zoomSubmitAction */
export async function zoomSearch(ctx: OpsCtx, req: Out<typeof ZoomRequest>): Promise<ZoomResponse> {
  const { reader, tr } = ctx
  if (req.x === '' || req.y === '' || req.x === 'pma_null' || req.y === 'pma_null') {
    throw new ValidationError(tr.gettext('Select two columns'))
  }
  if (req.x === req.y) throw new ValidationError(tr.gettext('Select two different columns'))
  let dataLabel = req.dataLabel
  if (dataLabel === '' && ctx.meta !== null) {
    dataLabel = await getDisplayField(ctx.meta.control, ctx.meta.rp, ctx.db, ctx.table, async () =>
      (await reader.getColumns(ctx.db, ctx.table)).map((c) => ({ field: c.Field, type: c.Type })),
    )
  }
  const sql = `${buildSearchQuery({
    table: ctx.table,
    columns: null,
    criteria: criteria(req.criteria),
    version: reader.server.version,
  })} LIMIT ${req.maxPlotLimit}`
  await reader.selectDb(ctx.db)
  const r = await reader.conn.query(`${sql};`, 'zoom.search')
  const set = r.resultSets[0]
  const fields = set?.fields ?? []
  const meta = fields.map((f) => ({
    name: f.name,
    orgName: f.orgName,
    table: f.table,
    orgTable: f.orgTable,
    mappedType: f.mappedType as never,
    charsetNr: f.charsetNr,
    length: f.length,
    isPrimaryKey: f.flags.primaryKey,
    isUniqueKey: f.flags.uniqueKey,
    isNumeric: f.flags.numeric,
    isBinary: f.flags.binary,
    isMappedTypeBit: f.mappedType === 'bit',
    isMappedTypeGeometry: f.mappedType === 'geometry',
  }))
  const idx = (name: string) => fields.findIndex((f) => f.name === name)
  const xi = idx(req.x)
  const yi = idx(req.y)
  const li = dataLabel === '' ? -1 : idx(dataLabel)
  const text = (v: Buffer | null | undefined) => (v === null || v === undefined ? null : v.toString('utf8'))
  const points = (set?.rows ?? []).map((row) => {
    const cond = getUniqueCondition(
      meta,
      row.map((v) => (v === null ? null : new Uint8Array(v))),
      {
        forceUnique: true,
      },
    ).condition
    return {
      x: text(row[xi]),
      y: text(row[yi]),
      label: li < 0 ? '' : text(row[li]),
      whereClause: cond,
      sig: ctx.sign(cond),
    }
  })
  return { sql, dataLabel, points }
}

/** pma: ZoomSearchController::getDataRowAction (signed where clause) */
export async function zoomRow(
  ctx: OpsCtx,
  req: Out<typeof ZoomRowRequest>,
  hmac: string,
  blowfish: string,
): Promise<ZoomRowResponse> {
  if (!checkSqlSignature(req.whereClause, req.sig, hmac, blowfish)) return { row: null }
  const r = await ctx.reader.conn.query(
    `SELECT * FROM ${backquote(ctx.db)}.${backquote(ctx.table)} WHERE ${req.whereClause};`,
    'zoom.row',
  )
  const set = r.resultSets[0]
  let row: Record<string, string | null> | null = null
  for (const values of set?.rows ?? []) {
    row = {}
    set?.fields.forEach((f, i) => {
      const v = values[i]
      if (v === null || v === undefined) (row as Record<string, string | null>)[f.name] = null
      else if (f.mappedType === 'bit') {
        let n = 0n
        for (const b of v) n = (n << 8n) | BigInt(b)
        ;(row as Record<string, string | null>)[f.name] = printableBitValue(n, f.length)
      } else (row as Record<string, string | null>)[f.name] = v.toString('utf8')
    })
  }
  return { row }
}

// ---------------------------------------------------------------- find and replace

async function connectionCharset(ctx: OpsCtx): Promise<string> {
  return String((await ctx.reader.dbi.fetchValue('SELECT @@character_set_connection')) || '')
}

async function columnOf(ctx: OpsCtx, index: number): Promise<string> {
  const info = await loadTableInfo(ctx)
  const c = info.names[index]
  if (c === undefined) throw new ValidationError(ctx.tr.gettext('Invalid column.'))
  return c
}

/** PHP preg_replace with the first delimiter missing from the pattern; null = none fits */
function regexReplacer(find: string): ((s: string) => string) | null {
  for (const d of ['/', '@', '#', '~', '!', '$', '%', '^', '&', '_']) {
    if (find.includes(d)) continue
    let re: RegExp
    try {
      re = new RegExp(find, 'g')
    } catch {
      return () => ''
    }
    return (s: string) => s.replace(re, (...m) => phpReplacement(m))
  }
  return null
}

let replacementTemplate = ''
/** $n / \n / ${n} back references of preg_replace */
function phpReplacement(m: unknown[]): string {
  return replacementTemplate.replace(/\\\\|\$\{(\d\d?)\}|\$(\d\d?)|\\(\d\d?)/g, (all, a, b, c) => {
    if (all === '\\\\') return '\\'
    const n = Number(a ?? b ?? c)
    const v = m[n]
    return typeof v === 'string' ? v : ''
  })
}

/** pma: FindReplaceController::getRegexReplaceRows */
async function regexRows(
  ctx: OpsCtx,
  column: string,
  find: string,
  replaceWith: string,
  charset: string,
): Promise<Array<[string | null, string | null, string]> | null> {
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  const sql = `SELECT ${backquote(column)}, 1, COUNT(*) FROM ${backquote(ctx.db)}.${backquote(ctx.table)} WHERE ${backquote(column)} RLIKE ${q(find)} COLLATE ${charset}_bin GROUP BY ${backquote(column)} ORDER BY ${backquote(column)} ASC`
  const r = await ctx.reader.dbi.tryQuery(sql, 'find-replace.preview')
  const rows = (r?.rows ?? []).map((row): [string | null, string | null, string] => [
    row[0] ?? null,
    row[1] ?? null,
    row[2] ?? '',
  ])
  const replacer = regexReplacer(find)
  if (replacer === null) return null
  replacementTemplate = replaceWith
  return rows.map(([o, , c]) => [o, o === null ? null : replacer(o), c])
}

export async function findReplacePreview(
  ctx: OpsCtx,
  req: Out<typeof FindReplaceRequest>,
): Promise<FindReplacePreviewResponse> {
  const column = await columnOf(ctx, req.columnIndex)
  const charset = await connectionCharset(ctx)
  if (req.useRegex) {
    const rows = await regexRows(ctx, column, req.find, req.replaceWith, charset)
    return {
      rows: rows === null ? null : rows.map(([original, replaced, count]) => ({ original, replaced, count })),
    }
  }
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  const c = backquote(column)
  const sql = `SELECT ${c}, REPLACE(${c}, ${q(req.find)}, ${q(req.replaceWith)}), COUNT(*) FROM ${backquote(ctx.db)}.${backquote(ctx.table)} WHERE ${c} LIKE ${q(`%${escapeMysqlWildcards(req.find)}%`)} COLLATE ${charset}_bin GROUP BY ${c} ORDER BY ${c} ASC`
  const r = await ctx.reader.dbi.tryQuery(sql, 'find-replace.preview')
  return {
    rows: (r?.rows ?? []).map((row) => ({
      original: row[0] ?? null,
      replaced: row[1] ?? null,
      count: row[2] ?? '',
    })),
  }
}

/** pma: FindReplaceController::replace */
export async function findReplace(
  ctx: OpsCtx,
  req: Out<typeof FindReplaceRequest>,
): Promise<FindReplaceResponse> {
  const column = await columnOf(ctx, req.columnIndex)
  const charset = await connectionCharset(ctx)
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  const c = backquote(column)
  let sql: string
  if (req.useRegex) {
    const rows = await regexRows(ctx, column, req.find, req.replaceWith, charset)
    sql = `UPDATE ${backquote(ctx.table)} SET ${c}`
    if (rows !== null) {
      if (rows.length > 0) {
        sql += ' = CASE'
        for (const [o, n] of rows) sql += `\n WHEN ${c} = ${q(o ?? '')} THEN ${q(n ?? '')}`
        sql += ' END'
      } else sql += ` = ${c}`
    }
    sql += ` WHERE ${c} RLIKE ${q(req.find)} COLLATE ${charset}_bin`
  } else {
    sql = `UPDATE ${backquote(ctx.table)} SET ${c} = REPLACE(${c}, ${q(req.find)}, ${q(req.replaceWith)}) WHERE ${c} LIKE ${q(`%${escapeMysqlWildcards(req.find)}%`)} COLLATE ${charset}_bin`
  }
  await ctx.reader.conn.query(sql, 'find-replace.update')
  ctx.reader.invalidate()
  return {
    messages: [
      { type: 'success', text: ctx.tr.gettext('Your SQL query has been executed successfully.'), sql },
    ],
  }
}
