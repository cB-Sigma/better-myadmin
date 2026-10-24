import { randomBytes } from 'node:crypto'
import { constants, accessSync, closeSync, existsSync, openSync, statSync, writeSync } from 'node:fs'
import { ExportRequest, type ExportResponse } from '@bettermyadmin/contracts'
import { ExportRequestError, Params, prepareExport } from '@bettermyadmin/export'
import { sprintf } from '@bettermyadmin/i18n'
import { type Context, Hono } from 'hono'
import { stream } from 'hono/streaming'
import { exportPageRoutes } from '../export/page.ts'
import { openExportSession, userDir } from '../export/service.ts'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { recordSqlBoxHistory } from '../metadata/hooks.ts'
import { defaultOfPath } from '../metadata/service.ts'
import type { ServerEnv } from './server.ts'

/**
 * Export: POST the dump form, GET the one-shot download (streamed).
 * Mounted at /api/servers/:s/export.
 * pma: src/Controllers/Export/ExportController.php
 */
export const exportRoutes = new Hono<ServerEnv>()

interface PendingExport {
  sessionId: string
  serverIndex: number
  pairs: Array<[string, string]>
  created: number
}

const pending = new Map<string, PendingExport>()
const TTL_MS = 10 * 60 * 1000

function prune() {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.created > TTL_MS) pending.delete(k)
}

function requestError(e: unknown): never {
  if (e instanceof ExportRequestError) throw new ValidationError(e.message)
  throw e
}

exportRoutes.route('/', exportPageRoutes)

/** POST …/export: validates the form; saves on the server or returns a download id. */
exportRoutes.post('/', async (c) => {
  const body = await parseJson(c, ExportRequest)
  const params = new Params(body.params)
  const tr = c.get('tr')
  const s = await openExportSession(c, params.str('db'))
  try {
    // StatementHistory: an export of a result posts its query (sql_query)
    await recordSqlBoxHistory(s.meta, {
      current: { db: params.str('db'), table: params.str('table'), sqlQuery: params.str('sql_query') },
    }).catch((e) => console.error('metadata history:', e))
    const prepared = await prepareExport(s.env, params).catch(requestError)
    // Export::rememberFilename (UserPreferencesHandler::setUserValue)
    if (prepared.rememberTemplate !== null && prepared.exportType !== 'raw') {
      const key = { server: 'server', database: 'database', table: 'table' }[prepared.exportType]
      const path = `Export/file_template_${key}`
      await (await s.meta.meta())
        .userPreferences()
        .persistOption(path, prepared.rememberTemplate, defaultOfPath(path))
    }
    if (prepared.postedAliases !== null) {
      c.get('session').exportAliases = prepared.postedAliases
    }
    if (prepared.saveOnServer) {
      // OutputHandler::openFile / closeFile
      const path = userDir(s.user, s.settings.SaveDir) + prepared.filename.replace(/[/\\]/g, '_')
      const overwrite = prepared.isQuickExport
        ? params.get('quick_export_onserver_overwrite') === 'saveitover'
        : params.get('onserver_overwrite') === 'saveitover'
      const fail = (msgid: string): ExportResponse => ({
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        asFile: true,
        message: { type: 'error', text: sprintf(tr.gettext(msgid), path) },
      })
      if (existsSync(path) && !overwrite) {
        return c.json(fail('File %s already exists on server, change filename or check overwrite option.'))
      }
      let fd: number
      try {
        if (existsSync(path) && statSync(path).isFile()) accessSync(path, constants.W_OK)
        fd = openSync(path, 'w')
      } catch {
        return c.json(fail('The web server does not have permission to save the file %s.'))
      }
      let complete = true
      try {
        await prepared.run({
          write(chunk) {
            if (complete && writeSync(fd, chunk) !== chunk.length) complete = false
          },
        })
      } catch {
        complete = false
      } finally {
        closeSync(fd)
      }
      if (!complete) return c.json(fail('Insufficient space to save the file %s.'))
      return c.json({
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        asFile: true,
        message: { type: 'success', text: sprintf(tr.gettext('Dump has been saved to file %s.'), path) },
      } satisfies ExportResponse)
    }
    prune()
    const id = randomBytes(16).toString('hex')
    pending.set(id, {
      sessionId: c.get('session').id,
      serverIndex: c.get('serverIndex'),
      pairs: body.params,
      created: Date.now(),
    })
    return c.json({
      id,
      filename: prepared.filename,
      mimeType: prepared.mimeType,
      asFile: prepared.asFile,
    } satisfies ExportResponse)
  } finally {
    await s.close()
  }
})

/** GET …/export/:id: streams the dump (attachment, or text/plain for "View output as text"). */
exportRoutes.get('/:id{[0-9a-f]{32}}', async (c: Context<ServerEnv>) => {
  const job = pending.get(c.req.param('id') ?? '')
  if (
    job === undefined ||
    job.sessionId !== c.get('session').id ||
    job.serverIndex !== c.get('serverIndex')
  ) {
    // i18n-new: API error (phpMyAdmin has no JSON API)
    throw new NotFoundError(c.get('tr').gettext('Not found.'))
  }
  pending.delete(c.req.param('id') ?? '')
  const params = new Params(job.pairs)
  const s = await openExportSession(c, params.str('db'))
  let prepared: Awaited<ReturnType<typeof prepareExport>>
  try {
    prepared = await prepareExport(s.env, params).catch(requestError)
  } catch (e) {
    await s.close()
    throw e
  }
  if (prepared.asFile) {
    c.header('Content-Type', prepared.mimeType)
    c.header(
      'Content-Disposition',
      `attachment; filename="${prepared.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(prepared.filename)}`,
    )
  } else {
    c.header('Content-Type', 'text/plain; charset=utf-8')
  }
  c.header('Cache-Control', 'no-store')
  return stream(c, async (out) => {
    try {
      await prepared.run({ write: (chunk) => out.write(chunk).then(() => undefined) })
    } finally {
      await s.close()
    }
  })
})

/** GET …/export/check-time-out (pma: /export/check-time-out): the stream has no PHP time limit. */
// the protocol value CheckTimeOutController answers ('success' / 'timeout'), not a message
const NOT_TIMED_OUT = 'success'
exportRoutes.get('/check-time-out', (c) => c.json({ message: NOT_TIMED_OUT }))
