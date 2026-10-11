import type {
  DbExportResponse,
  SqlMessage,
  TriggerEditorData,
  TriggerSaveRequest,
  TriggersListResponse,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { NotFoundError } from '../http/errors.ts'
import { PrivilegeProbe } from '../shell/privileges.ts'
import { type DbCtx, listTables, msg, tryQuery } from './context.ts'
import { errorsMessage } from './routines.ts'
import { getTriggers, triggerCreateSql } from './table-mover.ts'

/**
 * Triggers, database scope (`table` '') or table scope.
 * pma: src/Controllers/Triggers/IndexController.php, src/Triggers/Triggers.php
 */

const TIMES = ['BEFORE', 'AFTER']
const EVENTS = ['INSERT', 'UPDATE', 'DELETE']

export async function triggersList(ctx: DbCtx, table: string): Promise<TriggersListResponse> {
  const items = (await getTriggers(ctx, ctx.db, table)).map((t) => ({
    name: t.name,
    table: t.table,
    timing: t.timing,
    event: t.event,
    dropSql: `DROP TRIGGER IF EXISTS ${backquote(t.name)}`,
  }))
  return {
    items,
    codemirror: ctx.cfg.CodemirrorEnable,
    canCreate: await new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache).hasPrivilege(
      'TRIGGER',
      ctx.db,
      table === '' ? undefined : table,
    ),
    // pma: Triggers::getTables — base (and system-versioned) tables only
    tables: (
      await ctx.dbi.fetchResultSimple(
        `SELECT \`TABLE_NAME\` FROM \`INFORMATION_SCHEMA\`.\`TABLES\` WHERE \`TABLE_SCHEMA\`=${ctx.dbi.quoteString(ctx.db)} AND \`TABLE_TYPE\` IN ('BASE TABLE', 'SYSTEM VERSIONED')`,
      )
    ).map((r) => r.TABLE_NAME ?? ''),
  }
}

/** Triggers::getQueryFromRequest */
async function triggerQuery(ctx: DbCtx, req: TriggerSaveRequest, errors: string[]): Promise<string> {
  const tr = ctx.tr
  let query = 'CREATE '
  if (req.definer !== '') {
    if (req.definer.includes('@')) {
      const [u = '', h = ''] = req.definer.split('@')
      query += `DEFINER=${backquote(u)}@${backquote(h)} `
    } else errors.push(tr.gettext('The definer must be in the "username@hostname" format!'))
  }
  query += 'TRIGGER '
  if (req.name !== '') query += `${backquote(req.name)} `
  else errors.push(tr.gettext('You must provide a trigger name!'))
  if (TIMES.includes(req.timing)) query += `${req.timing} `
  else errors.push(tr.gettext('You must provide a valid timing for the trigger!'))
  if (EVENTS.includes(req.event)) query += `${req.event} `
  else errors.push(tr.gettext('You must provide a valid event for the trigger!'))
  query += 'ON '
  if (req.table !== '' && (await listTables(ctx)).includes(req.table)) query += backquote(req.table)
  else errors.push(tr.gettext('You must provide a valid table name!'))
  query += ' FOR EACH ROW '
  if (req.definition !== '') query += req.definition
  else errors.push(tr.gettext('You must provide a trigger definition.'))
  return query
}

const failed = (ctx: DbCtx, sql: string, error: string, sep = '\n') =>
  `${sprintf(ctx.tr.gettext('The following query has failed: "%s"'), sql)}${sep}${ctx.tr.gettext('MySQL said: ')}${error}`

/** Triggers::handleEditor */
export async function saveTrigger(
  ctx: DbCtx,
  scopeTable: string,
  req: TriggerSaveRequest,
): Promise<{ messages: SqlMessage[] }> {
  const tr = ctx.tr
  const errors: string[] = []
  const query = await triggerQuery(ctx, req, errors)
  let result: SqlMessage | null = null
  if (errors.length === 0) {
    if (req.originalName !== undefined) {
      const old = (await getTriggers(ctx, ctx.db, scopeTable)).find((t) => t.name === req.originalName)
      const backup = old !== undefined ? triggerCreateSql(old, '') : ''
      const drop = `DROP TRIGGER IF EXISTS ${backquote(req.originalName)}`
      const e1 = await tryQuery(ctx, drop, 'triggers.drop')
      if (e1 !== null) errors.push(failed(ctx, drop, e1))
      else {
        const e2 = await tryQuery(ctx, query, 'triggers.create')
        if (e2 !== null) {
          errors.push(failed(ctx, query, e2))
          const e3 = await tryQuery(ctx, backup, 'triggers.restore')
          if (e3 !== null) {
            errors.push(
              `${tr.gettext('Sorry, we failed to restore the dropped trigger.')}\n${tr.gettext('The backed up query was:')}"${backup}"\n${tr.gettext('MySQL said: ')}${e3}`,
            )
          }
        } else {
          result = msg(
            'success',
            sprintf(tr.gettext('Trigger %1$s has been modified.'), backquote(req.name)),
            drop + query,
          )
        }
      }
    } else {
      const e = await tryQuery(ctx, query, 'triggers.create')
      if (e !== null) errors.push(failed(ctx, query, e, '\n\n'))
      else
        result = msg(
          'success',
          sprintf(tr.gettext('Trigger %1$s has been created.'), backquote(req.name)),
          query,
        )
    }
  }
  if (errors.length > 0) return { messages: [errorsMessage(ctx, errors)] }
  return { messages: result === null ? [] : [result] }
}

export async function triggerData(ctx: DbCtx, table: string, name: string): Promise<TriggerEditorData> {
  const t = (await getTriggers(ctx, ctx.db, table)).find((x) => x.name === name)
  if (t === undefined) {
    throw new NotFoundError(
      `${ctx.tr.gettext('Error in processing request:')} ${sprintf(
        ctx.tr.gettext('No trigger with name %1$s found in database %2$s.'),
        backquote(name),
        backquote(ctx.db),
      )}`,
    )
  }
  return {
    name: t.name,
    table: t.table,
    timing: t.timing,
    event: t.event,
    definition: t.statement,
    definer: t.definer,
  }
}

export async function exportTrigger(ctx: DbCtx, table: string, name: string): Promise<DbExportResponse> {
  const t = (await getTriggers(ctx, ctx.db, table)).find((x) => x.name === name)
  if (t === undefined) {
    throw new NotFoundError(
      sprintf(
        ctx.tr.gettext('Error in processing request: No trigger with name %1$s found in database %2$s.'),
        backquote(name),
        backquote(ctx.db),
      ),
    )
  }
  return {
    title: sprintf(ctx.tr.gettext('Export of trigger %s'), backquote(name)),
    sql: `DELIMITER $$\n${triggerCreateSql(t, '$$')}`.trim(),
  }
}
