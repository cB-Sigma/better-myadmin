import type { CollationsResponse } from '@bettermyadmin/contracts'
import { collationDescription } from '@bettermyadmin/mysql-types'
import type { AdminCtx } from './context.ts'

export interface Charset {
  name: string
  description: string
  defaultCollation: string
}

export interface Collation {
  name: string
  charset: string
  description: string
  isDefault: boolean
}

/** PHP ksort($a, SORT_STRING): byte order */
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))

/**
 * Charsets and collations of the server, sorted like phpMyAdmin (ksort SORT_STRING), with the
 * collation descriptions built from their names. Cached per request in phpMyAdmin (static
 * properties); here per call site.
 * pma: src/Charsets.php::loadCharsets, ::loadCollations
 */
const charsetCache = new WeakMap<AdminCtx, Promise<Charset[]>>()
const collationCache = new WeakMap<AdminCtx, Promise<Map<string, Collation[]>>>()

export function loadCharsets(ctx: AdminCtx): Promise<Charset[]> {
  let p = charsetCache.get(ctx)
  if (p === undefined) {
    p = readCharsets(ctx)
    charsetCache.set(ctx, p)
  }
  return p
}

export function loadCollations(ctx: AdminCtx): Promise<Map<string, Collation[]>> {
  let p = collationCache.get(ctx)
  if (p === undefined) {
    p = readCollations(ctx)
    collationCache.set(ctx, p)
  }
  return p
}

async function readCharsets(ctx: AdminCtx): Promise<Charset[]> {
  const sql = ctx.server.DisableIS
    ? 'SHOW CHARACTER SET'
    : 'SELECT `CHARACTER_SET_NAME` AS `Charset`, `DEFAULT_COLLATE_NAME` AS `Default collation`, `DESCRIPTION` AS `Description`, `MAXLEN` AS `Maxlen` FROM `information_schema`.`CHARACTER_SETS`'
  const rows = await ctx.conn.rows(sql, 'charsets.list')
  const map = new Map<string, Charset>()
  for (const r of rows) {
    map.set(r.Charset ?? '', {
      name: r.Charset ?? '',
      description: r.Description ?? '',
      defaultCollation: r['Default collation'] ?? '',
    })
  }
  return [...map.values()].sort((a, b) => byteOrder(a.name, b.name))
}

async function readCollations(ctx: AdminCtx): Promise<Map<string, Collation[]>> {
  let sql: string
  if (ctx.isMariaDb && ctx.versionInt >= 101000) {
    sql =
      'SELECT `collapp`.`FULL_COLLATION_NAME` AS `Collation`, `collapp`.`CHARACTER_SET_NAME` AS `Charset`, `collapp`.`ID` AS `Id`, `collapp`.`IS_DEFAULT` AS `Default`, `coll`.`IS_COMPILED` AS `Compiled`, `coll`.`SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATION_CHARACTER_SET_APPLICABILITY` `collapp` LEFT JOIN `information_schema`.`COLLATIONS` `coll` ON `collapp`.`COLLATION_NAME`=`coll`.`COLLATION_NAME`'
  } else if (ctx.server.DisableIS) {
    sql = 'SHOW COLLATION'
  } else {
    sql =
      'SELECT `COLLATION_NAME` AS `Collation`, `CHARACTER_SET_NAME` AS `Charset`, `ID` AS `Id`, `IS_DEFAULT` AS `Default`, `IS_COMPILED` AS `Compiled`, `SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATIONS`'
  }
  const rows = await ctx.conn.rows(sql, 'charsets.collations')
  const byCharset = new Map<string, Map<string, Collation>>()
  for (const r of rows) {
    const charset = r.Charset ?? ''
    const name = r.Collation ?? ''
    const list = byCharset.get(charset) ?? new Map<string, Collation>()
    list.set(name, {
      name,
      charset,
      description: collationDescription(name, ctx.tr),
      isDefault: r.Default === 'Yes' || r.Default === '1',
    })
    byCharset.set(charset, list)
  }
  const out = new Map<string, Collation[]>()
  for (const [charset, list] of byCharset) {
    out.set(
      charset,
      [...list.values()].sort((a, b) => byteOrder(a.name, b.name)),
    )
  }
  return out
}

/** pma: src/Controllers/Server/CollationsController.php */
export async function collationsPage(ctx: AdminCtx): Promise<CollationsResponse> {
  const charsets = await loadCharsets(ctx)
  const collations = await loadCollations(ctx)
  return {
    charsets: charsets.map((c) => ({
      name: c.name,
      description: c.description,
      collations: (collations.get(c.name) ?? []).map((k) => ({
        name: k.name,
        description: k.description,
        isDefault: k.isDefault,
      })),
    })),
  }
}

/** Charsets::findCollationByName */
export function findCollation(collations: Map<string, Collation[]>, name: string): Collation | null {
  const charset = name.split('_')[0] ?? ''
  return collations.get(charset)?.find((c) => c.name === name) ?? null
}
