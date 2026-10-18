import { lstatSync } from 'node:fs'
import type { ImportProgress, ImportResult, StatementResult } from '@bettermyadmin/contracts'
import { Params, convertToUtf8, listEncodings } from '@bettermyadmin/export'
import { convertBBCode, sprintf } from '@bettermyadmin/i18n'
import {
  Import,
  type ImportDbi,
  ImportFile,
  ImportFileError,
  type ImportPageContext,
  type ImportType,
  createImportPlugin,
} from '@bettermyadmin/import'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import { gridHook, gridMeta } from '../browse/service.ts'
import { resolveViewState } from '../browse/view-state.ts'
import { openExportSession, userDir } from '../export/service.ts'
import { MysqlError } from '../http/errors.ts'
import { ImportRunner } from '../query/import.ts'
import { mysqlDie } from '../query/message.ts'
import { getVariable, runSqlBox, setVariable } from '../query/pipeline.ts'
import { signSql } from '../query/signature.ts'
import type { ServerEnv } from '../routes/server.ts'

/** The import formats (ImportFormat enum values) */
export const IMPORT_FORMATS = ['csv', 'ldi', 'mediawiki', 'ods', 'shp', 'sql', 'xml']

/** DatabaseInterface::getCompatibilities */
export const COMPATIBILITIES = [
  'NONE',
  'ANSI',
  'DB2',
  'MAXDB',
  'MYSQL323',
  'MYSQL40',
  'MSSQL',
  'ORACLE',
  'TRADITIONAL',
]

/** Core::securePath */
export { securePath } from '../util/secure-path.ts'
import { securePath } from '../util/secure-path.ts'

/** ForeignKey::isCheckEnabled */
export async function isFkCheckEnabled(
  mode: string,
  conn: { rows(sql: string, label: string): Promise<Array<Record<string, string | null>>> },
): Promise<boolean> {
  if (mode === 'enable') return true
  if (mode === 'disable') return false
  return (await getVariable(conn as never, 'FOREIGN_KEY_CHECKS')) === 'ON'
}

export interface UploadedFile {
  path: string
  name: string
}

/**
 * Runs one import (POST /import with a file, never the SQL box): file resolution, decompression,
 * charset handling, resume skip, the plugin, then the messages, the error card or the goSql
 * statements.
 * pma: src/Controllers/Import/ImportController.php::__invoke
 */
export async function runFileImport(
  c: Context<ServerEnv>,
  pairs: Array<[string, string]>,
  upload: UploadedFile | null,
  progress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const request = new Params(pairs)
  const tr = c.get('tr')
  const __ = (s: string) => tr.gettext(s)
  let db = request.str('db')
  let table = request.str('table')
  const s = await openExportSession(c, db)
  const { conn, settings } = s
  const session = c.get('session')
  const out = (r: Partial<ImportResult>): ImportResult => ({ reloadNavigation: false, db, table, ...r })
  let openedFile: ImportFile | null = null
  try {
    const charsetOfFile = request.str('charset_of_file')
    const format = request.str('format')
    const importType = request.str('import_type') as ImportType
    const localImportFile0 = request.str('local_import_file')
    if (!IMPORT_FORMATS.includes(format)) {
      return out({ message: { type: 'error', html: __('Incorrect format parameter') } })
    }
    if (db !== '') await conn.selectDb(db, 'import.select-db')
    // Util::setTimeLimit(ExecTimeLimit), ini_set('memory_limit', MemoryLimit): the request's limits
    const memoryLimitIni =
      settings.MemoryLimit !== '' && settings.MemoryLimit !== '0' ? settings.MemoryLimit : '-1'
    // We can not read all at once, otherwise we can run out of memory
    let memoryLimit = getRealSize(memoryLimitIni)
    // 2 MB as default
    if (memoryLimit === 0) memoryLimit = 2 * 1024 * 1024
    // In case no memory limit we work on 10MB chunks
    if (memoryLimit === -1) memoryLimit = 10 * 1024 * 1024
    // Just to be sure, there might be lot of memory needed for uncompression
    const readLimit = memoryLimit / 8
    // Give 1 second for phpMyAdmin to exit nicely (with allow_interrupt)
    const maximumTime =
      request.has('allow_interrupt') && settings.ExecTimeLimit >= 1 ? settings.ExecTimeLimit - 1 : 0

    // handle filenames
    let importFile = 'none'
    let importFileName = ''
    let localImportFile = ''
    if (upload !== null) {
      importFile = upload.path
      importFileName = upload.name
    }
    if (localImportFile0 !== '' && settings.UploadDir !== '') {
      // sanitize $local_import_file as it comes from a POST
      localImportFile = securePath(localImportFile0)
      importFile = userDir(s.user, settings.UploadDir) + localImportFile
      // Do not allow symlinks to avoid security issues
      try {
        if (lstatSync(importFile).isSymbolicLink()) importFile = 'none'
      } catch {
        // File::checkUploadedFile reports it below
      }
    } else if (upload === null) importFile = 'none'

    const errorHtml = (html: string) => out({ message: { type: 'error', html } })
    let file: ImportFile | null = null
    if (importFile !== 'none') {
      // read from disk chunk by chunk (a gzip or bzip2 file through a decompressed temporary copy)
      try {
        file = await ImportFile.open(
          importFile,
          { gzip: settings.GZipDump, bzip2: settings.BZipDump, zip: settings.ZipDump },
          __,
          // set_time_limit(ExecTimeLimit) also ends phpMyAdmin's on-the-fly decompression
          settings.ExecTimeLimit > 0 ? { deadline: Date.now() + settings.ExecTimeLimit * 1000 } : {},
        )
      } catch (e) {
        if (e instanceof ImportFileError) return errorHtml(e.message)
        return errorHtml(__('File could not be read!'))
      }
      openedFile = file
    } else {
      const html = convertBBCode(
        tr,
        __(
          'No data was received to import. Either no file name was submitted, or the file size exceeded the maximum size permitted by your PHP configuration. See [doc@faq1-16]FAQ 1.16[/doc].',
        ),
      )
      // Current::$message (page header) and the same message added to the page
      return out({ message: { type: 'error', html }, echoed: [html] })
    }

    const runner = new ImportRunner({
      conn,
      runQuery: true,
      db,
      ignoreMultiSubmitErrors: settings.IgnoreMultiSubmitErrors,
      tr,
      skipQueries: Math.trunc(Number(request.get('skip_queries') ?? 0)) || 0,
    })
    const noBackslashEscapes = /\bNO_BACKSLASH_ESCAPES\b/i.test(conn.serverInfo?.sqlMode ?? '')
    const dbi: ImportDbi = {
      tryQuery: async (sql) => {
        try {
          const r = await conn.query(sql, 'import.plugin')
          const rows = r.resultSets[0]?.rows ?? []
          const first = rows[0]?.[0]
          return { numRows: rows.length, firstValue: typeof first === 'string' ? first : null }
        } catch (e) {
          if (e instanceof MysqlError) return false
          throw e
        }
      },
      quoteString: (v) => quoteString(v, { noBackslashEscapes }),
      getTables: async (d) => {
        // DatabaseInterface::getTables: an unknown database lists nothing
        const rows = await conn
          .rows(`SHOW TABLES FROM ${backquote(d)};`, 'import.tables')
          .catch((e: unknown) => {
            if (e instanceof MysqlError) return []
            throw e
          })
        return rows.map((r) => Object.values(r)[0] ?? '')
      },
      getColumnNames: async (d, t) => {
        const rows = await conn.rows(`SHOW COLUMNS FROM ${backquote(d)}.${backquote(t)}`, 'import.columns')
        return rows.map((r) => r.Field ?? '')
      },
      fetchSingleColumn: async (sql) =>
        (await conn.rows(sql, 'import.list')).map((r) => Object.values(r)[0] ?? ''),
      isView: async (d, t) =>
        (
          await conn.rows(
            `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(d)} AND TABLE_NAME = ${quoteString(t)}`,
            'import.is-view',
          )
        )[0]?.TABLE_TYPE === 'VIEW',
    }
    const imp = new Import({
      dbi,
      runner,
      tr,
      db,
      table,
      importType,
      importFileName,
      importFile,
      localImportFile,
      file,
      readLimit,
      request: { get: (n) => request.get(n), has: (n) => request.has(n) },
    })
    imp.maximumTime = maximumTime
    const total = readFileSize(importFile)
    imp.onChunk = (offset) =>
      progress({ offset: Math.min(offset, total), total, executed: runner.st.executedQueries })

    // Convert the file's charset if necessary
    let resetCharset = false
    const encodings = settings.RecodingEngine !== 'none' ? listEncodings(settings.AvailableCharsets) : []
    if (
      settings.RecodingEngine !== 'none' &&
      charsetOfFile !== '' &&
      charsetOfFile !== 'utf-8' &&
      encodings.includes(charsetOfFile)
    ) {
      imp.charsetConversion = true
      file?.convert((b) => convertToUtf8(b, charsetOfFile))
    } else if (charsetOfFile !== '' && charsetOfFile !== 'utf-8') {
      await conn.query(`SET NAMES '${charsetOfFile}'`, 'import.set-names')
      // We can not show query in this case, it is in different charset
      runner.sqlQueryDisabled = true
      resetCharset = true
    }

    // Something to skip? (because timeout has passed)
    const skipParam = request.get('skip')
    let originalSkip: number | null = null
    if (skipParam !== undefined) {
      let skip = Math.trunc(Number(skipParam)) || 0
      originalSkip = skip
      while (skip > 0 && !imp.finished) {
        imp.getNextChunk(Math.min(skip, imp.readLimit))
        // Disable read progressivity, otherwise we eat all memory!
        imp.readMultiply = 1
        skip -= imp.readLimit
      }
    }

    const page: ImportPageContext = { importType, tr, compatibilities: COMPATIBILITIES, localInfile: false }
    const plugin = createImportPlugin(format, page)
    if (plugin === null) return errorHtml(__('Incorrect format parameter'))
    // ForeignKey::handleDisableCheckInit / Cleanup
    const fkDefault = (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
    const fk = request.get('fk_checks')
    try {
      if (fk !== undefined)
        await setVariable(conn, 'FOREIGN_KEY_CHECKS', fk === '' || fk === '0' ? 'OFF' : 'ON')
      // ImportLdi's LOAD DATA LOCAL INFILE may read the import file, nothing else
      if (format === 'ldi' && importFile !== 'none') conn.localInfile = importFile
      await plugin.doImport(imp)
    } finally {
      await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
    }
    // Reset charset back, if we did some changes
    if (resetCharset) {
      await conn.query('SET CHARACTER SET utf8mb4', 'import.reset-charset')
      await conn.query(
        `SET collation_connection = ${quoteString(c.get('creds').collation ?? settings.DefaultConnectionCollation)}`,
        'import.reset-collation',
      )
    }
    db = runner.st.db
    table = imp.table
    const run = runner.result()
    const st = runner.st
    let message = imp.message
    // Show correct message
    if (imp.finished && !imp.hasError && importType !== 'query') {
      let html = `<em>${sprintf(
        tr.ngettext(
          'Import has been successfully finished, %d query executed.',
          'Import has been successfully finished, %d queries executed.',
          st.executedQueries,
        ),
        st.executedQueries,
      )}</em>`
      if (imp.importNotice !== '') html += ` ${imp.importNotice}`
      const name = localImportFile !== '' ? localImportFile : importFileName
      if (localImportFile !== '' || upload !== null) html += ` ${escapeHtml(`(${name})`)}`
      message = { type: 'success', html }
    }
    if (imp.timeoutPassed) {
      // UrlParams::$params + timeout_passed, offset (and the local file): the import page again
      const resume = new URLSearchParams({ timeout_passed: '1', offset: String(imp.offset) })
      if (localImportFile !== '') resume.set('local_import_file', localImportFile)
      const server = c.get('serverIndex')
      const page =
        importType === 'server'
          ? `/s/${server}/import`
          : importType === 'database'
            ? `/s/${server}/db/${encodeURIComponent(request.str('db'))}/import`
            : `/s/${server}/db/${encodeURIComponent(request.str('db'))}/t/${encodeURIComponent(request.str('table'))}/import`
      message = {
        type: 'error',
        html: __(
          'Script timeout passed, if you want to finish import, please %sresubmit the same file%s and import will resume.',
        )
          .replace('%s', `<a href="${escapeHtml(`${page}?${resume}`)}">`)
          .replace('%s', '</a>'),
      }
      if (imp.offset === 0 || originalSkip === imp.offset) {
        message.html += ` ${__("However on last run no data has been parsed, this usually means phpMyAdmin won't be able to finish this import unless you increase php time limits.")}`
      }
    }
    const echoed = imp.echoed.length > 0 ? { echoed: imp.echoed } : {}
    const reload = st.reloadNavigation

    // a parameter error of the CSV plugin: Generator::mysqlDie(message, '') + back link
    if (imp.dieMessage && message !== null) {
      // the card, and Current::$message again in the page header
      return out({
        message,
        error: errorStatement(c, '', message.html, db),
        back: true,
        reloadNavigation: reload,
        db,
      })
    }
    for (const die of st.failedQueries) {
      if (!imp.hasError) continue
      return out({
        ...echoed,
        error: errorStatement(c, die.sql, die.error, db),
        back: true,
        reloadNavigation: reload,
        db,
      })
    }
    if (run.goSql) {
      const queries = run.queriesToBeExecuted.length > 0 ? run.queriesToBeExecuted : [run.sqlQuery]
      const meta = s.meta
      const grid = gridHook(
        {
          cfg: settings,
          conn,
          tr,
          hmacSecret: session.hmacSecret,
          server: c.get('serverIndex'),
          isBrowseDistinct: false,
          meta: await gridMeta(meta),
        },
        {
          sqlQuery: (sql) => sql,
          view: (sql, info, pos, maxRows) =>
            resolveViewState(
              session,
              c.get('serverIndex'),
              db,
              sql,
              info.flags.queryType === 'EXPLAIN',
              { pos, maxRows },
              settings,
            ),
        },
      )
      const r = await runSqlBox(
        {
          sql: queries.join('\n'),
          statements: queries.map((q) => q.replace(/;$/, '')),
          db,
          table,
          pos: 0,
          maxRows: settings.MaxRows,
          delimiter: ';',
          // Sql::executeQueryAndGetQueryResponse applies fk_checks again
          fkChecks: fk === undefined ? undefined : !(fk === '' || fk === '0'),
        },
        {
          cfg: settings,
          conn,
          hmacSecret: session.hmacSecret,
          executed: c.get('executed'),
          session,
          server: c.get('serverIndex'),
          tr,
          grid,
        },
      )
      // Header::getMessage shows Current::$message unless a statement returned rows
      // (Sql::getQueryResponseForResultsReturned resets it)
      const shown = message !== null && !r.statements.some((x) => x.kind === 'resultset') ? { message } : {}
      return out({
        ...echoed,
        ...shown,
        statements: r.statements,
        reloadNavigation: reload || r.reloadNavigation,
        db: r.db,
        table: r.table,
      })
    }
    return out({ ...echoed, ...(message !== null ? { message } : {}), reloadNavigation: reload, db })
  } finally {
    openedFile?.close()
    s.conn.localInfile = null
    await s.close()
  }
}

/** Util::getRealSize: ini_parse_quantity (-1 stays -1, a bad value counts its leading digits) */
function getRealSize(size: string): number {
  if (size === '') return 0
  const m = /^\s*(-?\d+)\s*([kmg]?)/i.exec(size)
  if (m === null) return 0
  const exp = { '': 0, k: 1, m: 2, g: 3 }[(m[2] ?? '').toLowerCase() as '' | 'k' | 'm' | 'g']
  return Number(m[1]) * 1024 ** exp
}

function readFileSize(path: string): number {
  try {
    return lstatSync(path).size
  } catch {
    return 0
  }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

/** Generator::mysqlDie for an import failure (a StatementResult of kind error) */
function errorStatement(
  c: Context<ServerEnv>,
  sql: string,
  serverMessage: string,
  db: string,
): StatementResult {
  const { cfg } = c.get('deps')
  return {
    sql,
    executedSql: sql,
    sig: signSql(sql, c.get('session').hmacSecret, cfg.blowfish_secret),
    kind: 'error',
    queryType: null,
    message: { type: 'error', text: serverMessage },
    error: mysqlDie(serverMessage, sql, cfg, undefined),
    queryTime: 0,
    warnings: [],
    db: db === '' ? null : db,
    reload: false,
  }
}
