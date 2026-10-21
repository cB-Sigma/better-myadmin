import { lstatSync, readdirSync, statSync } from 'node:fs'
import type { ImportPageResponse, ImportScope, PluginInfo } from '@bettermyadmin/contracts'
import { Params, listEncodings, recodingSupported, withValues } from '@bettermyadmin/export'
import { getFormattedMaximumUploadSize, sprintf } from '@bettermyadmin/i18n'
import { type ImportPageContext, listImportPlugins } from '@bettermyadmin/import'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import { openExportSession, userDir } from '../export/service.ts'
import { NotFoundError } from '../http/errors.ts'
import type { ServerEnv } from '../routes/server.ts'
import { COMPATIBILITIES, isFkCheckEnabled } from './service.ts'

/** FileListing::getDirContent (regular files, no symlinks, matching, sorted); false when unreadable */
function dirContent(dir: string, re: RegExp): string[] | false {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return false
  }
  const d = dir.endsWith('/') ? dir : `${dir}/`
  return names
    .filter((n) => {
      try {
        const st = statSync(d + n, { throwIfNoEntry: false })
        return st?.isFile() === true && !lstatSync(d + n).isSymbolicLink() && re.test(n)
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * The import page view-model at server, database or table scope.
 * pma: src/Controllers/{Server,Database,Table}/ImportController.php
 */
export async function importPage(c: Context<ServerEnv>): Promise<ImportPageResponse> {
  const url = new URL(c.req.url)
  const params = new Params([...url.searchParams.entries()])
  const tr = c.get('tr')
  const db = params.str('db')
  const table = params.str('table')
  const importType: ImportScope = db === '' ? 'server' : table === '' ? 'database' : 'table'
  const s = await openExportSession(c, db)
  try {
    const { conn, settings } = s
    const q = (sql: string) => conn.rows(sql, 'import.page')
    if (importType !== 'server') {
      const ok = await q(
        `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${quoteString(db)}`,
      )
      if (ok.length === 0) throw new NotFoundError(tr.gettext('No database selected.'))
    }
    if (importType === 'table') {
      const ok = await q(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
      )
      if (ok.length === 0) throw new NotFoundError(tr.gettext('No table selected.'))
    }
    // ImportLdi::setLdiLocalOptionConfig
    const imp = { ...(settings.Import as unknown as Record<string, unknown>) }
    let localInfile = false
    if (imp.ldi_local_option === 'auto') {
      const v = (await q('SELECT @@local_infile AS v;'))[0]?.v
      localInfile = v === 'ON' || v === '1'
      imp.ldi_local_option = localInfile
    }
    const page: ImportPageContext = { importType, tr, compatibilities: COMPATIBILITIES, localInfile }
    const list = listImportPlugins(page)
    const timeoutPassed = params.has('timeout_passed') && params.str('timeout_passed') !== ''
    const plugins = list.map((p) => ({
      name: p.properties.name,
      text: p.getTranslatedText(p.properties.text),
      extension: p.properties.extension,
      forceFile: false,
      options: withValues(p.properties.options, imp, params, params.has('repopulate'), timeoutPassed, (t) =>
        p.getTranslatedText(t),
      ),
    })) as unknown as PluginInfo[]
    const wanted = params.get('format') || String(imp.format ?? 'sql')
    const selectedPlugin = list.some((p) => p.name === wanted) ? wanted : 'sql'
    const skipParam = params.get('skip_queries')
    const skipQueries =
      skipParam !== undefined && /^\d+$/.test(skipParam) ? Number(skipParam) : Number(imp.skip_queries ?? 0)
    // Plugins::checkboxCheck(Import, allow_interrupt)
    const allowInterrupt =
      params.has('allow_interrupt') ||
      (!params.has('repopulate') &&
        ((timeoutPassed && params.has('allow_interrupt')) || imp.allow_interrupt === true))
    // Import::getLocalFiles
    const exts = list.map((p) => p.properties.extension).join('|')
    const decomp = [
      settings.GZipDump ? 'gz' : '',
      settings.BZipDump ? 'bz2' : '',
      settings.ZipDump ? 'zip' : '',
    ]
      .filter((x) => x !== '')
      .join('|')
    const matcher = new RegExp(`\\.(${exts})(\\.(${decomp}))?$`)
    const localImportFile = params.str('local_import_file')
    const active = localImportFile !== '' && timeoutPassed ? localImportFile : ''
    const uDir = userDir(s.user, settings.UploadDir)
    let localFiles: ImportPageResponse['localFiles'] = []
    if (settings.UploadDir !== '') {
      const files = dirContent(uDir, matcher)
      localFiles = files === false ? false : files.map((name) => ({ name, selected: name === active }))
    }
    const encodingSupported = recodingSupported(settings.RecodingEngine)
    const charsets = encodingSupported
      ? []
      : (await q('SHOW CHARACTER SET')).map((r) => r.Charset ?? '').sort()
    const offset = params.get('offset')
    const title =
      importType === 'server'
        ? tr.gettext('Importing into the current server')
        : importType === 'database'
          ? sprintf(tr.gettext('Importing into the database "%s"'), db)
          : sprintf(tr.gettext('Importing into the table "%s"'), table)
    if (db !== '') await conn.query(`USE ${backquote(db)}`, 'import.select-db')
    return {
      importType,
      db,
      table,
      title,
      compressions: [
        ...(settings.GZipDump ? ['gzip'] : []),
        ...(settings.BZipDump ? ['bzip2'] : []),
        ...(settings.ZipDump ? ['zip'] : []),
      ],
      isUpload: true,
      maxUploadSize: getFormattedMaximumUploadSize(tr, settings.MaxUploadSize),
      uploadDir: settings.UploadDir,
      userUploadDir: uDir,
      localFiles,
      encodings: encodingSupported ? listEncodings(settings.AvailableCharsets) : null,
      charsets,
      importCharset: String(imp.charset ?? ''),
      timeoutPassed,
      offset: offset !== undefined && /^-?\d+(\.\d+)?$/.test(offset) ? Math.trunc(Number(offset)) : null,
      localImportFile,
      allowInterrupt,
      skipQueries,
      fkChecks: await isFkCheckEnabled(settings.DefaultForeignKeyChecks, conn),
      plugins,
      selectedPlugin,
      kanji: c.get('language').code === 'ja',
    }
  } finally {
    await s.close()
  }
}
