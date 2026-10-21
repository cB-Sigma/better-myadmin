import {
  type ExportPageResponse,
  type ExportScope,
  ExportTemplateCreate,
  ExportTemplateUpdate,
  type PluginInfo,
} from '@bettermyadmin/contracts'
import { Params, listEncodings, pageContext, pluginViews, recodingSupported } from '@bettermyadmin/export'
import { sprintf } from '@bettermyadmin/i18n'
import { ExportTemplatesRepository } from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import { Parser, SelectStatement, replaceClauses } from '@bettermyadmin/sql-lexer'
import { type Context, Hono } from 'hono'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { checkSqlSignature } from '../query/signature.ts'
import type { ServerEnv } from '../routes/server.ts'
import { isSystemSchema } from '../server-admin/context.ts'
import { databaseList } from '../server-admin/databases.ts'
import { type ExportSession, openExportSession, userDir } from './service.ts'

/**
 * The export page view-models (server / database / table / raw).
 * pma: src/Controllers/{Server,Database,Table}/ExportController.php, src/Export/Options.php
 */
export const exportPageRoutes = new Hono<ServerEnv>()

/** The request's fields: the query string, repeated keys kept in order. */
function requestParams(c: Context<ServerEnv>): Params {
  const url = new URL(c.req.url)
  return new Params([...url.searchParams.entries()])
}

async function countRecords(s: ExportSession, db: string, table: string): Promise<number> {
  const dbi = s.env.dbi
  const status = await dbi.fetchResultSimple(
    `SELECT TABLE_ROWS, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${dbi.quoteString(db)} AND TABLE_NAME = ${dbi.quoteString(table)}`,
  )
  const isView = status[0]?.TABLE_TYPE === 'VIEW'
  const approx = Number(status[0]?.TABLE_ROWS ?? 'NaN')
  if (!isView && Number.isFinite(approx) && approx >= s.settings.MaxExactCount) return approx
  if (!isView) {
    const v = await dbi.fetchValue(`SELECT COUNT(*) FROM ${backquote(db)}.${backquote(table)}`)
    return Number(v || 0)
  }
  if (s.settings.MaxExactCountViews === 0) return -1
  const r = await dbi.fetchSingleColumn(
    `SELECT 1 FROM ${backquote(db)}.${backquote(table)} LIMIT ${s.settings.MaxExactCountViews}`,
  )
  return r.length === s.settings.MaxExactCountViews ? -1 : r.length
}

exportPageRoutes.get('/page', async (c) => {
  const params = requestParams(c)
  const tr = c.get('tr')
  const db = params.str('db')
  const table = params.str('table')
  const scope = params.str('scope', db === '' ? 'server' : table === '' ? 'database' : 'table')
  const s = await openExportSession(c, db)
  try {
    const { env, settings } = s
    const exp = settings.Export as unknown as Record<string, unknown>
    let exportType: ExportScope
    const isRaw = params.has('raw_query') || params.get('export_type') === 'raw'
    let tablesView: ExportPageResponse['tables']
    let databases: ExportPageResponse['databases']
    let sqlQuery = params.str('sql_query')
    // the export page gets sql_query from the URL: with a signature it must verify (an unsigned
    // GET sql_query never reaches phpMyAdmin's export page, which reads it from POST only)
    if (
      params.has('sql_signature') &&
      !checkSqlSignature(
        sqlQuery,
        params.str('sql_signature'),
        c.get('session').hmacSecret,
        settings.blowfish_secret,
      )
    ) {
      sqlQuery = ''
    }
    let singleTable = false
    if (params.has('single_table')) singleTable = !['', '0'].includes(params.str('single_table'))

    if (scope === 'database') {
      if (db === '' || !(await env.dbi.selectDb(db)))
        throw new NotFoundError(tr.gettext('No database selected.'))
      const names = await pageTables(s, db)
      if (names.length < 1) throw new ValidationError(tr.gettext('No tables found in database.'))
      const tableSelect = params.list('table_select')
      const selectedTbl = params.list('selected_tbl')
      const tableStructure = params.list('table_structure')
      const tableData = params.list('table_data')
      tablesView = []
      for (const name of names) {
        const isChecked =
          tableSelect !== undefined
            ? tableSelect.includes(name)
            : selectedTbl !== undefined
              ? selectedTbl.includes(name)
              : true
        tablesView.push({
          name,
          isView: await isView(s, db, name),
          select: isChecked,
          structure: tableStructure !== undefined ? tableStructure.includes(name) : isChecked,
          data: tableData !== undefined ? tableData.includes(name) : isChecked,
        })
      }
      exportType = isRaw ? 'raw' : 'database'
    } else if (scope === 'table') {
      if (db === '' && !isRaw) throw new ValidationError(`${tr.gettext('Missing parameter:')} db`)
      if (table === '' && !isRaw) throw new ValidationError(`${tr.gettext('Missing parameter:')} table`)
      // When we have some query, we need to remove LIMIT from that and possibly
      // generate WHERE clause (if we are asked to export specific rows)
      if (sqlQuery !== '') {
        const parser = new Parser(sqlQuery, { context: env.parserContext })
        const st = parser.statements[0]
        if (st instanceof SelectStatement && parser.list !== null) {
          const replaces: Array<[string, string]> = []
          const where = params.list('where_clause') ?? []
          if (where.length > 0) replaces.push(['WHERE', `WHERE (${where.join(') OR (')})`])
          replaces.push(['LIMIT', ''])
          sqlQuery = replaceClauses(st, parser.list, replaces)
        }
      }
      exportType = isRaw ? 'raw' : 'table'
    } else {
      if (scope !== 'server') throw new ValidationError('Invalid scope.')
      // pma: Options::getDatabasesForSelectOptions
      let dbSelect: string[] | null = params.list('db_select') ?? null
      const one = params.get('db_select')
      if (dbSelect === null && one !== undefined) dbSelect = decodeURIComponent(one).split(',')
      databases = (await databaseList(s.admin))
        .filter((name) => !isSystemSchema(name, true))
        .map((name) => ({ name, selected: dbSelect === null ? true : dbSelect.includes(name) }))
      exportType = 'server'
    }

    const repopulate = params.has('repopulate')
    const ctx = await pageContext(env, {
      exportType,
      singleTable,
      db,
      table,
      rawQuery: params.has('raw_query'),
    })
    const plugins: PluginInfo[] = pluginViews(ctx, exp, params, repopulate) as unknown as PluginInfo[]
    const wanted = params.get('what') || params.get('format') || String(exp.format ?? 'sql')
    const selectedPlugin = plugins.some((p) => p.name === wanted) ? wanted : 'sql'

    let rows: ExportPageResponse['rows'] = null
    const engine = table === '' ? '' : await ctx.tables.engine(db, table)
    if (
      table !== '' &&
      scope === 'table' &&
      engine !== 'MERGE' &&
      engine !== 'MRG_MYISAM' &&
      exportType !== 'raw'
    ) {
      const limitTo = params.get('limit_to')
      const unlim = Number(params.get('unlim_num_rows') ?? 0)
      rows = {
        allrows: params.get('allrows') === '0' ? '0' : '1',
        limitTo:
          limitTo ??
          (unlim !== 0 && Number.isFinite(unlim) ? String(unlim) : String(await countRecords(s, db, table))),
        limitFrom: params.get('limit_from') ?? '0',
      }
    }

    // export templates
    const rp = await s.meta.relationParameters()
    const feature = rp.exportTemplatesFeature
    let list: Array<{ id: number; name: string }> = []
    if (feature !== null) {
      const all = await new ExportTemplatesRepository(s.meta.control, feature).getAll(s.user, exportType)
      if (Array.isArray(all)) list = all.map((t) => ({ id: t.id, name: t.name }))
    }

    const fileTemplate =
      params.get('filename_template') ??
      String(
        exportType === 'database'
          ? exp.file_template_database
          : exportType === 'table'
            ? exp.file_template_table
            : exp.file_template_server,
      )
    let compression = params.get('compression') ?? String(exp.compression ?? 'none')
    if (exp.as_separate_files === true) compression = 'zip'
    const truthy = (v: unknown) => v === true || v === 1 || v === '1'
    const session = c.get('session')
    const hasAliases =
      session.exportAliases !== undefined && JSON.stringify(session.exportAliases).match(/:"[^"]/) !== null
    const title =
      exportType === 'raw'
        ? tr.gettext('Exporting a raw query')
        : exportType === 'server'
          ? tr.gettext('Exporting databases from the current server')
          : exportType === 'database'
            ? sprintf(tr.gettext('Exporting tables from "%s" database'), db)
            : sprintf(tr.gettext('Exporting rows from "%s" table'), table)
    const body: ExportPageResponse = {
      exportType,
      db,
      table,
      singleTable,
      sqlQuery,
      title,
      exportMethod: params.get('export_method') ?? String(exp.method ?? 'quick'),
      quickOrCustom: (params.get('quick_or_custom') ?? String(exp.method)) === 'custom' ? 'custom' : 'quick',
      plugins,
      selectedPlugin,
      ...(databases !== undefined ? { databases } : {}),
      ...(tablesView !== undefined ? { tables: tablesView } : {}),
      rows,
      saveDir: userDir(s.user, settings.SaveDir),
      onServer: truthy(exp.onserver),
      onServerOverwrite: truthy(exp.onserver_overwrite),
      quickExportOnServer: truthy(exp.quick_export_onserver),
      quickExportOnServerOverwrite: truthy(exp.quick_export_onserver_overwrite),
      lockTables: (!repopulate && truthy(exp.lock_tables)) || params.has('lock_tables'),
      asFile: !repopulate && truthy(exp.asfile),
      filenameTemplate: fileTemplate,
      rememberTemplate: truthy(exp.remember_file_template),
      charsets: recodingSupported(settings.RecodingEngine) ? listEncodings(settings.AvailableCharsets) : null,
      charset: String(exp.charset ?? ''),
      compressions: [
        ...(settings.ZipDump ? (['zip'] as const) : []),
        ...(settings.GZipDump ? (['gzip'] as const) : []),
      ],
      compression,
      asSeparateFiles: truthy(exp.as_separate_files),
      hasAliases,
      templates: {
        enabled: feature !== null,
        list,
        selected:
          params.has('template_id') && params.str('template_id') !== ''
            ? Number(params.str('template_id'))
            : null,
      },
      execTimeLimit: settings.ExecTimeLimit,
      kanji: c.get('language').code === 'ja',
    }
    return c.json(body)
  } finally {
    await s.close()
  }
})

/** DatabaseInterface::getTables (SHOW TABLES FROM, NaturalOrder) */
async function pageTables(s: ExportSession, db: string): Promise<string[]> {
  const r = await s.env.dbi.select(`SHOW TABLES FROM ${backquote(db)};`, false)
  if (r === null) return []
  const out: string[] = []
  for await (const row of r.rows) out.push(row[0] ?? '')
  return s.settings.NaturalOrder
    ? out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
    : out
}

async function isView(s: ExportSession, db: string, table: string): Promise<boolean> {
  const v = await s.env.dbi.fetchValue(
    `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${s.env.dbi.quoteString(db)} AND TABLE_NAME = ${s.env.dbi.quoteString(table)}`,
  )
  return v === 'VIEW' || v === 'SYSTEM VIEW'
}

/**
 * GET …/export/alias-names?db= — the databases of the aliases dialog (export.twig lists them), or
 * the tables of `db` (the Designer). The dialog's tables and columns come from /tables and /columns
 * (routes/name-lists.ts), like phpMyAdmin's export.ts.
 */
exportPageRoutes.get('/alias-names', async (c) => {
  const db = c.req.query('db') ?? ''
  const s = await openExportSession(c, db)
  try {
    if (db === '') return c.json({ names: await databaseList(s.admin) })
    return c.json({ names: await pageTables(s, db) })
  } finally {
    await s.close()
  }
})

// ---------------------------------------------------------------- export templates

async function withTemplates<T>(
  c: Context<ServerEnv>,
  fn: (repo: ExportTemplatesRepository, user: string) => Promise<T>,
): Promise<T | null> {
  const s = await openExportSession(c)
  try {
    const feature = (await s.meta.relationParameters()).exportTemplatesFeature
    if (feature === null) return null
    return await fn(new ExportTemplatesRepository(s.meta.control, feature), s.user)
  } finally {
    await s.close()
  }
}

const templateList = async (repo: ExportTemplatesRepository, user: string, type: string) => {
  const all = await repo.getAll(user, type)
  return Array.isArray(all) ? all.map((t) => ({ id: t.id, name: t.name })) : []
}

/** POST …/export/templates (pma: /export/template/create) */
exportPageRoutes.post('/templates', async (c) => {
  const req = ExportTemplateCreate.safeParse(await c.req.json().catch(() => null))
  if (!req.success) throw new ValidationError('Invalid request.')
  const r = await withTemplates(c, async (repo, user) => {
    const err = await repo.create({
      username: user,
      exportType: req.data.exportType,
      name: req.data.templateName,
      data: req.data.templateData,
    })
    if (err !== '') return { success: false, message: err }
    return { success: true, templates: await templateList(repo, user, req.data.exportType) }
  })
  return c.json(r ?? { success: true })
})

/** GET …/export/templates/:id (pma: /export/template/load) */
exportPageRoutes.get('/templates/:id{[0-9]+}', async (c) => {
  const r = await withTemplates(c, async (repo, user) => {
    const t = await repo.load(user, Number(c.req.param('id')))
    if (typeof t === 'string') return { success: false, message: t }
    return { success: true, data: t.data }
  })
  return c.json(r ?? { success: true })
})

/** POST …/export/templates/:id (pma: /export/template/update) */
exportPageRoutes.post('/templates/:id{[0-9]+}', async (c) => {
  const raw = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const req = ExportTemplateUpdate.safeParse({ ...raw, templateId: Number(c.req.param('id')) })
  if (!req.success) throw new ValidationError('Invalid request.')
  const r = await withTemplates(c, async (repo, user) => {
    const err = await repo.update(user, req.data.templateId, req.data.templateData)
    return err === '' ? { success: true } : { success: false, message: err }
  })
  return c.json(r ?? { success: true })
})

/** POST …/export/templates/:id/delete (pma: /export/template/delete) */
exportPageRoutes.post('/templates/:id{[0-9]+}/delete', async (c) => {
  const r = await withTemplates(c, async (repo, user) => {
    const err = await repo.delete(user, Number(c.req.param('id')))
    return err === '' ? { success: true } : { success: false, message: err }
  })
  return c.json(r ?? { success: true })
})
