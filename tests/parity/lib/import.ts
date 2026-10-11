import type { testApp } from '../../../apps/server/test/support/app.ts'
import { findForm, serializeForm } from './form.ts'
import type { PmaClient } from './pma.ts'

/** Shared pieces of the import parity suite: phpMyAdmin's import form and both tools' outcome. */
export type Pairs = Array<[string, string]>

export interface ImportFile {
  name: string
  data: Buffer
}

/** The `import` form of phpMyAdmin's import page for a scope (the file input left out). */
export async function pmaImportForm(
  pma: PmaClient,
  scope: 'server' | 'database' | 'table',
  params: Record<string, string> = {},
): Promise<Pairs> {
  const html = await pma.pageGet(`/${scope}/import`, params)
  return serializeForm(findForm(html, { id: 'import_file_form' })).filter(
    ([k]) => k !== 'token' && k !== 'import_file',
  )
}

const strip = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\(Query took [\d.]+ seconds\.\)/g, '')
    .replace(/, Query took [\d.]+ seconds\.\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim()

/** The message texts of phpMyAdmin's result page, in order (alerts and error cards). */
export function pmaMessages(html: string): string[] {
  const start = html.indexOf('id="page_content"')
  const body = start < 0 ? html : html.slice(start)
  const out: string[] = []
  for (const m of body.matchAll(/<div class="alert alert-(\w+)[^"]*" role="alert">([\s\S]*?)<\/div>/g)) {
    // the results grid's own notice (part of the grid data in BetterMyAdmin)
    if ((m[2] as string).includes('Current selection does not contain a unique column')) continue
    let text = strip(m[2] as string)
    // an error card: the server's message is compared
    const said = text.indexOf('MySQL said:')
    if (said >= 0) text = text.slice(said + 'MySQL said:'.length).trim()
    out.push(`${m[1] === 'danger' ? 'error' : (m[1] as string)}: ${text}`)
  }
  return out
}

export async function pmaImport(pma: PmaClient, pairs: Pairs, file: ImportFile | null): Promise<string[]> {
  const html = await pma.postMultipart(
    '/import',
    pairs,
    file === null ? null : { field: 'import_file', ...file },
  )
  return pmaMessages(html)
}

type Bma = ReturnType<typeof testApp>

/** Uploads in chunks, registers the job, reads the SSE stream; the result's messages like pmaMessages. */
export async function bmaImport(
  bma: Bma,
  token: string,
  pairs: Pairs,
  file: ImportFile | null,
): Promise<{ messages: string[]; result: Record<string, unknown> }> {
  const cookie = [...bma.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  let upload: { id: string; name: string } | undefined
  if (file !== null) {
    const u = await bma.req('POST', '/api/servers/1/import/uploads', {})
    const id = u.json.id as string
    const CHUNK = 64 * 1024
    for (let off = 0; off < file.data.length || off === 0; off += CHUNK) {
      const res = await bma.app.request(`/api/servers/1/import/uploads/${id}?offset=${off}`, {
        method: 'PATCH',
        headers: { cookie, 'X-BMA-Token': token, 'content-type': 'application/octet-stream' },
        body: file.data.subarray(off, off + CHUNK),
      })
      if (res.status !== 200) throw new Error(`upload failed: ${await res.text()}`)
      if (file.data.length === 0) break
    }
    upload = { id, name: file.name }
  }
  const job = await bma.req('POST', '/api/servers/1/import/jobs', {
    params: pairs,
    ...(upload ? { upload } : {}),
  })
  if (job.status !== 200) throw new Error(`job failed: ${JSON.stringify(job.json)}`)
  const res = await bma.app.request(`/api/servers/1/import/jobs/${job.json.id as string}/events`, {
    headers: { cookie },
  })
  const text = await res.text()
  const ev = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)]
  const last = ev.find((e) => e[1] === 'result' || e[1] === 'failure')
  if (last === undefined) throw new Error(`no result: ${text.slice(0, 500)}`)
  const result = JSON.parse(last[2] as string) as Record<string, unknown>
  if (last[1] === 'failure') return { messages: [`failure: ${result.message as string}`], result }
  const messages: string[] = []
  for (const e of (result.echoed as string[] | undefined) ?? []) messages.push(`error: ${strip(e)}`)
  const msg = result.message as { type: string; html: string } | undefined
  if (msg !== undefined) messages.push(`${msg.type}: ${strip(msg.html)}`)
  const err = result.error as { error?: { serverMessage: string } } | undefined
  if (err?.error !== undefined) messages.push(`error: ${strip(err.error.serverMessage)}`)
  type St = {
    message: { type: string; text: string }
    warnings: Array<{ level: string; code: number; message: string }>
  }
  for (const st of (result.statements as St[] | undefined) ?? []) {
    messages.push(`${st.message.type}: ${strip(st.message.text)}`)
    for (const w of st.warnings) messages.push(`primary: ${w.level}: #${w.code} ${strip(w.message)}`)
  }
  return { messages, result }
}
