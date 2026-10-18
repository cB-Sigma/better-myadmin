import type { MaintenanceResult } from '@bettermyadmin/contracts'
import { Alert, MySqlDocLink, Panel, PanelItem, PanelList } from '@bettermyadmin/ui'
import type { ReactNode } from 'react'
import { t } from '../../../lib/i18n'

/**
 * The result of a table maintenance operation (table Operations and the database Structure bulk
 * actions): the Msg rows per table, or the checksums, then the notices.
 */
const badge = (type: string) =>
  type === 'error'
    ? 'bg-error text-white'
    : type === 'warning'
      ? 'bg-warning text-black'
      : type === 'info' || type === 'note'
        ? 'bg-info text-white'
        : 'bg-bg-inset'

/** Twig's `title` filter: every word capitalised, the rest in lower case ("status" → "Status"). */
export const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s\-_])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

/**
 * The Msg rows of one table: an Op badge when the row's Op is not the operation, the Msg_type
 * badge, the text (`row.Op|title`, `row.Msg_type|title`).
 */
export function MaintenanceRows({
  rows,
  op,
}: {
  rows: MaintenanceResult['rows']
  /** the operation in lower case */
  op: string
}) {
  return (
    <PanelList>
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: result rows
        <PanelItem key={i}>
          {r.op.toLowerCase() !== op && (
            <span className="me-1 rounded bg-bg-inset px-1 text-xs">{titleCase(r.op)}</span>
          )}
          <span className={`me-1 rounded px-1 text-xs ${badge(r.msgType.toLowerCase())}`}>
            {titleCase(r.msgType)}
          </span>
          {r.msgText}
        </PanelItem>
      ))}
    </PanelList>
  )
}

/** pma: templates/table/maintenance/{analyze,check,checksum,optimize,repair}.twig */
export function MaintenanceResults({
  result,
  message,
}: {
  result: MaintenanceResult
  /** the page's Generator::getMessage card, under the heading (`message|raw`) */
  message?: ReactNode
}) {
  const tables = [...new Set(result.rows.map((r) => r.table))]
  return (
    <div className="space-y-2" data-testid="maintenance-result">
      <h2 className="flex items-center gap-1 text-lg">
        {result.title}
        <MySqlDocLink link={result.docPage} />
      </h2>
      {message}
      {result.checksums !== undefined ? (
        <table className="text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left">{t('Table')}</th>
              <th className="px-2 text-left">{t('Checksum')}</th>
            </tr>
          </thead>
          <tbody>
            {result.checksums.map((c) => (
              <tr key={c.table}>
                <td className="px-2">{c.table}</td>
                <td className="px-2">{c.checksum ?? <em>NULL</em>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        tables.map((name) => (
          <Panel key={name} title={name}>
            <MaintenanceRows rows={result.rows.filter((r) => r.table === name)} op={result.op} />
          </Panel>
        ))
      )}
      {(result.notices ?? []).map((n) => (
        <Alert key={n} variant="notice">
          {n}
        </Alert>
      ))}
    </div>
  )
}
