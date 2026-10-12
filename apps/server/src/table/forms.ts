/**
 * Form payloads: column definition form options, the change form of existing columns, the index
 * editor and the partition editor, pre-filled the way phpMyAdmin renders them.
 *
 * pma: src/Table/ColumnsDefinition.php::displayForm, src/Controllers/Table/IndexesController.php::displayForm,
 *      src/Controllers/Table/Structure/PartitioningController.php::extractPartitionDetails
 */

import type {
  ChangeFormResponse,
  ColumnFormOptions,
  ColumnMime as ColumnMimeIn,
  IndexFormResponse,
  PartitionDefT,
  PartitionFormResponse,
} from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import { type MimeInfo, getMime } from '@bettermyadmin/metadata'
import {
  type ColumnMeta,
  type TransformationPlugin,
  columnFormRow,
  getAttributes,
  getAvailableMimeTypes,
  getDatatypeOptions,
  getDefaultTypeOptions,
  getVirtualityOptions,
  isIntegersLengthRestricted,
} from '@bettermyadmin/mysql-types'
import { indexInputFromTableIndex } from '@bettermyadmin/sql-gen'
import {
  CreateStatement,
  type OptionsArray,
  Parser,
  type PartitionDefinition,
} from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import type { OpsMeta } from './operations.ts'
import type { TableReader } from './read.ts'
import { type StructureFeatures, structureFeatures } from './structure-page.ts'

type MimeValues = { [K in keyof ColumnMimeIn]-?: string }

/** Option lists of the column definition form (ColumnsDefinition::displayForm template data). */
export async function columnFormOptions(
  reader: TableReader,
  cfg: AppConfig,
  tr: Translator,
  db: string,
  table: string,
  {
    withPrivileges = false,
    features: given,
    meta,
  }: {
    withPrivileges?: boolean
    features?: StructureFeatures | undefined
    meta?: OpsMeta | null | undefined
  } = {},
): Promise<ColumnFormOptions> {
  const server = reader.server
  const charsets = await reader.getCharsets()
  const collations = await reader.getCollations()
  let privsAvailable = false
  if (withPrivileges) {
    const p = await getPrivileges(reader.dbi)
    privsAvailable = p.column && p.isReload
  }
  const features = await structureFeatures(db, table, given)
  return {
    server,
    types: getDatatypeOptions(server, '', (s) => tr.gettext(s)).map((o) =>
      'separator' in o
        ? { separator: true as const, group: o.group }
        : { group: o.group, type: o.type, description: o.description, lengthRestricted: o.lengthRestricted },
    ),
    attributes: getAttributes(server),
    defaultTypes: getDefaultTypeOptions(server),
    virtuality: getVirtualityOptions(server),
    charsets: charsets.map((c) => ({
      name: c.name,
      description: c.description,
      collations: [...(collations.get(c.name)?.values() ?? [])],
    })),
    engines: await reader.getEngineOptions(),
    havePartitioning: await reader.havePartitioning(),
    integersLengthRestricted: isIntegersLengthRestricted(server),
    commentMaxLength: server.version >= 50503 ? 1024 : 255,
    privsAvailable,
    charEditing: cfg.CharEditing,
    centralColumns: features.centralColumns,
    maxRows: cfg.MaxRows,
    mime: showMime(cfg, meta),
    mimeTypes: showMime(cfg, meta) ? mimeTypeOptions(tr) : null,
  }
}

/**
 * column_attributes.twig: the MIME columns need the browser transformation and column comments
 * features and $cfg['BrowseMIME'].
 */
function showMime(cfg: AppConfig, meta: OpsMeta | null | undefined): boolean {
  const rp = meta?.rp ?? null
  return cfg.BrowseMIME && rp?.browserTransformationFeature != null && rp.columnCommentsFeature !== null
}

/** Transformations::getAvailableMimeTypes as the column form's selects list it */
function mimeTypeOptions(tr: Translator): NonNullable<ColumnFormOptions['mimeTypes']> {
  const available = getAvailableMimeTypes()
  // `get_name(file) ~ ' (' ~ parts[0]|lower ~ ':' ~ parts[1] ~ ')'` of "Text/Plain: Dateformat"
  const option = (p: TransformationPlugin) => ({
    value: `${p.file}.php`,
    label: `${p.name} (${p.mimetype.toLowerCase()}: ${p.label})`,
    title: tr.gettext(p.info),
  })
  return {
    mimetypes: available.mimetype.map((m) => ({ value: m.replace('/', '_'), label: m.toLowerCase() })),
    transformations: available.transformation.map(option),
    inputTransformations: available.input_transformation.map(option),
  }
}

/**
 * The stored settings of a column as the form selects them: `mime_map[field]` (getMime), the
 * transformation options matched case-insensitively against the plugin files (`'@' ~ file ~ '3?@i'`).
 */
function columnMime(
  map: Record<string, MimeInfo>,
  field: string,
  options: NonNullable<ColumnFormOptions['mimeTypes']>,
): MimeValues {
  const m = map[field]
  const pick = (stored: string | undefined, list: Array<{ value: string }>) => {
    if (stored === undefined || stored === '') return ''
    const re = (v: string) => new RegExp(`${v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}3?`, 'i')
    // the last matching option is the one the browser shows selected
    let found = ''
    for (const o of list) if (re(o.value).test(stored)) found = o.value
    return found
  }
  return {
    mimetype: options.mimetypes.some((o) => o.value === m?.mimetype) ? (m?.mimetype ?? '') : '',
    transformation: pick(m?.transformation, options.transformations),
    transformationOptions: m?.transformation_options ?? '',
    inputTransformation: pick(m?.input_transformation, options.inputTransformations),
    inputTransformationOptions: m?.input_transformation_options ?? '',
  }
}

/**
 * The change form of the selected columns, in table order.
 *
 * pma: src/Controllers/Table/Structure/ChangeController.php::displayHtmlForColumnChange
 */
export async function changeForm(
  reader: TableReader,
  cfg: AppConfig,
  tr: Translator,
  db: string,
  table: string,
  selected: readonly string[],
  features?: StructureFeatures,
  meta?: OpsMeta | null,
): Promise<ChangeFormResponse> {
  const all = await reader.getColumns(db, table)
  const metas: ColumnMeta[] = all.filter((c) => selected.includes(c.Field))
  for (const meta of metas) {
    if (['VIRTUAL', 'PERSISTENT', 'VIRTUAL GENERATED', 'STORED GENERATED'].includes(meta.Extra)) {
      const expressions = await reader.getGenerationExpressions(db, table, meta.Field)
      meta.Expression = expressions.get(meta.Field) ?? null
    }
  }
  const options = await columnFormOptions(reader, cfg, tr, db, table, {
    withPrivileges: true,
    features,
    meta,
  })
  // ColumnsDefinition::displayForm: $mimeMap = getMime(db, table) when BrowseMIME
  const mimeMap =
    options.mimeTypes !== null && meta != null
      ? ((await getMime(meta.control, meta.rp, db, table)) ?? {})
      : {}
  const names = all.map((c) => c.Field)
  return {
    options,
    columns: metas.map((meta) => {
      const { values, orig } = columnFormRow(meta, reader.server)
      const found = names.indexOf(meta.Field)
      const current = found < 0 ? 0 : found
      return {
        values,
        mime: options.mimeTypes === null ? null : columnMime(mimeMap, meta.Field, options.mimeTypes),
        orig,
        moveOptions: [
          { value: '', after: null, disabled: false },
          { value: '-first', after: null, disabled: current === 0 },
          ...names.map((n, i) => ({ value: n, after: n, disabled: current === i || current === i + 1 })),
        ],
      }
    }),
  }
}

/**
 * The index editor form: an existing index (`index`) or a new one on `create` columns (1..16).
 *
 * pma: src/Controllers/Table/IndexesController.php::__invoke (no do_save_data), ::displayForm,
 *      resources/templates/table/index_form.twig
 */
export async function indexForm(
  reader: TableReader,
  cfg: AppConfig,
  db: string,
  table: string,
  q: { index?: string | undefined; create?: number | undefined; primary?: boolean | undefined },
): Promise<IndexFormResponse> {
  const indexes = await reader.getIndexes(db, table)
  const hasPrimary = indexes.some((i) => i.name === 'PRIMARY')
  const fields = await reader.getNameAndTypeOfTheColumns(db, table)
  const existing = q.index !== undefined ? indexes.find((i) => i.name === q.index) : undefined
  let addFields = 0
  let index: IndexFormResponse['index']
  if (q.index !== undefined) {
    if (existing !== undefined) {
      const input = indexInputFromTableIndex(existing)
      index = {
        name: input.name,
        choice: existing.choice,
        // the form shows Key_block_size 0, which posts back as "0" (no KEY_BLOCK_SIZE)
        keyBlockSize: '0',
        type: existing.type === 'BTREE' || existing.type === 'HASH' ? existing.type : '',
        parser: '',
        comment: existing.comment,
        columns: existing.columns.map((c) => ({
          name: c.name,
          // index_form.twig: size only for non-SPATIAL indexes; the A/D option of the collation is selected
          subPart: existing.choice !== 'SPATIAL' && c.subPart !== null ? String(c.subPart) : '',
          collation: c.collation === 'A' || c.collation === 'D' ? c.collation : '',
        })),
      }
    } else {
      // Index::singleton with an unknown name: a new Index (Non_unique false → UNIQUE) of that name
      index = {
        name: q.index,
        choice: 'UNIQUE',
        keyBlockSize: '0',
        type: '',
        parser: '',
        comment: '',
        columns: [],
      }
    }
  } else if (q.primary === true) {
    // normalization.js #createPrimaryKey: index[Key_name]=PRIMARY + add_fields=1&added_fields=1
    // → new Index(['Key_name' => 'PRIMARY']) (choice PRIMARY), one column row
    addFields = 1
    index = {
      name: 'PRIMARY',
      choice: 'PRIMARY',
      keyBlockSize: '0',
      type: '',
      parser: '',
      comment: '',
      columns: [],
    }
  } else {
    // In most cases an index may consist of up to 16 columns
    addFields = q.create !== undefined && q.create >= 2 ? Math.min(Math.trunc(q.create), 16) : 1
    // `new Index()`: Non_unique defaults to false, so Index::set() makes the choice UNIQUE
    index = { name: '', choice: 'UNIQUE', keyBlockSize: '0', type: '', parser: '', comment: '', columns: [] }
  }
  // new rows preselect the i-th column (index_form.twig `j == i`)
  for (let i = 1; i <= addFields; i++) {
    index.columns.push({ name: fields[i - 1]?.[0] ?? '', subPart: '', collation: '' })
  }
  return {
    index,
    oldIndex: q.index ?? null,
    // Index::hasPrimary() looks up the index's own schema/table, which a new Index does not have:
    // the PRIMARY option is then always offered
    primaryAllowed: index.choice === 'PRIMARY' || existing === undefined || !hasPrimary,
    fields,
    addFields,
    sliders: cfg.InitialSlidersState,
  }
}

const optionString = (opts: OptionsArray | null, key: string): string => {
  if (opts === null) return ''
  const v = opts.get(key, true)
  return v === null || v === undefined ? '' : String(v)
}
const trimQuote = (s: string) => s.replace(/^'+|'+$/g, '')
const RANGE_LIST = ['RANGE', 'RANGE COLUMNS', 'LIST', 'LIST COLUMNS']

/**
 * The "Edit partitioning" form pre-filled from SHOW CREATE TABLE.
 *
 * pma: src/Controllers/Table/Structure/PartitioningController.php::extractPartitionDetails
 */
export async function partitionForm(
  reader: TableReader,
  db: string,
  table: string,
): Promise<PartitionFormResponse> {
  const engines = await reader.getEngineOptions()
  const create = await reader.showCreate(db, table)
  const empty = {
    partitionBy: '',
    partitionExpr: '',
    partitionCount: '',
    subpartitionBy: '',
    subpartitionExpr: '',
    subpartitionCount: '',
    partitions: [] as PartitionDefT[],
  }
  if (create === '') return { partitioning: empty, canHaveSubpartitions: false, valueEnabled: false, engines }
  const ctx = reader.conn.serverInfo?.context
  const stmt = new Parser(create, ctx !== undefined ? { context: ctx } : {}).statements[0]
  if (!(stmt instanceof CreateStatement)) {
    return { partitioning: empty, canHaveSubpartitions: false, valueEnabled: false, engines }
  }
  let partitionBy = ''
  let partitionExpr = ''
  let partitionCount = 0
  const statementPartitions = stmt.partitions ?? []
  if (stmt.partitionBy !== null && stmt.partitionBy !== '') {
    const open = stmt.partitionBy.indexOf('(')
    const close = stmt.partitionBy.lastIndexOf(')')
    if (open >= 0 && close >= 0) {
      partitionBy = stmt.partitionBy.slice(0, open).trim()
      partitionExpr = stmt.partitionBy.slice(open + 1, close).trim()
      partitionCount =
        stmt.partitionsNum !== null && stmt.partitionsNum !== undefined
          ? Number(stmt.partitionsNum)
          : statementPartitions.length
    }
  }
  let subBy = ''
  let subExpr = ''
  let subCount = 0
  if (stmt.subpartitionBy !== null && stmt.subpartitionBy !== '' && stmt.subpartitionBy !== '0') {
    const open = stmt.subpartitionBy.indexOf('(')
    const close = stmt.subpartitionBy.lastIndexOf(')')
    if (open >= 0 && close >= 0) {
      subBy = stmt.subpartitionBy.slice(0, open).trim()
      subExpr = stmt.subpartitionBy.slice(open + 1, close).trim()
      subCount =
        stmt.subpartitionsNum !== null && stmt.subpartitionsNum !== undefined
          ? Number(stmt.subpartitionsNum)
          : (statementPartitions[0]?.subpartitions?.length ?? 0)
    }
  }
  const canHaveSubpartitions = partitionCount > 1 && RANGE_LIST.includes(partitionBy)
  const valueEnabled = RANGE_LIST.includes(partitionBy)
  const engineName = (e: string) => engines.find((x) => x.name.toLowerCase() === e.toLowerCase())?.name ?? ''
  const options = (p: PartitionDefinition | undefined) => ({
    engine: engineName(optionString(p?.options ?? null, 'ENGINE')),
    comment: trimQuote(optionString(p?.options ?? null, 'COMMENT')),
    dataDirectory: trimQuote(optionString(p?.options ?? null, 'DATA DIRECTORY')),
    indexDirectory: trimQuote(optionString(p?.options ?? null, 'INDEX_DIRECTORY')),
    maxRows: optionString(p?.options ?? null, 'MAX_ROWS'),
    minRows: optionString(p?.options ?? null, 'MIN_ROWS'),
    tablespace: optionString(p?.options ?? null, 'TABLESPACE'),
    nodeGroup: optionString(p?.options ?? null, 'NODEGROUP'),
  })
  const partitions: PartitionDefT[] = []
  for (let i = 0; i < partitionCount; i++) {
    const p = statementPartitions[i]
    let valueType = ''
    let value = ''
    let name = `p${i}`
    if (p !== undefined) {
      name = p.name ?? ''
      valueType = p.type === null || p.type === undefined ? '' : String(p.type)
      value = String(p.expr ?? '').replace(/^[()]+|[()]+$/g, '')
      if (value === 'MAXVALUE') {
        valueType += ' MAXVALUE'
        value = ''
      }
    }
    const def: PartitionDefT = { name, ...(valueEnabled ? { valueType, value } : {}) }
    if (subCount > 1) {
      def.subpartitions = []
      for (let j = 0; j < subCount; j++) {
        const sp = p?.subpartitions?.[j]
        def.subpartitions.push({ name: sp !== undefined ? (sp.name ?? '') : `${name}_s${j}`, ...options(sp) })
      }
    } else {
      Object.assign(def, options(p))
    }
    partitions.push(def)
  }
  return {
    partitioning: {
      partitionBy,
      partitionExpr,
      partitionCount: partitionCount === 0 ? '' : String(partitionCount),
      subpartitionBy: canHaveSubpartitions ? subBy : '',
      subpartitionExpr: canHaveSubpartitions ? subExpr : '',
      subpartitionCount: canHaveSubpartitions && subCount !== 0 ? String(subCount) : '',
      partitions: partitionCount > 1 ? partitions : [],
    },
    canHaveSubpartitions,
    valueEnabled,
    engines,
  }
}
