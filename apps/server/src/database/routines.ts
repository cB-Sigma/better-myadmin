import type {
  DbExportResponse,
  RoutineEditorData,
  RoutineExecuteForm,
  RoutineExecuteResponse,
  RoutineSaveRequest,
  RoutinesListResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  getAllFunctions,
  getDatatypeOptions,
  getDefaultFunctionForField,
  getFunctionsForField,
  getSupportedDatatypes,
  getTypeClass,
} from '@bettermyadmin/mysql-types'
import { backquote, backquoteCompat } from '@bettermyadmin/sql-gen'
import { type CreateStatement, Parser, Context as SqlContext, TokensList } from '@bettermyadmin/sql-lexer'
import { MysqlError, NotFoundError } from '../http/errors.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import { isSuperUser } from '../server-admin/context.ts'
import { PrivilegeProbe, splitUserHost } from '../shell/privileges.ts'
import { type DbCtx, errorText, fetchColumn, msg, tryQuery } from './context.ts'
import { pager } from './structure.ts'

/**
 * Database → Routines: list, editor (create / edit = backup, DROP, CREATE, restore), execute
 * dialog, export, drop.
 * pma: src/Controllers/Database/RoutinesController.php, src/Database/Routines.php,
 *      templates/database/routines/*.twig
 */

const DIRECTIONS = ['IN', 'OUT', 'INOUT']
const SQL_DATA_ACCESS = ['CONTAINS SQL', 'NO SQL', 'READS SQL DATA', 'MODIFIES SQL DATA']
export const NUMERIC_OPTIONS = ['UNSIGNED', 'ZEROFILL', 'UNSIGNED ZEROFILL']

const serverInfo = (ctx: DbCtx) => ({
  vendor: (ctx.conn.serverInfo?.isMariaDb ? 'mariadb' : 'mysql') as 'mariadb' | 'mysql',
  version: ctx.conn.serverInfo?.versionInt ?? 0,
})

const probe = (ctx: DbCtx) => new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache)

/** Routines::getDetails (one page, ORDER BY SPECIFIC_NAME) */
async function details(ctx: DbCtx, type: string | null, name: string | null, limit = 0, offset = 0) {
  const collate = await ctx.dbi.collateForIS()
  let sql =
    'SELECT `SPECIFIC_NAME` AS `Name`, `ROUTINE_TYPE` AS `Type`, `DEFINER` AS `Definer`, `DTD_IDENTIFIER`' +
    ` FROM \`information_schema\`.\`ROUTINES\` WHERE \`ROUTINE_SCHEMA\` ${collate} = ${ctx.dbi.quoteString(ctx.db)}`
  if (type !== null) sql += ` AND \`ROUTINE_TYPE\` = '${type}'`
  if (name !== null) sql += ` AND \`SPECIFIC_NAME\` = ${ctx.dbi.quoteString(name)}`
  sql += ' ORDER BY `SPECIFIC_NAME`'
  if (limit > 0) sql += ` LIMIT ${limit} OFFSET ${offset}`
  return ctx.dbi.fetchResultSimple(sql)
}

/** Routines::getRow privileges */
async function rowFor(
  ctx: DbCtx,
  r: Record<string, string | null>,
  hasCreate: boolean,
  hasExecute: boolean,
  superUser: boolean,
) {
  const name = r.Name ?? ''
  const type = r.Type ?? ''
  const definer = r.Definer ?? ''
  const isDefiner = (await ctx.dbi.getCurrentUser()) === definer
  return {
    name,
    type,
    returns: r.DTD_IDENTIFIER ?? '',
    definer,
    dropSql: `DROP ${type} IF EXISTS ${backquote(name)}`,
    canEdit: (hasCreate && isDefiner) || superUser,
    canExport: (hasCreate && isDefiner) || superUser,
    canExecute: hasExecute || isDefiner,
  }
}

export async function routinesList(ctx: DbCtx, q: { type?: string | undefined; pos?: string | undefined }) {
  const type = q.type === 'PROCEDURE' || q.type === 'FUNCTION' ? q.type : null
  const total = Number(
    (await ctx.dbi.fetchValue(
      `SELECT COUNT(*) AS \`count\` FROM \`information_schema\`.\`ROUTINES\` WHERE \`ROUTINE_SCHEMA\` ${await ctx.dbi.collateForIS()} = ${ctx.dbi.quoteString(ctx.db)}${type !== null ? ` AND \`ROUTINE_TYPE\` = '${type}'` : ''}`,
    )) || 0,
  )
  const max = ctx.cfg.MaxRoutineList
  let pos = Math.max(0, Math.trunc(Number(q.pos ?? 0)) || 0)
  if (total > 0 && pos >= total) pos = Math.max(0, total - max)
  const rows = await details(ctx, type, null, max, pos)
  const p = probe(ctx)
  const hasCreate = await p.hasPrivilege('CREATE ROUTINE', ctx.db)
  const hasExecute = await p.hasPrivilege('EXECUTE', ctx.db)
  const superUser = await isSuperUser(ctx.dbi)
  const items = []
  for (const r of rows) items.push(await rowFor(ctx, r, hasCreate, hasExecute, superUser))
  const out: RoutinesListResponse = {
    items,
    canCreate: hasCreate,
    pager: pager(total, pos, max),
    codemirror: ctx.cfg.CodemirrorEnable,
  }
  return out
}

function definerSql(ctx: DbCtx, definer: string, errors: string[], allowQuoted: boolean): string {
  if (definer === '') return ''
  if (!definer.includes('@')) {
    errors.push(ctx.tr.gettext('The definer must be in the "username@hostname" format!'))
    return ''
  }
  const [user, host] = splitUserHost(definer)
  const quote = (s: string) =>
    allowQuoted ? backquoteCompat(s, 'NONE', !(s.startsWith('`') && s.endsWith('`'))) : backquote(s)
  return `DEFINER=${quote(user)}@${quote(host)} `
}

/** Routines::getQueryFromRequest */
export function routineQuery(ctx: DbCtx, req: RoutineSaveRequest, errors: string[]): string {
  const tr = ctx.tr
  const type = req.type === 'PROCEDURE' || req.type === 'FUNCTION' ? req.type : null
  let query = `CREATE ${definerSql(ctx, req.definer, errors, true)}`
  if (type !== null) query += `${type} `
  else errors.push(tr.gettext('Invalid routine type!'))
  if (req.name !== '') query += backquote(req.name)
  else errors.push(tr.gettext('You must provide a routine name!'))
  let warnedAboutLength = false
  let params = ''
  if (type !== null && req.params.length > 0) {
    let warnedAboutDir = false
    for (let i = 0; i < req.params.length; i++) {
      const p = req.params[i]!
      if (p.name === '' || p.type === '') {
        errors.push(tr.gettext('You must provide a name and a type for each routine parameter.'))
        break
      }
      if (type === 'PROCEDURE' && p.dir !== '' && DIRECTIONS.includes(p.dir)) {
        params += `${p.dir} ${backquote(p.name)} ${p.type}`
      } else if (type === 'FUNCTION') {
        params += `${backquote(p.name)} ${p.type}`
      } else if (!warnedAboutDir) {
        warnedAboutDir = true
        errors.push(sprintf(tr.gettext('Invalid direction "%s" given for parameter.'), p.dir))
      }
      if (
        p.length !== '' &&
        !/^(DATE|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN)$/i.test(
          p.type,
        )
      ) {
        params += `(${p.length})`
      } else if (p.length === '' && /^(ENUM|SET|VARCHAR|VARBINARY)$/i.test(p.type)) {
        if (!warnedAboutLength) {
          warnedAboutLength = true
          errors.push(
            tr.gettext(
              'You must provide length/values for routine parameters of type ENUM, SET, VARCHAR and VARBINARY.',
            ),
          )
        }
      }
      if (p.optsText !== '' && getTypeClass(p.type) === 'CHAR' && !['VARBINARY', 'BINARY'].includes(p.type)) {
        params += ` CHARSET ${p.optsText.toLowerCase()}`
      }
      if (p.optsNum !== '' && getTypeClass(p.type) === 'NUMBER') params += ` ${p.optsNum.toUpperCase()}`
      if (i !== req.params.length - 1) params += ', '
    }
  }
  query += `(${params}) `
  if (type === 'FUNCTION') {
    // processFunctionSpecificParameters
    const rt = req.returnType
    if (rt !== '' && getSupportedDatatypes(serverInfo(ctx)).includes(rt)) query += `RETURNS ${rt}`
    else errors.push(tr.gettext('You must provide a valid return type for the routine.'))
    if (
      req.returnLength !== '' &&
      !/^(DATE|DATETIME|TIME|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN)$/i.test(
        rt,
      )
    ) {
      query += `(${req.returnLength})`
    } else if (req.returnLength === '' && /^(ENUM|SET|VARCHAR|VARBINARY)$/i.test(rt) && !warnedAboutLength) {
      errors.push(
        tr.gettext(
          'You must provide length/values for routine parameters of type ENUM, SET, VARCHAR and VARBINARY.',
        ),
      )
    }
    if (req.returnOptsText !== '' && getTypeClass(rt) === 'CHAR')
      query += ` CHARSET ${req.returnOptsText.toLowerCase()}`
    if (req.returnOptsNum !== '' && getTypeClass(rt) === 'NUMBER')
      query += ` ${req.returnOptsNum.toUpperCase()}`
    query += ' '
  }
  if (req.comment !== '') query += `COMMENT ${ctx.dbi.quoteString(req.comment)} `
  query += req.isDeterministic ? 'DETERMINISTIC ' : 'NOT DETERMINISTIC '
  if (SQL_DATA_ACCESS.includes(req.sqlDataAccess)) query += `${req.sqlDataAccess} `
  if (req.securityType === 'DEFINER' || req.securityType === 'INVOKER')
    query += `SQL SECURITY ${req.securityType} `
  if (req.definition !== '') query += req.definition
  else errors.push(tr.gettext('You must provide a routine definition.'))
  return query
}

/** getErrorForFailedQuery (one line break since upstream 499f30824a) */
const failed = (ctx: DbCtx, sql: string, error: string) =>
  `${sprintf(ctx.tr.gettext('The following query has failed: "%s"'), sql)}\n${ctx.tr.gettext('MySQL said: ')}${error}`

/** The "One or more errors have occurred" card */
export function errorsMessage(ctx: DbCtx, errors: string[]): SqlMessage {
  return msg(
    'error',
    [
      ctx.tr.gettext('One or more errors have occurred while processing your request:'),
      ...errors.map((e) => `• ${e}`),
    ].join('\n'),
  )
}

export async function definitionOf(ctx: DbCtx, type: string, name: string): Promise<string | null> {
  return fetchColumn(
    ctx,
    `SHOW CREATE ${type === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'} ${backquote(ctx.db)}.${backquote(name)}`,
    type === 'FUNCTION' ? 'Create Function' : 'Create Procedure',
  )
}

/** Routines::handleRequestCreateOrEdit */
export async function saveRoutine(ctx: DbCtx, req: RoutineSaveRequest): Promise<{ messages: SqlMessage[] }> {
  const tr = ctx.tr
  const errors: string[] = []
  const query = routineQuery(ctx, req, errors)
  let sql = ''
  let message: SqlMessage | null = null
  if (errors.length === 0) {
    if (req.originalName !== undefined) {
      const ot = req.originalType ?? ''
      if (ot !== 'PROCEDURE' && ot !== 'FUNCTION') {
        errors.push(sprintf(tr.gettext('Invalid routine type: "%s"'), ot))
      } else {
        const backup = (await definitionOf(ctx, ot, req.originalName)) ?? ''
        const p = await getPrivileges(ctx.dbi)
        let privs: Array<Array<string | null>> = []
        if (p.routines && p.isReload && req.adjustPrivileges) {
          privs =
            (
              await ctx.dbi.tryQuery(
                `SELECT * FROM ${backquote('mysql')}.${backquote('procs_priv')} WHERE Routine_name = ${ctx.dbi.quoteString(req.originalName)} AND Routine_type = ${ctx.dbi.quoteString(ot)}`,
              )
            )?.rows ?? []
        }
        const drop = `DROP ${ot} ${backquote(req.originalName)};\n`
        const err = await tryQuery(ctx, drop, 'routines.drop')
        if (err !== null) errors.push(failed(ctx, drop, err))
        else {
          const e2 = await tryQuery(ctx, query, 'routines.create')
          if (e2 !== null) {
            errors.push(failed(ctx, query, e2))
            const e3 = await tryQuery(ctx, backup, 'routines.restore')
            if (e3 !== null) {
              errors.push(
                `${tr.gettext('Sorry, we failed to restore the dropped routine.')}\n${tr.gettext('The backed up query was:')}"${backup}"\n${tr.gettext('MySQL said: ')}${e3}`,
              )
            }
          } else {
            let adjusted = false
            if (p.routines && p.isReload) {
              const q = (s: string | null | undefined) => ctx.dbi.quoteString(s ?? '')
              for (const priv of privs) {
                await ctx.conn.query(
                  `INSERT INTO ${backquote('mysql')}.${backquote('procs_priv')} VALUES(${q(priv[0])}, ${q(priv[1])}, ${q(priv[2])}, ${q(req.name)}, ${q(req.type)}, ${q(priv[5])}, ${q(priv[6])}, ${q(priv[7])});`,
                  'routines.privileges',
                )
                adjusted = true
              }
            }
            if (adjusted) await ctx.dbi.tryQuery('FLUSH PRIVILEGES;')
            message = msg(
              'success',
              sprintf(
                tr.gettext(
                  adjusted
                    ? 'Routine %1$s has been modified. Privileges have been adjusted.'
                    : 'Routine %1$s has been modified.',
                ),
                backquote(req.name),
              ),
            )
            sql = drop + query
          }
        }
      }
    } else {
      const err = await tryQuery(ctx, query, 'routines.create')
      if (err !== null) errors.push(failed(ctx, query, err))
      else {
        message = msg('success', sprintf(tr.gettext('Routine %1$s has been created.'), backquote(req.name)))
        sql = query
      }
    }
  }
  if (errors.length > 0) return { messages: [errorsMessage(ctx, errors)] }
  return { messages: [{ ...(message ?? msg('success', '')), ...(sql !== '' ? { sql } : {}) }] }
}

/** Routines::getDataFromName */
export async function routineData(ctx: DbCtx, name: string, type: string): Promise<RoutineEditorData | null> {
  const collate = await ctx.dbi.collateForIS()
  const q = (s: string) => ctx.dbi.quoteString(s)
  const rows = await ctx.dbi.fetchResultSimple(
    `SELECT SPECIFIC_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION, IS_DETERMINISTIC, SQL_DATA_ACCESS, ROUTINE_COMMENT, SECURITY_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA ${collate}=${q(ctx.db)} AND SPECIFIC_NAME=${q(name)} AND ROUTINE_TYPE=${q(type)};`,
  )
  const r = rows[0]
  if (r === undefined) return null
  const def = await definitionOf(ctx, r.ROUTINE_TYPE ?? '', r.SPECIFIC_NAME ?? '')
  if (def === null) return null
  return SqlContext.run(ctx.conn.serverInfo?.context, () => {
    const st = new Parser(`DELIMITER $$\n${def}`).statements[0] as CreateStatement
    let body = TokensList.buildFromArray(st.body)
    if (body === '') body = r.ROUTINE_DEFINITION ?? ''
    const params = (st.parameters ?? []).map((p) => ({
      dir: String(p.inOut ?? ''),
      name: String(p.name ?? ''),
      type: p.type?.name ?? '',
      length: (p.type?.parameters ?? []).join(','),
      lengthArray: p.type?.parameters ?? [],
      optsText: '',
      optsNum: [...(p.type?.options?.options.values() ?? [])]
        .map((o) => (typeof o === 'object' ? (o.value ?? '') : String(o)))
        .join(' '),
    }))
    let returnType = ''
    let returnLength = ''
    let returnOptsText = ''
    let returnOptsNum = ''
    if ((r.DTD_IDENTIFIER ?? '') !== '' && st.return !== null) {
      returnType = st.return.name ?? ''
      returnLength = st.return.parameters.join(',')
      const o = st.return.options
      const cs = o?.has('CHARSET') ? o.get('CHARSET') : (o?.get('CHARACTER SET') ?? '')
      returnOptsText = String(cs).toLowerCase()
      returnOptsNum = [...(o?.options.values() ?? [])]
        .filter((x): x is string => typeof x === 'string' && NUMERIC_OPTIONS.includes(x))
        .join(' ')
    }
    const definer = st.options?.get('DEFINER')
    return {
      name: r.SPECIFIC_NAME ?? '',
      type: r.ROUTINE_TYPE === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE',
      params,
      returnType,
      returnLength,
      returnOptsText,
      returnOptsNum,
      definition: body,
      isDeterministic: r.IS_DETERMINISTIC === 'YES',
      definer: typeof definer === 'string' ? definer : String(definer ?? ''),
      securityType:
        r.SECURITY_TYPE === 'INVOKER' ? 'INVOKER' : r.SECURITY_TYPE === 'DEFINER' ? 'DEFINER' : '',
      sqlDataAccess: r.SQL_DATA_ACCESS ?? '',
      comment: r.ROUTINE_COMMENT ?? '',
    }
  })
}

/** What the editor needs besides the routine: datatypes, charsets, privileges. */
export async function routineEditorOptions(ctx: DbCtx) {
  const p = await getPrivileges(ctx.dbi)
  return {
    datatypes: getSupportedDatatypes(serverInfo(ctx)),
    types: getDatatypeOptions(serverInfo(ctx), '', (s) => ctx.tr.gettext(s)).map((o) =>
      'separator' in o
        ? { separator: true as const, group: o.group }
        : { group: o.group, type: o.type, description: o.description, lengthRestricted: o.lengthRestricted },
    ),
    charsets: (await ctx.reader.getCharsets()).map((c) => ({ name: c.name, description: c.description })),
    numericOptions: NUMERIC_OPTIONS,
    hasAdjustPrivileges: p.routines && p.isReload,
  }
}

const notFound = (ctx: DbCtx, name: string, editor = false) =>
  `${ctx.tr.gettext('Error in processing request:')} ${sprintf(
    editor
      ? // the editor of edit_item
        ctx.tr.gettext(
          'No routine with name %1$s found in database %2$s. You might be lacking the necessary privileges to edit this routine.',
        )
      : ctx.tr.gettext('No routine with name %1$s found in database %2$s.'),
    backquote(name),
    backquote(ctx.db),
  )}`

/** The editor: options, plus the routine in edit mode (RoutinesController add_item / edit_item). */
export async function routineEditor(ctx: DbCtx, name: string | undefined, type: string) {
  const options = await routineEditorOptions(ctx)
  if (name === undefined) return { options, routine: null }
  const routine = await routineData(ctx, name, type)
  if (routine === null) throw new NotFoundError(notFound(ctx, name, true))
  return { options, routine }
}

/** Routines::getExecuteForm */
export async function executeForm(ctx: DbCtx, name: string, type: string): Promise<RoutineExecuteForm> {
  const r = await routineData(ctx, name, type)
  if (r === null) throw new NotFoundError(notFound(ctx, name))
  const server = serverInfo(ctx)
  const params: RoutineExecuteForm['params'] = []
  r.params.forEach((p, i) => {
    // execute_form.twig renders every parameter; getExecuteForm prepares only the non-OUT ones
    // (an OUT row gets no function select and no date class)
    const isOut = r.type === 'PROCEDURE' && p.dir === 'OUT'
    let functions: Array<{ value: string; label: string; selected: boolean; title?: string }> | null = null
    if (!isOut && ctx.cfg.ShowFunctionFields && !/enum|set/i.test(p.type)) {
      const def = getDefaultFunctionForField(
        {
          trueType: p.type.toLowerCase(),
          firstTimestamp: false,
          defaultValue: '',
          extra: '',
          isNull: false,
          key: '',
          type: '',
          insertMode: false,
        },
        server,
      )
      // the whole list, password_hash() included: execute ignores a value outside getAllFunctions
      functions = getFunctionsForField(server, def, false, (s) => ctx.tr.gettext(s)).map((f) => ({
        value: f.value,
        label: f.label,
        selected: f.selected,
        ...(f.title !== undefined ? { title: f.title } : {}),
      }))
    }
    params.push({
      index: i,
      name: p.name,
      type: p.type,
      inputType: p.type === 'ENUM' ? 'radio' : p.type === 'SET' ? 'checkbox' : 'text',
      values:
        p.type === 'ENUM' || p.type === 'SET'
          ? p.lengthArray.map((v) => v.replace(/^'(.*)'$/s, '$1').replaceAll("''", "'"))
          : [],
      dateClass: isOut
        ? ''
        : p.type === 'DATETIME' || p.type === 'TIMESTAMP'
          ? 'datetimefield'
          : p.type === 'DATE'
            ? 'datefield'
            : '',
      functions,
    })
  })
  return { name: r.name, type: r.type, params, showFunctionFields: ctx.cfg.ShowFunctionFields }
}

/** Routines::handleExecuteRoutine */
export async function executeRoutine(
  ctx: DbCtx,
  req: {
    name: string
    type: string
    params: Record<string, string | string[]>
    funcs: Record<string, string>
  },
): Promise<RoutineExecuteResponse> {
  const r = await routineData(ctx, req.name, req.type)
  if (r === null) throw new NotFoundError(notFound(ctx, req.name))
  const queries: string[] = []
  const out: string[] = []
  const args: string[] = []
  const all = getAllFunctions(serverInfo(ctx))
  r.params.forEach((p, i) => {
    const v0 = req.params[p.name]
    if (v0 !== undefined) {
      const v = Array.isArray(v0) ? v0.join(',') : v0
      const fn = req.funcs[p.name] ?? ''
      if (fn !== '' && all.includes(fn)) queries.push(`SET @p${i}=${fn}(${ctx.dbi.quoteString(v)});`)
      else queries.push(`SET @p${i}=${ctx.dbi.quoteString(v)};`)
    }
    args.push(`@p${i}`)
    if (r.type === 'PROCEDURE' && (p.dir === 'OUT' || p.dir === 'INOUT')) {
      out.push(`@p${i} AS ${backquote(p.name)}`)
    }
  })
  if (r.type === 'PROCEDURE') {
    queries.push(`CALL ${backquote(r.name)}(${args.join(', ')});`)
    if (out.length > 0) queries.push(`SELECT ${out.join(', ')};`)
  } else {
    queries.push(`SELECT ${backquote(r.name)}(${args.join(', ')}) AS ${backquote(r.name)};`)
  }
  let affected = 0
  const resultSets: RoutineExecuteResponse['resultSets'] = []
  for (const q of queries) {
    try {
      const res = await ctx.conn.query(q, 'routines.execute')
      for (const set of res.resultSets) {
        if (set.rows.length === 0) continue
        resultSets.push({
          fields: set.fields.map((f) => f.name),
          rows: set.rows.map((row) => row.map((v) => (v === null ? null : v.toString('utf8')))),
        })
        affected = set.rows.length
      }
    } catch (e) {
      if (e instanceof MysqlError) {
        return {
          messages: [msg('error', failed(ctx, q, errorText(e)))],
          queries: [],
          title: '',
          resultSets: [],
          empty: false,
        }
      }
      throw e
    }
  }
  let text = ctx.tr.gettext('Your SQL query has been executed successfully.')
  if (r.type === 'PROCEDURE') {
    text += `\n${sprintf(
      ctx.tr.ngettext(
        '%d row affected by the last statement inside the procedure.',
        '%d rows affected by the last statement inside the procedure.',
        affected,
      ),
      affected,
    )}`
  }
  return {
    messages: [msg('success', text)],
    queries,
    title: sprintf(ctx.tr.gettext('Execution results of routine %s'), backquote(r.name)),
    resultSets,
    empty: resultSets.length === 0,
  }
}

/** RoutinesController export_item */
export async function exportRoutine(ctx: DbCtx, name: string, type: string): Promise<DbExportResponse> {
  const def = type === 'FUNCTION' || type === 'PROCEDURE' ? await definitionOf(ctx, type, name) : null
  if (def === null) {
    throw new NotFoundError(
      sprintf(
        ctx.tr.gettext(
          'Error in processing request: No routine with name %1$s found in database %2$s. You might be lacking the necessary privileges to view/export this routine.',
        ),
        backquote(name),
        backquote(ctx.db),
      ),
    )
  }
  return {
    title: sprintf(ctx.tr.gettext('Export of routine %s'), backquote(name)),
    sql: `DELIMITER $$\n${def}$$\nDELIMITER ;\n`.trim(),
  }
}
