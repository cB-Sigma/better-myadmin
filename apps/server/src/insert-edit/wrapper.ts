/**
 * Raw cell bytes of the transformation wrapper (images, downloads); the BLOB download
 * (/table/get-field) belongs to the Browse grid (routes/browse).
 * pma: src/Controllers/Transformation/WrapperController.php
 */

import { parseTransformationOptions } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { checkSqlSignature } from '../query/signature.ts'
import { type IeCtx, assoc, mimeMap } from './context.ts'
import { copyResampled, createTrueColor, encodeJpeg, encodePng, imageFromString } from './image.ts'

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
  newWidth?: string | undefined
  newHeight?: string | undefined
}

/** WrapperController::formatSize: 1 below 2 or not numeric, at most 2000 */
export function formatSize(size: string | undefined): number {
  const n =
    size === undefined || size.trim() === '' || !Number.isFinite(Number(size)) ? Number.NaN : Number(size)
  if (Number.isNaN(n) || n < 2) return 1
  if (n >= 2000) return 2000
  return Math.trunc(n)
}

/**
 * The thumbnail of `resize=jpeg|png`: the image fitted into newWidth × newHeight keeping its
 * ratio, resampled, then written as JPEG (quality 75) or PNG; null when it is not an image.
 */
export function resizeImage(
  bytes: Buffer,
  resize: 'jpeg' | 'png',
  newWidth: number,
  newHeight: number,
): Buffer | null {
  const src = imageFromString(bytes)
  if (src === null) return null
  const ratioWidth = src.width / newWidth
  const ratioHeight = src.height / newHeight
  // keep the image smaller than the new width and height
  let destWidth: number
  let destHeight: number
  if (ratioWidth < ratioHeight) {
    destWidth = Math.round(src.width / ratioHeight)
    destHeight = newHeight
  } else {
    destWidth = newWidth
    destHeight = Math.round(src.height / ratioWidth)
  }
  const dest = createTrueColor(destWidth, destHeight)
  copyResampled(dest, src, 0, 0, 0, 0, destWidth, destHeight, src.width, src.height)
  return resize === 'jpeg' ? encodeJpeg(dest, 75) : encodePng(dest)
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
  if (p.resize === 'jpeg' || p.resize === 'png') {
    // ImageWrapper::fromString === null: the download headers and an empty body
    const out = resizeImage(value, p.resize, formatSize(p.newWidth), formatSize(p.newHeight))
    return { status: 200, body: out ?? '', headers: downloadHeaders(p.cn ?? '', contentType) }
  }
  if (contentType.toLowerCase().includes('html')) {
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
