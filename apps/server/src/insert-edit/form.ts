/**
 * The Insert/Edit form as data: one descriptor per column, one cell per (row, column) with the
 * widget phpMyAdmin would render and its pre-filled value.
 *
 * pma: src/Controllers/Table/ChangeController.php, src/InsertEdit.php (determineInsertOrEdit,
 *      getHtmlForInsertEditFormColumn, getValueColumnForOtherDatatypes, getColumnSize,
 *      getDefaultValueAndBackupFieldForExistingRow, getDefaultValue, getNullifyCodeForNullColumn),
 *      src/InsertEditColumn.php, resources/templates/table/insert/column_row.twig,
 *      value_column_for_other_datatype.twig, src/ConfigStorage/Relation.php::foreignDropdown
 */

import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ForeignOption,
  InsertCell,
  InsertColumn,
  InsertFormResponse,
  InsertRow,
  InsertWidget,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { formatByteDown, sprintf } from '@bettermyadmin/i18n'
import type { Foreigners, MimeInfo } from '@bettermyadmin/metadata'
import { searchColumnInForeigners } from '@bettermyadmin/metadata'
import {
  type ColumnMeta,
  type ProtectBinary,
  addMicroseconds,
  bitBytesToDecimalString,
  convertBitDefaultValue,
  extractColumnSpec,
  findTransformationPlugin,
  getDefaultFunctionForField,
  getFunctionCellKind,
  getFunctionsForField,
  getIntegerRange,
  getIntegerTypes,
  getTypeClass,
  inetNtop,
  isColumnOfType,
  isInputTransformation,
  longToIp,
  mbStrlen,
  parseTransformationOptions,
  php,
  printableBitValue,
  resolveDefaultFunctions,
  stripslashes,
} from '@bettermyadmin/mysql-types'
import { backquote, getUniqueCondition, isWhereClauseNumeric } from '@bettermyadmin/sql-gen'
import { phpCompareStrings, strnatcmpEx } from '../navigation/php.ts'
import {
  type ForeignData,
  type IeCtx,
  assoc,
  foreignersOf,
  getForeignData,
  md5,
  mimeMap,
  uniqueMeta,
  wrapperUrl,
} from './context.ts'

export const GIS_TYPES = [
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geometrycollection',
]

export interface FormRequest {
  /** where clauses (signature already verified), null = insert */
  whereClauses: string[] | null
  /** default_action=insert (Copy) */
  copy: boolean
  /** insert_rows ("Continue insertion" / after_insert=new_insert round trip) */
  insertRows?: number | undefined
  afterInsert?: string | undefined
  clauseIsUnique?: boolean | undefined
  /** rows that failed an input transformation: md5 → value, used as is */
  unsaved?: Array<Record<string, string | null>> | undefined
}

interface Col {
  meta: ColumnMeta
  field: string
  type: string
  trueType: string
  isNull: boolean
  key: string
  default: string | null
  extra: string
  length: number
  isBinary: boolean
  isBlob: boolean
  isChar: boolean
  md5: string
  firstTimestamp: boolean
}

/** pma: InsertEditColumn::__construct */
function insertEditColumn(c: ColumnMeta, columnLength: number, insertMode: boolean): Col {
  const isNull = c.Null === 'YES'
  const def =
    c.Type === 'datetime' && !isNull && c.Default === null && insertMode ? phpDate(new Date()) : c.Default
  const trueType = c.Type.replace(/(\(.*)|(\s\/.*)/s, '')
  const len = columnLength === -1 ? 30 : columnLength
  return {
    meta: c,
    field: c.Field,
    type: c.Type,
    trueType,
    isNull,
    key: c.Key,
    default: def,
    extra: c.Extra,
    length: /float|double/.test(c.Type) ? 100 : len,
    isBinary: isColumnOfType(c.Type, ['binary', 'varbinary']),
    isBlob: isColumnOfType(c.Type, ['blob', 'tinyblob', 'mediumblob', 'longblob']),
    isChar: isColumnOfType(c.Type, ['char', 'varchar']),
    md5: md5(c.Field),
    firstTimestamp: trueType === 'timestamp',
  }
}

/** date('Y-m-d H:i:s') */
function phpDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** InsertEditColumn::getFractionalSecondsPrecision */
function fsp(col: Col): number {
  if (!['timestamp', 'datetime', 'time'].includes(col.trueType)) return 0
  const m = /\((\d+)\)/.exec(col.type)
  return m === null ? 0 : Number(m[1])
}

/** InsertEditColumn::getDisplayType */
function displayType(col: Col): string {
  return col.trueType === 'set' || col.trueType === 'enum' ? col.trueType : col.type.replace(/\s\/.+/s, '')
}

const utf8 = new TextDecoder('utf-8')
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const text = (b: Buffer | null | undefined) => (b === null || b === undefined ? null : utf8.decode(b))

/** pma: Utils/Gis::convertToWellKnownText(value, includeSRID = true) */
async function convertToWkt(ctx: IeCtx, data: Buffer): Promise<string> {
  const hex = data.toString('hex')
  const s = ctx.reader.server
  const asText = s.version >= 50600 ? 'ST_ASTEXT' : 'ASTEXT'
  const srid = s.version >= 50600 ? 'ST_SRID' : 'SRID'
  const axis = s.version >= 80001 && s.vendor !== 'mariadb' ? ", 'axis-order=long-lat'" : ''
  const r = await ctx.conn.query(`SELECT ${asText}(x'${hex}'${axis}), ${srid}(x'${hex}')`, 'insert.wkt')
  const row = r.resultSets[0]?.rows[0]
  return `'${text(row?.[0]) ?? ''}',${text(row?.[1]) ?? ''}`
}

/** PHP mb_check_encoding UTF-8 + no control characters (Relation::buildForeignDropdown) */
function showAsText(b: Buffer): string | null {
  let s: string
  try {
    s = utf8Strict.decode(b)
  } catch {
    return null
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: phpMyAdmin's control-character test
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x80-\x9F]/u.test(s) ? null : s
}

/**
 * pma: Relation::foreignDropdown + buildForeignDropdown — the options and which one is selected
 * (the browser keeps the last `selected` option).
 */
export function foreignDropdown(
  ctx: IeCtx,
  fd: ForeignData,
  data: string,
): { options: ForeignOption[]; selected: number } {
  const max = ctx.cfg.ForeignKeyMaxLimit
  // $foreign[$key] = $value (later duplicates overwrite, keys keep first position)
  const foreign = new Map<string, { key: Buffer; value: Buffer }>()
  for (const r of fd.dispRow ?? []) {
    const key = r.key ?? Buffer.alloc(0)
    const value = fd.foreignDisplay !== '' ? (r.display ?? Buffer.alloc(0)) : Buffer.alloc(0)
    foreign.set(key.toString('latin1'), { key, value })
  }
  const order = ctx.cfg.ForeignKeyDropdownOrder as string[]
  const build = (mode: string) => buildForeignDropdown(ctx, [...foreign.values()], data, mode)
  let top: Array<ForeignOption & { selected: boolean }>
  let bottom: Array<ForeignOption & { selected: boolean }> = []
  if (fd.foreignDisplay !== '') {
    top = build(order[0] ?? 'content-id')
    if (order[1] !== undefined) bottom = build(order[1])
  } else {
    top = build('id-only')
  }
  const out: Array<ForeignOption & { selected: boolean }> = [{ value: '', label: ' ', selected: false }]
  if (max === -1 || top.length < max) {
    out.push(...top)
    if (fd.foreignDisplay !== '' && top.length > 0) out.push({ value: '', label: ' ', selected: false })
  }
  if (fd.foreignDisplay !== '') out.push(...bottom)
  let selected = -1
  out.forEach((o, i) => {
    if (o.selected) selected = i
  })
  return { options: out.map(({ value, label }) => ({ value, label })), selected }
}

function buildForeignDropdown(
  ctx: IeCtx,
  foreign: Array<{ key: Buffer; value: Buffer }>,
  data: string,
  mode: string,
): Array<ForeignOption & { selected: boolean }> {
  const natural = ctx.cfg.NaturalOrder
  const list = [...foreign]
  const str = (b: Buffer) => b.toString('utf8')
  if (mode === 'id-content' || mode === 'id-only') {
    list.sort((a, b) =>
      natural ? strnatcmpEx(str(a.key), str(b.key), true) : phpCompareStrings(str(a.key), str(b.key)),
    )
  } else if (mode === 'content-id') {
    list.sort((a, b) =>
      natural ? strnatcmpEx(str(a.value), str(b.value), true) : phpCompareStrings(str(a.value), str(b.value)),
    )
  }
  const limit = ctx.cfg.LimitChars
  return list.map(({ key: kb, value: vb }) => {
    let key = showAsText(kb)
    let selected: boolean
    if (key !== null) {
      selected = key === data
    } else {
      key = `0x${kb.toString('hex')}`
      selected = data.includes('0x') ? key === php.trim(data) : key === `0x${data}`
    }
    let value = showAsText(vb)
    if (value !== null) {
      if (mbStrlen(value) > limit) value = `${Array.from(value).slice(0, limit).join('')}...`
    } else {
      value = `0x${vb.toString('hex')}`
    }
    const label =
      mode === 'content-id' ? `${value} - ${key}` : mode === 'id-content' ? `${key} - ${value}` : key
    return { value: key, label, selected }
  })
}

/** pma: Util::userDir */
function userDir(user: string, dir: string): string {
  if (dir === '') return ''
  const d = dir.endsWith('/') ? dir : `${dir}/`
  return d.replaceAll('%u', user.replace(/[/\\]/g, ''))
}

/** pma: FileListing::getFileSelectOptions — false when the directory cannot be read */
export function uploadDirFiles(ctx: IeCtx): string[] | 'error' | null {
  if (ctx.cfg.UploadDir === '') return null
  const dir = userDir(ctx.user, ctx.cfg.UploadDir)
  try {
    return readdirSync(dir)
      .filter((f) => {
        try {
          return lstatSync(join(dir, f)).isFile()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return 'error'
  }
}

/** pma: InsertEdit::getMaxUploadSize → Util::getFormattedMaximumUploadSize */
function maxUploadSize(ctx: IeCtx, trueType: string): string {
  const cap =
    { tinyblob: 256, blob: 65536, mediumblob: 16777216, longblob: 4294967296 }[trueType] ?? 4294967296
  const [size, unit] = formatByteDown(ctx.tr, Math.min(ctx.cfg.MaxUploadSize, cap), 4) ?? ['0', '']
  return `(${sprintf(ctx.tr.gettext('Max: %s%s'), size, unit)})`
}

/** pma: InsertEdit::getNullifyCodeForNullColumn */
function nullifyCode(col: Col, foreigners: Foreigners, foreignLink: boolean, db: string): string {
  if (col.trueType === 'enum') return mbStrlen(col.type) > 20 ? '1' : '2'
  if (col.trueType === 'set') return '3'
  if (searchColumnInForeigners(foreigners, col.field, db) !== false) return foreignLink ? '6' : '4'
  return '5'
}

/** Fills the form (GET …/insert-form). */
export async function buildInsertForm(ctx: IeCtx, req: FormRequest): Promise<InsertFormResponse> {
  const { db, table, cfg, tr } = ctx
  const messages: SqlMessage[] = []
  let whereClauses = req.whereClauses
  let insertMode: boolean
  const rows: Array<Map<string, Buffer | null> | null> = []
  let fieldsMeta: Awaited<ReturnType<typeof ctx.conn.query>>['resultSets'][number]['fields'] = []
  let foundUniqueKey = false
  if (whereClauses !== null) {
    insertMode = false
    // pma: InsertEdit::analyzeWhereClauses
    for (const clause of whereClauses) {
      const sql = `SELECT * FROM ${backquote(db)}.${backquote(table)} WHERE ${clause};`
      const r = await ctx.conn.query(sql, 'insert.edit-row')
      const set = r.resultSets[0]
      if (set !== undefined && fieldsMeta.length === 0) fieldsMeta = set.fields
      const raw = set?.rows[0]
      if (set === undefined || raw === undefined) {
        messages.push({
          type: 'success',
          text: tr.gettext('MySQL returned an empty result set (i.e. zero rows).'),
          sql,
        })
        rows.push(new Map())
        continue
      }
      rows.push(assoc(set.fields, raw))
      if (getUniqueCondition(set.fields.map(uniqueMeta), raw, { forceUnique: true }).condition !== '') {
        foundUniqueKey = true
      }
    }
  } else {
    insertMode = true
    const r = await ctx.conn.query(
      `SELECT * FROM ${backquote(db)}.${backquote(table)} LIMIT 1;`,
      'insert.first-row',
    )
    fieldsMeta = r.resultSets[0]?.fields ?? []
    const n = req.insertRows !== undefined && req.insertRows >= 1 ? req.insertRows : cfg.InsertRows
    for (let i = 0; i < n; i++) rows.push(null)
  }
  if (req.copy) whereClauses = null
  const unsaved = req.unsaved ?? []
  while (unsaved.length > rows.length) rows.push(null)

  const tableColumns = await ctx.reader.getColumns(db, table)
  const commentsMap: Record<string, string> = {}
  if (cfg.ShowPropertyComments)
    for (const c of tableColumns) if (c.Comment !== '') commentsMap[c.Field] = c.Comment
  const foreigners = await foreignersOf(ctx)
  const mime = await mimeMap(ctx)
  const isUpload = true
  const hasBlob = tableColumns.some((c) =>
    isColumnOfType(c.Type, ['blob', 'tinyblob', 'mediumblob', 'longblob']),
  )
  const server = ctx.reader.server
  const functions = cfg.ShowFunctionFields
    ? getFunctionsForField(server, '', false, (s) => tr.gettext(s)).map(({ value, label, title }) =>
        title === undefined ? { value, label } : { value, label, title },
      )
    : []
  const defaultFunctions = resolveDefaultFunctions(cfg.DefaultFunctions as Record<string, unknown>)
  const foreignCache = new Map<string, ForeignData>()
  const uploadDir = uploadDirFiles(ctx)

  const columns: InsertColumn[] = []
  const outRows: InsertRow[] = rows.map((_, rowId) => ({
    whereClause: whereClauses?.[rowId]?.trim() ?? null,
    ignore: insertMode && rowId > 0 ? unsaved[rowId] === undefined : null,
    cells: [],
  }))
  const virtualExtras = ['VIRTUAL', 'PERSISTENT', 'VIRTUAL GENERATED', 'STORED GENERATED']

  for (let columnNumber = 0; columnNumber < tableColumns.length; columnNumber++) {
    const tc = tableColumns[columnNumber] as ColumnMeta
    if (virtualExtras.includes(tc.Extra)) continue
    const col = insertEditColumn(tc, fieldsMeta[columnNumber]?.length ?? 0, insertMode)
    const spec = extractColumnSpec(col.type, cfg.LimitChars)
    let fd = foreignCache.get(col.field)
    if (fd === undefined) {
      fd = await getForeignData(ctx, foreigners, col.field, false, '', '')
      foreignCache.set(col.field, fd)
    }
    const defaultFunction = cfg.ShowFunctionFields
      ? fd.foreignField !== null
        ? ''
        : getDefaultFunctionForField(
            {
              trueType: col.trueType,
              firstTimestamp: col.firstTimestamp,
              defaultValue: col.default,
              extra: col.extra,
              isNull: col.isNull,
              key: col.key,
              type: col.type,
              insertMode,
            },
            server,
            defaultFunctions,
          )
      : ''
    const functionCell = getFunctionCellKind(
      { trueType: col.trueType, isBinary: col.isBinary, isBlob: col.isBlob, isUpload },
      { showFunctionFields: cfg.ShowFunctionFields, protectBinary: cfg.ProtectBinary as ProtectBinary },
    )
    columns.push({
      field: col.field,
      columnNumber,
      md5: col.md5,
      type: col.type,
      trueType: col.trueType,
      displayType: displayType(col),
      isNull: col.isNull,
      key: col.key,
      extra: col.extra,
      comment: commentsMap[col.field] ?? null,
      decimals: fsp(col),
      functionCell,
      defaultFunction,
      nullifyCode: nullifyCode(col, foreigners, fd.foreignLink, db),
      isBlob: col.isBlob,
      isBinary: col.isBinary,
      isChar: col.isChar,
      upload: isUpload && col.isBlob ? { maxSize: maxUploadSize(ctx, col.trueType) } : null,
      uploadDir: col.isBinary || col.isBlob ? uploadDir : null,
    })
    for (let rowId = 0; rowId < rows.length; rowId++) {
      const cell = await buildCell(ctx, {
        col,
        spec,
        row: rows[rowId] ?? null,
        repopulate: unsaved[rowId],
        copy: req.copy,
        fd,
        mime: mime[col.field],
        whereClause: whereClauses?.[rowId] ?? '',
      })
      ;(outRows[rowId] as InsertRow).cells.push(cell)
    }
  }

  return {
    insertMode,
    columnCount: tableColumns.length,
    copy: req.copy,
    columns,
    rows: outRows,
    functions,
    showFunctionFields: cfg.ShowFunctionFields,
    showFieldTypes: cfg.ShowFieldTypesInDataEditView,
    messages,
    foundUniqueKey,
    isNumericWhere: isWhereClauseNumeric(whereClauses),
    clauseIsUnique: req.clauseIsUnique ?? false,
    insertRows: req.insertRows !== undefined && req.insertRows >= 1 ? req.insertRows : cfg.InsertRows,
    uploadEnabled: isUpload,
    hasBlob,
    afterInsert: req.afterInsert ?? 'back',
    firstDayOfCalendar: cfg.FirstDayOfCalendar,
  }
}

interface CellInput {
  col: Col
  spec: ReturnType<typeof extractColumnSpec>
  /** fetched row (editing), null when inserting */
  row: Map<string, Buffer | null> | null
  repopulate: Record<string, string | null> | undefined
  copy: boolean
  fd: ForeignData
  mime: MimeInfo | undefined
  whereClause: string
}

/** pma: InsertEdit::getHtmlForInsertEditFormColumn (the value cell of one row) */
async function buildCell(ctx: IeCtx, x: CellInput): Promise<InsertCell> {
  const { col, spec, cfg } = { ...x, cfg: ctx.cfg }
  const protectBinary = cfg.ProtectBinary as ProtectBinary
  let asIs = false
  let current: Buffer | string | null | undefined
  const editing = x.row !== null && x.row.size > 0
  if (x.row !== null) current = x.row.get(col.field)
  if (x.repopulate !== undefined && x.row !== null && x.row.size > 0) {
    current = x.repopulate[col.md5] ?? null
    asIs = true
  }
  let realNullValue: boolean
  let formatted: string
  let data: string
  let prev: string | null
  let rawForPlugin: Buffer | string = ''
  if (editing) {
    // pma: getDefaultValueAndBackupFieldForExistingRow
    data = ''
    let currentValue: string
    if (current === null || current === undefined) {
      realNullValue = true
      currentValue = ''
      formatted = ''
    } else {
      realNullValue = false
      rawForPlugin = current
      const asText = typeof current === 'string' ? current : utf8.decode(current)
      if (col.trueType === 'bit') {
        currentValue = asText
        formatted = asIs
          ? asText
          : printableBitValue(
              typeof current === 'string' ? current : bitBytesToDecimalString(current),
              Number.parseInt(spec.spec_in_brackets, 10) || 0,
            )
        if (!asIs && typeof current !== 'string') currentValue = bitBytesToDecimalString(current)
      } else if (['timestamp', 'datetime', 'time'].includes(col.trueType) && asText.includes('.')) {
        currentValue = asIs ? asText : addMicroseconds(asText)
        formatted = currentValue
      } else if (GIS_TYPES.includes(col.trueType)) {
        currentValue = asIs || typeof current === 'string' ? asText : await convertToWkt(ctx, current)
        formatted = currentValue
      } else {
        currentValue = asText
        if (col.isBinary || (col.isBlob && protectBinary !== 'all')) {
          currentValue = asIs
            ? asText
            : typeof current === 'string'
              ? php.bin2hex(current)
              : current.toString('hex')
        } else if (typeof current !== 'string' && (col.isBinary || col.isBlob)) {
          currentValue = current.toString('latin1')
        }
        formatted = currentValue
        data = currentValue
      }
    }
    if (x.copy && col.key === 'PRI' && col.extra.includes('auto_increment')) {
      data = ''
      formatted = ''
    }
    prev = currentValue
  } else {
    // pma: getDefaultValue
    const repop = x.repopulate?.[col.md5]
    const defaultValue = repop !== undefined ? repop : col.default
    realNullValue = defaultValue === null
    data = defaultValue ?? ''
    const dv = defaultValue ?? ''
    formatted =
      col.trueType === 'bit'
        ? convertBitDefaultValue(dv)
        : ['timestamp', 'datetime', 'time'].includes(col.trueType)
          ? addMicroseconds(dv)
          : col.trueType === 'binary' || col.trueType === 'varbinary'
            ? php.bin2hex(dv)
            : dv
    prev = null
  }

  const base = {
    value: formatted,
    data,
    isNull: realNullValue,
    nullPrev: realNullValue && !col.firstTimestamp,
    prev,
    fieldsType: '',
    autoIncrement: false,
    virtual: false,
  }

  // input transformation (IOTransformationsPlugin) replaces the whole widget
  const it = x.mime?.input_transformation ?? ''
  const plugin = it !== '' && isInputTransformation(it) ? (findTransformationPlugin(it)?.file ?? '') : ''
  // Regex Validation has no getInputHtml: the default widget stays
  if (plugin !== '' && plugin !== 'Input/Text_Plain_RegexValidation') {
    const options = parseTransformationOptions(x.mime?.input_transformation_options ?? '')
    // getInputHtml($columnNameAppendix, $options, $currentRow[$column->field] ?? '', ...)
    const raw = editing && current !== null && current !== undefined ? rawForPlugin : ''
    return { ...base, ...inputWidget(ctx, plugin, options, raw, x, col) }
  }

  const textareaRows = col.isChar
    ? Math.max(cfg.CharTextareaRows, 7)
    : cfg.LongtextDoubleTextarea && col.trueType === 'longtext'
      ? cfg.TextareaRows * 2
      : cfg.TextareaRows
  const textareaCols = col.isChar
    ? cfg.CharTextareaCols
    : cfg.LongtextDoubleTextarea && col.trueType === 'longtext'
      ? cfg.TextareaCols * 2
      : cfg.TextareaCols
  const typeClass = getTypeClass(col.trueType)

  if (x.fd.foreignLink) {
    return { ...base, fieldsType: 'foreign', widget: { kind: 'foreign-link' } }
  }
  if (x.fd.dispRow !== null) {
    const { options, selected } = foreignDropdown(ctx, x.fd, data)
    return {
      ...base,
      fieldsType: col.isBinary ? 'hex' : 'foreign',
      widget: { kind: 'foreign-select', options, selected },
    }
  }
  if (
    (cfg.LongtextDoubleTextarea && col.trueType.includes('longtext')) ||
    col.trueType.includes('json') ||
    col.trueType.includes('text')
  ) {
    return {
      ...base,
      widget: {
        kind: 'textarea',
        rows: textareaRows,
        cols: textareaCols,
        maxlength: col.isChar ? Number.parseInt(spec.spec_in_brackets, 10) || null : null,
        charField: col.isChar,
        dataType: typeClass,
        tooLong: col.trueType.includes('text') && mbStrlen(formatted) > 32000,
      },
    }
  }
  if (col.trueType === 'enum') {
    const values = spec.enum_set_values
    let selected = ''
    for (const v of values) {
      // $data == '' is a loose comparison: '0' == '' is false in PHP 8
      if (data === v || (data === '' && (!editing || !col.isNull) && v === col.default)) {
        selected = v
        break
      }
    }
    return {
      ...base,
      fieldsType: 'enum',
      widget:
        mbStrlen(col.type) > 20
          ? { kind: 'enum-select', values, selected }
          : { kind: 'enum-radio', values, selected },
    }
  }
  if (col.trueType === 'set') {
    const parts = data.split(',')
    return {
      ...base,
      fieldsType: 'set',
      widget: {
        kind: 'set',
        values: spec.enum_set_values,
        selected: spec.enum_set_values.filter((v) => parts.includes(v)),
        size: Math.min(4, spec.enum_set_values.length),
      },
    }
  }
  if (col.isBinary || col.isBlob) {
    const isProtected =
      (protectBinary === 'blob' && col.isBlob) ||
      protectBinary === 'all' ||
      (protectBinary === 'noblob' && !col.isBlob)
    if (isProtected) {
      const n = mbStrlen(stripslashes(data))
      const [size, unit] = formatByteDown(ctx.tr, n, 3, 1) ?? ['0', '']
      return {
        ...base,
        value: '',
        prev: null,
        fieldsType: 'protected',
        widget: { kind: 'protected', size, unit },
      }
    }
    if (col.isBlob || col.length > cfg.LimitChars) {
      return {
        ...base,
        fieldsType: 'hex',
        widget: { kind: 'hex-textarea', rows: textareaRows, cols: textareaCols },
      }
    }
    return {
      ...base,
      fieldsType: 'hex',
      widget: { kind: 'hex-input', size: Math.min(Math.max(col.length * 2, 4), cfg.LimitChars) },
    }
  }

  // pma: getValueColumnForOtherDatatypes
  const fieldsize = Math.min(
    Math.max(
      col.isChar ? Number.parseInt(spec.spec_in_brackets, 10) || 0 : col.length,
      cfg.MinSizeForInputField,
    ),
    cfg.MaxSizeForInputField,
  )
  const charTextarea =
    col.isChar &&
    (cfg.CharEditing === 'textarea' ||
      data.includes('\n') ||
      (Number.parseInt(spec.spec_in_brackets, 10) || 0) > cfg.MaxSizeForInputField)
  if (charTextarea) {
    return {
      ...base,
      widget: {
        kind: 'textarea',
        rows: cfg.CharTextareaRows,
        cols: cfg.CharTextareaCols,
        maxlength: Number.parseInt(spec.spec_in_brackets, 10) || null,
        charField: true,
        dataType: typeClass,
        tooLong: false,
      },
    }
  }
  const isInteger = getIntegerTypes().includes(col.trueType)
  const range = isInteger ? getIntegerRange(col.trueType, !spec.unsigned) : null
  const hidden = {
    virtual: /(VIRTUAL|PERSISTENT|GENERATED)/.test(col.extra) && !col.extra.includes('DEFAULT_GENERATED'),
    autoIncrement: col.extra === 'auto_increment',
    fieldsType: ['bit', 'uuid', 'timestamp', 'datetime', 'date'].includes(col.trueType) ? col.trueType : '',
  }
  if (GIS_TYPES.includes(col.trueType)) {
    return { ...base, ...hidden, widget: { kind: 'gis', size: fieldsize } }
  }
  const widget: InsertWidget = {
    kind: 'text',
    size: fieldsize,
    maxlength: col.isChar ? fieldsize : null,
    min: range?.[0] ?? null,
    max: range?.[1] ?? null,
    dataType: isInteger ? 'INT' : typeClass,
    picker:
      col.trueType === 'date'
        ? 'date'
        : col.trueType === 'time'
          ? 'time'
          : col.trueType === 'datetime' || col.trueType === 'timestamp'
            ? 'datetime'
            : null,
  }
  return { ...base, ...hidden, widget }
}

/** IOTransformationsPlugin::getInputHtml of each input plugin, as widget data. */
function inputWidget(
  ctx: IeCtx,
  plugin: string,
  options: string[],
  raw: Buffer | string,
  x: CellInput,
  col: Col,
): Pick<InsertCell, 'widget' | 'prev' | 'value'> {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
  const asText = utf8.decode(bytes)
  const mk = (prev: string | null, value: string, imageSrc: string | null = null) => ({
    prev,
    value,
    widget: { kind: 'transformed' as const, plugin, options, prev, value, imageSrc },
  })
  switch (plugin) {
    case 'Input/Image_JPEG_Upload': {
      if (bytes.length === 0) return mk(null, '')
      const hex = bytes.toString('hex')
      return mk(hex, hex, wrapperUrl(ctx, col.field, x.whereClause))
    }
    case 'Input/Text_Plain_FileUpload':
      return bytes.length === 0 ? mk(null, '') : mk(asText, asText)
    case 'Input/Text_Plain_Iptobinary': {
      let val = ''
      if (bytes.length > 0) {
        if (bytes.length === 4 || bytes.length === 16) {
          const ip = inetNtop(new Uint8Array(bytes))
          if (ip !== false) val = ip
        }
        return mk(val, val)
      }
      return mk(null, '')
    }
    case 'Input/Text_Plain_Iptolong': {
      if (asText === '') return mk(null, '')
      const val = longToIp(asText)
      return mk(asText !== val ? val : null, val)
    }
    default:
      // JSON / SQL / XML CodeMirror editors; Regex validation keeps the default textarea-like editor
      return mk(asText !== '' ? asText : null, asText)
  }
}
