/**
 * Saving the Insert/Edit form: one multi-row INSERT or one UPDATE per edited row, built with
 * packages/sql-gen (dml.ts), then executed with phpMyAdmin's messages.
 *
 * pma: src/Controllers/Table/ReplaceController.php::__invoke, getParamsForUpdateOrInsert
 *      src/InsertEdit.php (setSessionForEditNext, getColumnDefaultValues, executeSqlQuery,
 *      getWarningMessages), src/File.php (checkTblChangeForm, setLocalSelectedFile)
 */

import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SaveRowsRequest, SaveRowsResponse, SqlMessage } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  PHP_PASSWORD_HASH,
  applyInputTransformation,
  isInputTransformation,
  parseTransformationOptions,
} from '@bettermyadmin/mysql-types'
import {
  type EditField,
  type EditRow,
  backquote,
  buildInsertEditQueries,
  buildProtectedValueQuery,
  getUniqueCondition,
} from '@bettermyadmin/sql-gen'
import bcrypt from 'bcryptjs'
import { phpRegex } from '../util/php-regex.ts'
import { type IeCtx, assoc, md5, mimeMap, sign, uniqueMeta } from './context.ts'

/** PHP password_hash($value, PASSWORD_DEFAULT): bcrypt, cost 10, `$2y$` prefix */
export function phpPasswordHash(value: string): string {
  return bcrypt.hashSync(value, 10).replace(/^\$2a\$/, '$2y$')
}

/** pma: InsertEdit::setSessionForEditNext — the unique condition of the next row, or null */
async function editNextClause(ctx: IeCtx, clause: string): Promise<string | null> {
  const sql = `SELECT * FROM ${backquote(ctx.db)}.${backquote(ctx.table)} WHERE ${clause.replaceAll('` =', '` >')} LIMIT 1;`
  const r = await ctx.conn.query(sql, 'insert.edit-next')
  const set = r.resultSets[0]
  const row = set?.rows[0]
  if (set === undefined || row === undefined) {
    // fetchRow() returned [] : UniqueCondition over no values → ''
    return null
  }
  const cond = getUniqueCondition(set.fields.map(uniqueMeta), row, { forceUnique: true }).condition
  return cond === '' ? null : cond
}

/** pma: InsertEdit::getColumnDefaultValues */
async function columnDefaultValues(ctx: IeCtx): Promise<Record<string, string | null>> {
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  const rows = await ctx.reader.dbi.fetchResultSimple(
    "SELECT COLUMN_NAME, CASE WHEN INSTR(EXTRA, 'DEFAULT_GENERATED') THEN COLUMN_DEFAULT  ELSE CONCAT('''', COLUMN_DEFAULT, '''') END AS COLUMN_DEFAULT" +
      ` FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ${q(ctx.table)} AND TABLE_SCHEMA = ${q(ctx.db)}`,
  )
  const out: Record<string, string | null> = {}
  for (const r of rows) out[r.COLUMN_NAME ?? ''] = r.COLUMN_DEFAULT ?? null
  return out
}

/** File::setLocalSelectedFile: content of an UploadDir file, or an error message */
function readUploadDirFile(ctx: IeCtx, name: string): { content: Buffer } | { error: string } {
  const dir = ctx.cfg.UploadDir
  const userDir = (dir.endsWith('/') ? dir : `${dir}/`).replaceAll('%u', ctx.user.replace(/[/\\]/g, ''))
  // Core::securePath
  const path = join(userDir, name.replace(/\.\.[/\\]/g, ''))
  try {
    if (lstatSync(path).isSymbolicLink()) return { error: ctx.tr.gettext('File is a symbolic link') }
    return { content: readFileSync(path) }
  } catch {
    return { error: ctx.tr.gettext('File could not be read!') }
  }
}

/** POST …/rows (pma: /table/replace) */
export async function saveRows(ctx: IeCtx, req: SaveRowsRequest): Promise<SaveRowsResponse> {
  const { tr, cfg } = ctx
  const usingKey = req.rows.some((r) => r.whereClause !== null)
  const whereClauses = usingKey ? req.rows.map((r) => r.whereClause ?? '') : []
  const signed = (clauses: string[]) => clauses.map((clause) => ({ clause, sig: sign(ctx, clause) }))

  // after_insert: same_insert keeps the clauses, edit_next looks up the next row now
  let editNext: string | null = null
  if (req.afterInsert === 'edit_next') {
    for (const clause of whereClauses) editNext = (await editNextClause(ctx, clause)) ?? editNext
  }

  const isInsert = !usingKey || ['insert', 'showinsert', 'insertignore'].includes(req.submitType)
  const mime = await mimeMap(ctx)
  const columnDefaults = await columnDefaultValues(ctx)

  const insertErrors: string[] = []
  let rowSkipped = false
  const unsaved: Array<Record<string, string | null>> = []
  const rows: EditRow[] = []
  const uuids: string[] = []
  const server = ctx.reader.server

  for (let rowNumber = 0; rowNumber < req.rows.length; rowNumber++) {
    const row = req.rows[rowNumber] as SaveRowsRequest['rows'][number]
    if (!usingKey && row.ignore) continue
    let insertFail = false
    const fields: EditRow['fields'][number][] = []
    const repopulate: Record<string, string | null> = {}
    for (const f of row.fields) {
      let value = f.value === null ? '' : Array.isArray(f.value) ? f.value.join(',') : f.value
      let uploaded: Buffer | null = null
      if (f.upload !== undefined && f.upload !== null && f.upload !== '') {
        uploaded = Buffer.from(f.upload, 'base64')
      } else if (f.uploadLocal !== undefined && f.uploadLocal !== null && f.uploadLocal !== '' && cfg.UploadDir !== '') {
        const r = readUploadDirFile(ctx, f.uploadLocal)
        if ('error' in r) insertErrors.push(r.error)
        else uploaded = r.content
      }
      if (uploaded !== null) value = `0x${uploaded.toString('hex')}`

      // input transformation
      const m = mime[f.name]
      if (m !== undefined && m.input_transformation !== '' && isInputTransformation(m.input_transformation)) {
        const res = applyInputTransformation(
          m.input_transformation,
          value,
          parseTransformationOptions(m.input_transformation_options),
          {
            defaults: cfg.DefaultTransformations as never,
            t: (s) => tr.gettext(s),
            pregMatch: (pattern, subject) => {
              const re = phpRegex(pattern)
              return re === null ? null : re.test(subject)
            },
          },
        )
        value = res.value
        if (!res.success) {
          insertFail = true
          rowSkipped = true
          insertErrors.push(sprintf(tr.gettext('Row: %1$s, Column: %2$s, Error: %3$s'), String(rowNumber), f.name, res.error))
        }
      }

      const field: EditRow['fields'][number] = {
        columnName: f.name,
        value,
        type: f.type,
        autoIncrement: f.autoIncrement,
        isNull: f.isNull,
        wasPreviouslyNull: f.nullPrev,
        function: f.function,
        salt: f.salt,
        previousValue: f.prev,
        isUploaded: uploaded !== null,
        virtual: f.virtual,
      }
      // values phpMyAdmin fetches while formatting, in the same order
      if (!f.virtual && isInsert && uploaded === null && f.type === 'protected' && usingKey && row.whereClause) {
        if (value !== columnDefaults[f.name]) {
          const r = await ctx.conn.query(
            buildProtectedValueQuery(f.name, ctx.table, row.whereClause),
            'insert.protected-value',
          )
          field.protectedValue = r.resultSets[0]?.rows[0]?.[0] ?? null
        }
      }
      if (!f.virtual && uploaded === null && f.function === 'UUID' && !(isInsert && value === columnDefaults[f.name])) {
        uuids.push((await ctx.reader.dbi.fetchValue('SELECT UUID()')) || '')
      }
      fields.push(field)
      repopulate[md5(f.name)] = f.isNull ? null : value
    }
    if (insertFail) unsaved.push(repopulate)
    rows.push({ ...(usingKey ? { whereClause: row.whereClause ?? '' } : {}), fields, failed: insertFail })
  }

  let uuidIndex = 0
  const queries = buildInsertEditQueries(
    {
      table: ctx.table,
      rows,
      submitType: req.submitType,
      clauseIsUnique: req.clauseIsUnique,
      columnDefaults,
    },
    {
      server,
      quote: {},
      passwordHash: phpPasswordHash,
      uuid: () => uuids[uuidIndex++] ?? '',
    },
  )
  // EditField.function === PHP_PASSWORD_HASH is computed in the application (no query)
  void PHP_PASSWORD_HASH

  const backTarget = (): SaveRowsResponse['next'] => {
    if (rowSkipped) return usingKey ? { action: 'edit', where: signed(whereClauses) } : { action: 'insert' }
    if (req.afterInsert === 'new_insert') return { action: 'insert' }
    if (req.afterInsert === 'same_insert' || req.afterInsert === 'edit_next') {
      if (!usingKey) return { action: 'insert' }
      if (req.afterInsert === 'edit_next' && editNext !== null) return { action: 'edit', where: signed([editNext]) }
      return { action: 'edit', where: signed(whereClauses) }
    }
    return { action: 'back' }
  }

  if (queries.length === 0 && !req.preview && !rowSkipped) {
    return { message: { type: 'success', text: tr.gettext('No change') }, sqlQuery: '', next: backTarget() }
  }
  if (req.preview) {
    return { preview: queries, message: { type: 'success', text: '' }, sqlQuery: '', next: { action: 'back' } }
  }

  // pma: InsertEdit::executeSqlQuery
  const sqlQuery = `${queries.join('; ')};`
  let totalAffectedRows = 0
  const lastMessages: string[] = []
  let warningMessages: string[] = []
  const errorMessages: string[] = []
  for (const q of queries) {
    if (req.submitType === 'showinsert') {
      lastMessages.push(tr.gettext('Showing SQL query'))
      continue
    }
    let header: { affectedRows: number; insertId: string } | null = null
    if (cfg.IgnoreMultiSubmitErrors) {
      try {
        header = (await ctx.conn.query(q, 'insert.save')).header
      } catch (e) {
        errorMessages.push((e as Error).message)
      }
    } else {
      header = (await ctx.conn.query(q, 'insert.save')).header
    }
    if (header !== null) {
      totalAffectedRows += header.affectedRows
      let insertId = Number(header.insertId)
      if (insertId !== 0) {
        if (totalAffectedRows > 0) insertId += totalAffectedRows - 1
        lastMessages.push(sprintf(tr.gettext('Inserted row id: %1$d'), insertId))
      }
    }
    warningMessages = await getWarnings(ctx)
  }

  const parts: string[] = []
  let type: SqlMessage['type'] = 'success'
  if (isInsert && (rows.some((r) => r.failed !== true) || rowSkipped)) {
    parts.push(sprintf(tr.ngettext('%1$d row inserted.', '%1$d rows inserted.', totalAffectedRows), totalAffectedRows))
  } else {
    parts.push(sprintf(tr.ngettext('%1$d row affected.', '%1$d rows affected.', totalAffectedRows), totalAffectedRows))
  }
  if (rowSkipped) {
    parts.push(...insertErrors)
    type = 'error'
  }
  parts.push(...lastMessages)
  if (warningMessages.length > 0) {
    parts.push(...warningMessages)
    type = 'error'
  }
  if (errorMessages.length > 0) {
    parts.push(errorMessages.join(' '))
    type = 'error'
  }
  const out: SaveRowsResponse = {
    message: { type, text: parts.join('\n'), sql: sqlQuery },
    sqlQuery,
    next: backTarget(),
  }
  if (unsaved.length > 0) out.unsaved = unsaved
  return out
}

/** pma: DatabaseInterface::getWarnings → Warning::__toString */
async function getWarnings(ctx: IeCtx): Promise<string[]> {
  const rows = await ctx.reader.dbi.tryQuery('SHOW WARNINGS')
  if (rows === null) return []
  return rows.rows.map((r) => {
    const level = r[0] ?? ''
    const code = r[1] ?? ''
    const message = r[2] ?? ''
    return `${level}: #${code}${message !== '' ? ` ${message}` : ''}`
  })
}

export { assoc }
