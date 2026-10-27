import type {
  DbExportResponse,
  EventEditorData,
  EventSaveRequest,
  EventsListResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { PrivilegeProbe, splitUserHost } from '../shell/privileges.ts'
import { type DbCtx, fetchColumn, msg, tryQuery } from './context.ts'
import { errorsMessage } from './routines.ts'

/**
 * Database → Events: list, scheduler status, editor, export.
 * pma: src/Controllers/Database/EventsController.php, src/Database/Events.php
 */

export const EVENT_STATUS = {
  display: ['ENABLED', 'DISABLED', 'SLAVESIDE_DISABLED'],
  query: ['ENABLE', 'DISABLE', 'DISABLE ON SLAVE'],
}
export const EVENT_TYPES = ['RECURRING', 'ONE TIME']
export const EVENT_INTERVALS = [
  'YEAR',
  'QUARTER',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'WEEK',
  'SECOND',
  'YEAR_MONTH',
  'DAY_HOUR',
  'DAY_MINUTE',
  'DAY_SECOND',
  'HOUR_MINUTE',
  'HOUR_SECOND',
  'MINUTE_SECOND',
]

/** Events::getDetails */
async function details(ctx: DbCtx, name: string | null) {
  let sql: string
  if (!ctx.server.DisableIS) {
    sql =
      'SELECT `EVENT_SCHEMA` AS `Db`, `EVENT_NAME` AS `Name`, `DEFINER` AS `Definer`, `TIME_ZONE` AS `Time zone`,' +
      ' `EVENT_TYPE` AS `Type`, `EXECUTE_AT` AS `Execute at`, `INTERVAL_VALUE` AS `Interval value`,' +
      ' `INTERVAL_FIELD` AS `Interval field`, `STARTS` AS `Starts`, `ENDS` AS `Ends`, `STATUS` AS `Status`,' +
      ' `ORIGINATOR` AS `Originator`, `CHARACTER_SET_CLIENT` AS `character_set_client`,' +
      ' `COLLATION_CONNECTION` AS `collation_connection`, `DATABASE_COLLATION` AS `Database Collation`' +
      ` FROM \`information_schema\`.\`EVENTS\` WHERE \`EVENT_SCHEMA\` ${await ctx.dbi.collateForIS()} = ${ctx.dbi.quoteString(ctx.db)}`
    if (name !== null) sql += ` AND \`EVENT_NAME\` = ${ctx.dbi.quoteString(name)}`
  } else {
    sql = `SHOW EVENTS FROM ${backquote(ctx.db)}`
    if (name !== null) sql += ` WHERE \`Name\` = ${ctx.dbi.quoteString(name)}`
  }
  const rows = await ctx.dbi.fetchResultSimple(sql)
  return rows
    .map((r) => ({ name: r.Name ?? '', type: r.Type ?? '', status: r.Status ?? '' }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** pma: Events::getEventSchedulerStatus */
export async function eventSchedulerStatus(ctx: DbCtx): Promise<EventsListResponse['schedulerState']> {
  const state = await ctx.dbi.tryQuery("SHOW GLOBAL VARIABLES LIKE 'event_scheduler'")
  const v = String(state?.rows[0]?.[1] ?? '').toUpperCase()
  if (v === 'DISABLED') return 'DISABLED'
  return v === 'ON' || v === '1' ? 'ON' : 'OFF'
}

/** The editor and the export answer nothing while the scheduler is DISABLED (Events\IndexController). */
async function requireScheduler(ctx: DbCtx): Promise<void> {
  if ((await eventSchedulerStatus(ctx)) === 'DISABLED') {
    throw new ValidationError(ctx.tr.gettext('The event scheduler is disabled.'))
  }
}

/** pma: Events\IndexController (the list) */
export async function eventsList(ctx: DbCtx): Promise<EventsListResponse> {
  const canCreate = await new PrivilegeProbe(ctx.conn, ctx.server, ctx.cache).hasPrivilege('EVENT', ctx.db)
  const schedulerState = await eventSchedulerStatus(ctx)
  const items =
    schedulerState === 'DISABLED'
      ? []
      : (await details(ctx, null)).map((e) => ({
          ...e,
          dropSql: `DROP EVENT IF EXISTS ${backquote(e.name)}`,
        }))
  return { items, schedulerState, codemirror: ctx.cfg.CodemirrorEnable, canCreate }
}

/** Events::getQueryFromRequest */
function eventQuery(ctx: DbCtx, req: EventSaveRequest, errors: string[]): string {
  const tr = ctx.tr
  let query = 'CREATE '
  if (req.definer !== '') {
    if (req.definer.includes('@')) {
      const [u, h] = splitUserHost(req.definer)
      query += `DEFINER=${backquote(u)}@${backquote(h)} `
    } else errors.push(tr.gettext('The definer must be in the "username@hostname" format!'))
  }
  query += 'EVENT '
  if (req.name !== '') query += `${backquote(req.name)} `
  else errors.push(tr.gettext('You must provide an event name!'))
  query += 'ON SCHEDULE '
  if (req.type !== '' && EVENT_TYPES.includes(req.type)) {
    if (req.type === 'RECURRING') {
      const n = Number.parseInt(req.intervalValue, 10)
      // 05917fbe4e: any non-empty value (also '0', which the server then refuses)
      if (req.intervalValue !== '' && EVENT_INTERVALS.includes(req.intervalField)) {
        query += `EVERY ${Number.isNaN(n) ? 0 : n} ${req.intervalField} `
      } else errors.push(tr.gettext('You must provide a valid interval value for the event.'))
      if (req.starts !== '') query += `STARTS ${ctx.dbi.quoteString(req.starts)} `
      if (req.ends !== '') query += `ENDS ${ctx.dbi.quoteString(req.ends)} `
    } else if (req.executeAt !== '') {
      query += `AT ${ctx.dbi.quoteString(req.executeAt)} `
    } else errors.push(tr.gettext('You must provide a valid execution time for the event.'))
  } else errors.push(tr.gettext('You must provide a valid type for the event.'))
  query += 'ON COMPLETION '
  if (!req.preserve) query += 'NOT '
  query += 'PRESERVE '
  const si = EVENT_STATUS.display.indexOf(req.status)
  if (si >= 0) query += `${EVENT_STATUS.query[si]} `
  if (req.comment !== '') query += `COMMENT ${ctx.dbi.quoteString(req.comment)} `
  query += 'DO '
  if (req.definition !== '') query += req.definition
  else errors.push(tr.gettext('You must provide an event definition.'))
  return query
}

/** getErrorForFailedQuery (one line break since upstream 499f30824a) */
const failed = (ctx: DbCtx, sql: string, error: string) =>
  `${sprintf(ctx.tr.gettext('The following query has failed: "%s"'), sql)}\n${ctx.tr.gettext('MySQL said: ')}${error}`

const definition = (ctx: DbCtx, name: string) =>
  fetchColumn(ctx, `SHOW CREATE EVENT ${backquote(ctx.db)}.${backquote(name)}`, 'Create Event')

/** Events::handleEditor + the "dropped immediately" check of EventsController */
export async function saveEvent(ctx: DbCtx, req: EventSaveRequest): Promise<{ messages: SqlMessage[] }> {
  const tr = ctx.tr
  await requireScheduler(ctx)
  const errors: string[] = []
  const query = eventQuery(ctx, req, errors)
  let result: SqlMessage | null = null
  if (errors.length === 0) {
    if (req.originalName !== undefined) {
      const backup = (await definition(ctx, req.originalName)) ?? ''
      const drop = `DROP EVENT IF EXISTS ${backquote(req.originalName)};\n`
      const e1 = await tryQuery(ctx, drop, 'events.drop')
      if (e1 !== null) errors.push(failed(ctx, drop, e1))
      else {
        const e2 = await tryQuery(ctx, query, 'events.create')
        if (e2 !== null) {
          errors.push(failed(ctx, query, e2))
          const e3 = await tryQuery(ctx, backup, 'events.restore')
          if (e3 !== null) {
            errors.push(
              `${tr.gettext('Sorry, we failed to restore the dropped event.')}\n${tr.gettext('The backed up query was:')}"${backup}"\n${tr.gettext('MySQL said: ')}${e3}`,
            )
          }
        } else {
          result = msg(
            'success',
            sprintf(tr.gettext('Event %1$s has been modified.'), backquote(req.name)),
            drop + query,
          )
        }
      }
    } else {
      const e = await tryQuery(ctx, query, 'events.create')
      if (e !== null) errors.push(failed(ctx, query, e))
      else
        result = msg(
          'success',
          sprintf(tr.gettext('Event %1$s has been created.'), backquote(req.name)),
          query,
        )
    }
  }
  if (errors.length > 0) return { messages: [errorsMessage(ctx, errors)] }
  if ((await details(ctx, req.name)).length === 0) {
    return { messages: [msg('error', tr.gettext('The event was dropped immediately after creation.'))] }
  }
  return { messages: result === null ? [] : [result] }
}

/** Events::getDataFromName */
export async function eventData(ctx: DbCtx, name: string): Promise<EventEditorData> {
  await requireScheduler(ctx)
  const r = (
    await ctx.dbi.fetchResultSimple(
      'SELECT `EVENT_NAME`, `STATUS`, `EVENT_TYPE`, `EXECUTE_AT`, `INTERVAL_VALUE`, `INTERVAL_FIELD`, `STARTS`, `ENDS`, `EVENT_DEFINITION`, `ON_COMPLETION`, `DEFINER`, `EVENT_COMMENT`' +
        ` FROM \`INFORMATION_SCHEMA\`.\`EVENTS\` WHERE EVENT_SCHEMA ${await ctx.dbi.collateForIS()}=${ctx.dbi.quoteString(ctx.db)} AND EVENT_NAME=${ctx.dbi.quoteString(name)};`,
    )
  )[0]
  if (r === undefined) {
    // pma: Events\IndexController (edit_item of an event that does not exist)
    throw new NotFoundError(
      `${ctx.tr.gettext('Error in processing request:')} ${sprintf(
        ctx.tr.gettext('No event with name %1$s found in database %2$s.'),
        backquote(name),
        backquote(ctx.db),
      )}`,
    )
  }
  return {
    name: r.EVENT_NAME ?? '',
    status: r.STATUS ?? '',
    type: r.EVENT_TYPE ?? '',
    executeAt: r.EXECUTE_AT ?? '',
    intervalValue: r.INTERVAL_VALUE ?? '',
    intervalField: r.INTERVAL_FIELD ?? '',
    starts: r.STARTS ?? '',
    ends: r.ENDS ?? '',
    definition: r.EVENT_DEFINITION ?? '',
    preserve: r.ON_COMPLETION === 'PRESERVE',
    definer: r.DEFINER ?? '',
    comment: r.EVENT_COMMENT ?? '',
  }
}

/** pma: Events\ExportController */
export async function exportEvent(ctx: DbCtx, name: string): Promise<DbExportResponse> {
  await requireScheduler(ctx)
  const def = await definition(ctx, name)
  if (def === null || def === '') {
    throw new NotFoundError(
      sprintf(
        ctx.tr.gettext('Error in processing request: No event with name %1$s found in database %2$s.'),
        backquote(name),
        backquote(ctx.db),
      ),
    )
  }
  return { title: sprintf(ctx.tr.gettext('Export of event %s'), backquote(name)), sql: def.trim() }
}
