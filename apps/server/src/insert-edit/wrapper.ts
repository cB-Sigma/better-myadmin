/**
 * Raw cell bytes: the transformation wrapper (images, downloads) and the BLOB download.
 * pma: src/Controllers/Transformation/WrapperController.php, src/Controllers/Table/GetFieldController.php,
 *      src/Mime.php::detect
 */

import { parseTransformationOptions } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { checkSqlSignature } from '../query/signature.ts'
import { type IeCtx, assoc, mimeMap } from './context.ts'

export interface RawCell {
  status: number
  body: Buffer | string
  headers: Record<string, string>
}

const empty = (): RawCell => ({
  status: 200,
  body: '',
  headers: { 'content-type': 'text/html; charset=utf-8' },
})

/** Core::downloadHeader */
function downloadHeaders(name: string, mime: string, length?: number): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': mime,
    'content-transfer-encoding': 'binary',
    'cache-control': 'private, max-age=0',
  }
  if (name !== '') h['content-disposition'] = `attachment; filename="${name.replace(/["\r\n]/g, '')}"`
  if (length !== undefined) h['content-length'] = String(length)
  return h
}

async function fetchRow(
  ctx: IeCtx,
  where: string | null,
  sig: string | null,
): Promise<Map<string, Buffer | null> | null | 'bad'> {
  let sql: string
  if (where === null) {
    sql = `SELECT * FROM ${backquote(ctx.table)} LIMIT 1;`
  } else {
    if (
      where === '' ||
      sig === null ||
      sig === '' ||
      !checkSqlSignature(where, sig, ctx.hmacSecret, ctx.cfg.blowfish_secret)
    ) {
      return 'bad'
    }
    sql = `SELECT * FROM ${backquote(ctx.table)} WHERE ${where};`
  }
  const r = await ctx.conn.query(sql, 'transformation.wrapper')
  const set = r.resultSets[0]
  const row = set?.rows[0]
  return set === undefined || row === undefined ? null : assoc(set.fields, row)
}

export interface WrapperParams {
  key: string
  where: string | null
  sig: string | null
  ct?: string | undefined
  cn?: string | undefined
  resize?: string | undefined
}

/** GET …/transformation/wrapper */
export async function transformationWrapper(ctx: IeCtx, p: WrapperParams): Promise<RawCell> {
  const row = await fetchRow(ctx, p.where, p.sig)
  if (row === 'bad') {
    /* l10n: In case a SQL query did not pass a security check  */
    return {
      status: 400,
      body: ctx.tr.gettext('There is an issue with your request.'),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }
  }
  const value = row?.get(p.key)
  if (row === null || value === null || value === undefined || value.length === 0) return empty()
  let mediaType = ''
  let charset = ''
  if (ctx.rp.columnCommentsFeature !== null && ctx.rp.browserTransformationFeature !== null) {
    const m = (await mimeMap(ctx))[p.key]
    mediaType = m?.mimetype ?? ''
    for (const o of parseTransformationOptions(m?.transformation_options ?? '')) {
      if (o.startsWith('; charset=')) charset = o
    }
  }
  let contentType: string
  if (p.ct !== undefined && p.ct !== '') contentType = p.ct
  else
    contentType = (mediaType !== '' ? mediaType.replaceAll('_', '/') : 'application/octet-stream') + charset
  // resize=jpeg|png: phpMyAdmin resamples with GD; the original image is sent and the browser
  // scales it to the requested box (parity exception: no image library on the server)
  if (p.resize !== 'jpeg' && p.resize !== 'png' && contentType.toLowerCase().includes('html')) {
    const s = value
      .toString('utf8')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
    return { status: 200, body: s, headers: downloadHeaders(p.cn ?? '', contentType) }
  }
  return { status: 200, body: value, headers: downloadHeaders(p.cn ?? '', contentType, value.length) }
}

/** pma: Mime::detect */
export function detectMime(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.length >= 3 && b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image/png'
  return 'application/octet-stream'
}

/** GET …/get-field (BLOB download as `<table>-<column>.bin`) */
export async function getField(ctx: IeCtx, p: { key: string; where: string; sig: string }): Promise<RawCell> {
  if (p.where === '' || !checkSqlSignature(p.where, p.sig, ctx.hmacSecret, ctx.cfg.blowfish_secret)) {
    return {
      status: 400,
      body: ctx.tr.gettext('There is an issue with your request.'),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }
  }
  const r = await ctx.conn.query(
    `SELECT ${backquote(p.key)} FROM ${backquote(ctx.table)} WHERE ${p.where} LIMIT 1;`,
    'table.get-field',
  )
  const v = r.resultSets[0]?.rows[0]?.[0] ?? Buffer.alloc(0)
  return {
    status: 200,
    body: v,
    headers: downloadHeaders(`${ctx.table}-${p.key}.bin`, detectMime(v), v.length),
  }
}
