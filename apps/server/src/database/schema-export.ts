import type {
  PluginInfo,
  PluginOptionItem,
  SchemaExportFormResponse,
  SchemaExportRequest,
  SchemaExportResponse,
} from '@bettermyadmin/contracts'
import { sanitizeFilename } from '@bettermyadmin/export'
import { localisedDate, sprintf } from '@bettermyadmin/i18n'
import {
  getDisplayField,
  getForeignKeysData,
  getForeigners,
  getForeignersInternal,
  getMime,
  searchColumnInForeigners,
} from '@bettermyadmin/metadata'
import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import {
  type SchemaFormat,
  type SchemaTableData,
  type SchemaTableDoc,
  exportSchema,
  schemaPlugins,
} from '@bettermyadmin/schema'
import { backquote } from '@bettermyadmin/sql-gen'
import { EXPORT_TOOL, PROCESS_TIME_ZONE } from '../export/service.ts'
import { ValidationError } from '../http/errors.ts'
import type { DbCtx } from './context.ts'
import { statusInfo } from './tables.ts'

/**
 * The relational schema export (Designer → Export schema): the dialog and the file.
 * pma: src/Database/Designer.php::getHtmlForSchemaExport, src/Controllers/SchemaExportController.php,
 *      src/Export/Export.php::getExportSchemaInfo, src/Plugins/Schema/ExportRelationSchema.php,
 *      src/Plugins/Schema/TableStats.php
 */

const FORMATS: readonly SchemaFormat[] = ['dia', 'eps', 'pdf', 'svg']

/** dialog=export: Plugins::getSchema / getChoice / getOptions (defaults from $cfg['Schema']) */
export function schemaExportForm(ctx: DbCtx, page: number, format: string): SchemaExportFormResponse {
  const schemaCfg = ctx.cfg.Schema as Record<string, unknown>
  const plugins: PluginInfo[] = schemaPlugins((m) => ctx.tr.gettext(m), ctx.cfg.PDFPageSizes).map((p) => ({
    name: p.name,
    text: p.text,
    extension: p.name,
    forceFile: true,
    options: [
      {
        kind: 'main',
        name: `${p.name}_general_opts`,
        text: '',
        items: p.options.map((o): PluginOptionItem => {
          const def = schemaCfg[o.name]
          return o.kind === 'bool'
            ? { kind: 'bool', name: o.name, text: o.text, checked: def === true }
            : {
                kind: 'select',
                name: o.name,
                text: o.text,
                values: o.values.map((v) => [v.value, v.text]),
                value: typeof def === 'string' ? def : '',
              }
        }),
      },
    ],
  }))
  // Designer::getFormat: export_type, format, else $cfg['Schema']['format']
  const wanted = format !== '' ? format : String(schemaCfg.format ?? '')
  const choice = plugins.some((p) => p.name === wanted) ? wanted : (plugins[0]?.name ?? '')
  return { page, choice, plugins }
}

/** date('j F Y, g:i a') in the server's time zone */
function phpDate(d: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
}

/** TableStats::__construct for one table: false when the table does not exist */
async function tableData(ctx: DbCtx, table: string): Promise<SchemaTableData | false> {
  const { db } = ctx
  const collate = await ctx.dbi.collateForIS()
  const q = (s: string) => ctx.dbi.quoteString(s)
  // DatabaseInterface::getColumnNames
  const r = await ctx.dbi.tryQuery(
    `SELECT \`COLUMN_NAME\`, \`COLUMN_TYPE\` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${q(db)} AND \`TABLE_NAME\` ${collate} = ${q(table)} ORDER BY \`ORDINAL_POSITION\``,
    'schema.columns',
  )
  const columns = r === null ? [] : r.rows.map((row) => row[0] ?? '')
  if (columns.length === 0) return false
  const indexes = await ctx.reader.getIndexes(db, table)
  const internal = await getForeignersInternal(ctx.control, ctx.rp, db, table)
  return {
    name: table,
    columns,
    indexColumns: indexes.flatMap((i) => i.columns.map((c) => c.name)),
    primary: indexes.filter((i) => i.name === 'PRIMARY').flatMap((i) => i.columns.map((c) => c.name)),
    displayField: await getDisplayField(ctx.control, ctx.rp, db, table, async () =>
      (await ctx.reader.getColumns(db, table)).map((c) => ({ field: c.Field, type: c.Type })),
    ),
    internal: Object.entries(internal).map(([masterField, v]) => ({
      masterField,
      foreignTable: v.foreign_table,
      foreignField: v.foreign_field,
    })),
    foreignKeys: getForeignKeysData(await ctx.reader.showCreate(db, table)).map((k) => ({
      refTableName: k.refTableName,
      indexList: k.indexList,
      refIndexList: k.refIndexList,
    })),
  }
}

/** Util::localisedDate(new DateTimeImmutable($s)) of a table status time ('' when unset) */
function statusDate(ctx: DbCtx, s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return ''
  const epoch = Date.parse(`${s.replace(' ', 'T')}Z`) / 1000
  return Number.isFinite(epoch) ? localisedDate(ctx.tr, epoch, '', 'UTC') : ''
}

/** What PdfRelationSchema::dataDictionaryDoc reads about one table */
async function tableDoc(ctx: DbCtx, table: string): Promise<SchemaTableDoc> {
  const { db, rp } = ctx
  const columns = await ctx.reader.getColumns(db, table)
  const mime =
    rp.browserTransformationFeature !== null ? await getMime(ctx.control, rp, db, table, true) : null
  const status = await statusInfo(ctx, db, table)
  const foreigners = await getForeigners(ctx.control, rp, db, table, '', () =>
    ctx.reader.showCreate(db, table),
  )
  const doc: SchemaTableDoc = {
    columns: columns.map((c) => {
      const spec = extractColumnSpec(c.Type)
      return {
        field: c.Field,
        printType: spec.print_type,
        attribute: spec.attribute,
        isNull: c.Null === 'YES',
        default: c.Default,
        extra: c.Extra,
      }
    }),
    comments: Object.fromEntries(columns.filter((c) => c.Comment !== '').map((c) => [c.Field, c.Comment])),
    mime:
      mime === null ? null : Object.fromEntries(Object.entries(mime).map(([k, v]) => [k, v.mimetype ?? ''])),
    comment: status?.Comment ?? status?.TABLE_COMMENT ?? '',
    createTime: statusDate(ctx, status?.Create_time),
    updateTime: statusDate(ctx, status?.Update_time),
    checkTime: statusDate(ctx, status?.Check_time),
    foreigners: {},
  }
  for (const c of columns) {
    const f = searchColumnInForeigners(foreigners, c.Field, db)
    if (f === false) continue
    doc.foreigners[c.Field] = {
      db: f.foreign_db,
      table: f.foreign_table ?? '',
      field: f.foreign_field ?? '',
      ...('on_update' in f ? { onUpdate: f.on_update, onDelete: f.on_delete } : {}),
    }
  }
  return doc
}

/** Pdf::Header: the saved page's description, else "PDF export page" */
async function pdfPageTitle(ctx: DbCtx, pageNumber: number, offline: boolean): Promise<string> {
  const f = ctx.rp.pdfFeature
  if (offline || pageNumber === -1 || f === null || ctx.control === null) {
    return ctx.tr.gettext('PDF export page')
  }
  const r = await ctx.control.query(
    `SELECT * FROM ${backquote(f.database)}.${backquote(f.pdfPages)} WHERE db_name = ${ctx.dbi.quoteString(ctx.db)} AND page_nr = ${pageNumber}`,
  )
  const descr = r.rows[0]?.page_descr ?? ''
  // ucfirst
  return descr.charAt(0).toUpperCase() + descr.slice(1)
}

/** POST /schema-export */
export async function schemaExport(ctx: DbCtx, req: SchemaExportRequest): Promise<SchemaExportResponse> {
  const { tr, db, rp } = ctx
  if (req.export_type === '') {
    throw new ValidationError(`${tr.gettext('Missing parameter:')} export_type`)
  }
  // Export::getExportSchemaInfo: letters only, default pdf
  const format = /^[a-zA-Z]+$/.test(req.export_type) ? req.export_type : 'pdf'
  if (!(FORMATS as readonly string[]).includes(format)) throw new ValidationError(tr.gettext('Bad type!'))
  const type = format as SchemaFormat
  await ctx.reader.selectDb(db)
  const pageNumber = Number.parseInt(req.page_number, 10) || 0
  const tables = req.tables.map((t) => t.table)
  const data = new Map<string, SchemaTableData>()
  for (const name of tables) {
    if (data.has(name)) continue
    const d = await tableData(ctx, name)
    if (d === false) {
      // ExportRelationSchema::dieSchema
      throw new ValidationError(
        `${tr.gettext('SCHEMA ERROR: ')}${type.toUpperCase()} ${sprintf(tr.gettext("The %s table doesn't exist!"), name)}`,
      )
    }
    // the data dictionary of the PDF plugin
    if (type === 'pdf' && req.options.pdf_with_doc !== undefined) d.doc = await tableDoc(ctx, name)
    data.set(name, d)
  }
  // ExportRelationSchema::getFileName: the page's name when it is saved in the configuration storage
  let fileBase = db
  if (pageNumber !== -1 && !req.offline_export && rp.pdfFeature !== null && ctx.control !== null) {
    const f = rp.pdfFeature
    const r = await ctx.control.query(
      `SELECT page_descr FROM ${backquote(f.database)}.${backquote(f.pdfPages)} WHERE page_nr = ${pageNumber}`,
    )
    const row = r.rows[0]
    fileBase = row === undefined ? '' : (row.page_descr ?? '')
  }
  const now = new Date()
  const result = await exportSchema(
    type,
    {
      db,
      pageNumber,
      tables,
      coordinates: req.tables.map((t) => ({
        db: t.db,
        table: t.table,
        x: Number.parseFloat(t.x) || 0,
        y: Number.parseFloat(t.y) || 0,
      })),
      options: req.options,
      fileBase,
      creator: `${EXPORT_TOOL.name} ${EXPORT_TOOL.version}`,
      date: phpDate(now, PROCESS_TIME_ZONE),
      titleFormat: tr.gettext('Schema of the %s database - Page %s'),
      t: (m) => tr.gettext(m),
      localisedDate: localisedDate(tr, Math.floor(now.getTime() / 1000), '', PROCESS_TIME_ZONE),
      pageTitle: type === 'pdf' ? await pdfPageTitle(ctx, pageNumber, req.offline_export) : '',
      now,
    },
    data,
  )
  // Core::downloadHeader → getDownloadHeaders: Sanitize::sanitizeFilename on the file name
  return { ...result, fileName: sanitizeFilename(result.fileName) }
}
