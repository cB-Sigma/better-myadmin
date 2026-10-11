import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImportRequest, type ImportResult, type ImportUploadCreated } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { importPage } from '../import/page.ts'
import { runFileImport } from '../import/service.ts'
import type { ServerEnv } from './server.ts'

/**
 * Import: the page view-model, a chunked upload of the file, then a job whose progress and result
 * stream as server-sent events.
 * Mounted at /api/servers/:s/import.
 * pma: src/Controllers/Import/ImportController.php, src/Controllers/Import/StatusController.php
 */
export const importRoutes = new Hono<ServerEnv>()

interface Upload {
  sessionId: string
  path: string
  size: number
  created: number
}
interface Job {
  sessionId: string
  serverIndex: number
  pairs: Array<[string, string]>
  upload: { path: string; name: string } | null
  created: number
}

const uploads = new Map<string, Upload>()
const jobs = new Map<string, Job>()
const TTL_MS = 60 * 60 * 1000
const UPLOAD_DIR = join(tmpdir(), 'bma-import')

function prune() {
  const now = Date.now()
  for (const [k, u] of uploads) {
    if (now - u.created > TTL_MS) {
      rmSync(u.path, { force: true })
      uploads.delete(k)
    }
  }
  for (const [k, j] of jobs) if (now - j.created > TTL_MS) jobs.delete(k)
}

/** GET …/import/page?db=&table= (pma: /server/import, /database/import, /table/import) */
importRoutes.get('/page', async (c) => c.json(await importPage(c)))

/** POST …/import/uploads: starts a chunked upload of `import_file` */
importRoutes.post('/uploads', (c) => {
  prune()
  mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 })
  const id = randomBytes(16).toString('hex')
  const path = join(UPLOAD_DIR, id)
  writeFileSync(path, '', { mode: 0o600 })
  uploads.set(id, { sessionId: c.get('session').id, path, size: 0, created: Date.now() })
  return c.json({ id } satisfies ImportUploadCreated)
})

/** PATCH …/import/uploads/:id?offset=n: appends one chunk (the raw request body) */
importRoutes.patch('/uploads/:id{[0-9a-f]{32}}', async (c) => {
  const u = uploads.get(c.req.param('id'))
  if (u === undefined || u.sessionId !== c.get('session').id)
    throw new NotFoundError(c.get('tr').gettext('Not found.'))
  const offset = Number(c.req.query('offset') ?? '-1')
  if (offset !== u.size) throw new ValidationError(c.get('tr').gettext('Invalid request.'))
  const body = Buffer.from(await c.req.arrayBuffer())
  const max = c.get('deps').cfg.MaxUploadSize
  if (u.size + body.length > max) {
    throw new ValidationError(
      c
        .get('tr')
        .gettext(
          'You probably tried to upload a file that is too large. Please refer to %sdocumentation%s for a workaround for this limit.',
        )
        .replace('%s', '')
        .replace('%s', ''),
    )
  }
  appendFileSync(u.path, body)
  u.size += body.length
  return c.json({ size: statSync(u.path).size })
})

/** POST …/import/jobs: registers the import form (and its upload); the events run it */
importRoutes.post('/jobs', async (c) => {
  prune()
  const body = await parseJson(c, ImportRequest)
  let upload: Job['upload'] = null
  if (body.upload !== undefined) {
    const u = uploads.get(body.upload.id)
    if (u === undefined || u.sessionId !== c.get('session').id)
      throw new NotFoundError(c.get('tr').gettext('Not found.'))
    upload = { path: u.path, name: body.upload.name }
    uploads.delete(body.upload.id)
  }
  const id = randomBytes(16).toString('hex')
  jobs.set(id, {
    sessionId: c.get('session').id,
    serverIndex: c.get('serverIndex'),
    pairs: body.params,
    upload,
    created: Date.now(),
  })
  return c.json({ id })
})

/** GET …/import/jobs/:id/events: `progress` events, then one `result` (pma: /import-status) */
importRoutes.get('/jobs/:id{[0-9a-f]{32}}/events', (c) => {
  const id = c.req.param('id')
  const job = jobs.get(id)
  if (
    job === undefined ||
    job.sessionId !== c.get('session').id ||
    job.serverIndex !== c.get('serverIndex')
  ) {
    throw new NotFoundError(c.get('tr').gettext('Not found.'))
  }
  jobs.delete(id)
  return streamSSE(c, async (stream) => {
    let last = 0
    try {
      const result: ImportResult = await runFileImport(c, job.pairs, job.upload, (p) => {
        const now = Date.now()
        if (now - last < 200) return
        last = now
        void stream.writeSSE({ event: 'progress', data: JSON.stringify(p) })
      })
      await stream.writeSSE({ event: 'result', data: JSON.stringify(result) })
    } catch (e) {
      const message = e instanceof Error ? `${e.message}${process.env.F07_DEBUG ? e.stack : ''}` : String(e)
      await stream.writeSSE({ event: 'failure', data: JSON.stringify({ message }) })
    } finally {
      if (job.upload !== null) rmSync(job.upload.path, { force: true })
    }
  })
})
