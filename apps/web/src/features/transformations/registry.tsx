import type { ColumnTransformations } from '@bettermyadmin/contracts'
import {
  type TransformContext,
  applyOutputTransformation,
  findTransformationPlugin,
  transformationNoWrap,
} from '@bettermyadmin/mysql-types'
import { SafeHtml } from '@bettermyadmin/ui'
import type { ReactNode } from 'react'
import { tablePath } from '../../lib/api'
import { useConfig } from '../../lib/config'
import { translator } from '../../lib/i18n'
import { HighlightedSql } from '../sql/HighlightedSql'

/**
 * Browser display transformations for the Browse grid (and anything else that shows a cell).
 *
 * The grid asks `GET …/tables/:t/transformations` (api.columnTransformations) once per table, then
 * renders each cell of a transformed column with `<TransformedCell>` (or `renderTransformation`).
 * Every output plugin of phpMyAdmin is implemented in @bettermyadmin/mysql-types
 * (applyOutputTransformation, which returns phpMyAdmin's HTML); this registry turns that into
 * React nodes: HTML through SafeHtml, the SQL plugins as highlighted SQL.
 *
 * pma: src/Display/Results.php (mediaTypeMap, applyTransformation, applyTransformationNoWrap)
 */

export type ColumnTransformation = ColumnTransformations['columns'][string]

/** Where a cell lives, to build its /transformation/wrapper link (signed where clause). */
export interface CellLocation {
  server: number
  db: string
  table: string
  column: string
  /** the row's unique condition and its signature; null = first row (`LIMIT 1`) */
  where: { clause: string; sig: string } | null
}

/** URL of the transformation wrapper of one cell (pma: /transformation/wrapper). */
export function wrapperUrl(loc: CellLocation, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ key: loc.column, ...extra })
  if (loc.where !== null) {
    p.set('where', loc.where.clause)
    p.set('sig', loc.where.sig)
  }
  return `/api${tablePath({ server: loc.server, db: loc.db, table: loc.table })}/transformation/wrapper?${p}`
}

/** Whether a column has a browser display transformation to apply (BrowseMIME on, plugin known). */
export function hasOutputTransformation(t: ColumnTransformation | undefined): t is ColumnTransformation {
  if (t === undefined || t.transformation === '') return false
  const p = findTransformationPlugin(t.transformation)
  return p !== null && p.kind !== 'input'
}

/** `applyTransformationNoWrap`: the cell gets `text-nowrap` (External with option 4 = 1). */
export const noWrap = (tr: ColumnTransformation) =>
  transformationNoWrap(tr.transformation, tr.transformationOptions)

/** The rendered cell value of a transformed column. */
export function renderTransformation(
  tr: ColumnTransformation,
  value: string | Uint8Array,
  loc: CellLocation,
  meta: TransformContext['meta'] = {},
  versionInt = 0,
  /** the client configuration (`DefaultTransformations`, `GD2Available`) */
  cfg: Record<string, unknown> = {},
  /** Text_Plain_External: the output of the program the server ran */
  external?: string,
): ReactNode {
  const out = applyOutputTransformation(tr.transformation, value, tr.transformationOptions, {
    meta,
    wrapperUrl: (extra) => wrapperUrl(loc, extra),
    t: (s) => translator().gettext(s),
    // $cfg['DefaultTransformations'] (the options a column leaves empty)
    ...(cfg.DefaultTransformations !== undefined
      ? { defaults: cfg.DefaultTransformations as NonNullable<TransformContext['defaults']> }
      : {}),
    // Config::isGd2Available: 'no' shows the image at 320×240 instead of a resized thumbnail link
    // ('auto' is available: the wrapper resamples like GD, apps/server/src/insert-edit/image.ts)
    gd2: cfg.GD2Available !== 'no',
    ...(external !== undefined ? { external } : {}),
  })
  if ('sql' in out) return <HighlightedSql sql={out.sql} versionInt={versionInt} />
  return <SafeHtml profile="transformation" html={out.html} />
}

/** A `<td>` content for a transformed cell, with phpMyAdmin's classes (`<mime_type> transformed`). */
export function TransformedCell(props: {
  transformation: ColumnTransformation
  value: string | Uint8Array
  location: CellLocation
  meta?: TransformContext['meta']
}) {
  const cfg = useConfig()
  const cls = `${props.transformation.mimetype.replaceAll('/', '_').toLowerCase()} transformed${noWrap(props.transformation) ? ' text-nowrap' : ''}`
  return (
    <span className={cls}>
      {renderTransformation(props.transformation, props.value, props.location, props.meta, 0, cfg)}
    </span>
  )
}
