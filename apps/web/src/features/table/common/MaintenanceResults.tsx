import type { MaintenanceResult } from '@bettermyadmin/contracts'
import { Alert, Panel, PanelItem, PanelList } from '@bettermyadmin/ui'
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

/** pma: templates/table/maintenance/{analyze,check,checksum,optimize,repair}.twig */
export function MaintenanceResults({ result }: { result: MaintenanceResult }) {
  const tables = [...new Set(result.rows.map((r) => r.table))]
  return (
    <div className="space-y-2" data-testid="maintenance-result">
      <h2 className="text-lg">{result.title}</h2>
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
            <PanelList>
              {result.rows
                .filter((r) => r.table === name)
                .map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: result rows
                  <PanelItem key={i}>
                    {r.op.toLowerCase() !== result.op && (
                      <span className="me-1 rounded bg-bg-inset px-1 text-xs">{r.op}</span>
                    )}
                    <span className={`me-1 rounded px-1 text-xs ${badge(r.msgType.toLowerCase())}`}>
                      {r.msgType}
                    </span>
                    {r.msgText}
                  </PanelItem>
                ))}
            </PanelList>
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
