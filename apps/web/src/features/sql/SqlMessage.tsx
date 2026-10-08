import type { StatementResult } from '@bettermyadmin/contracts'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

const styles = {
  success: { box: 'border-success/40 bg-success-bg text-success', Icon: CheckCircle2 },
  notice: { box: 'border-notice/40 bg-notice-bg text-notice', Icon: AlertTriangle },
  error: { box: 'border-error/40 bg-error-bg text-error', Icon: XCircle },
} as const

/**
 * The executed-query card: message + SQL.
 * pma: src/Html/Generator.php::getMessage (action links arrive with M1)
 */
export function SqlMessage({ st }: { st: StatementResult }) {
  if (st.kind === 'error') {
    // pma: Generator::mysqlDie — "Error", "SQL query:" (the SQL actually sent), "MySQL said:"
    return (
      <div
        role="alert"
        className="mb-3 rounded border border-error/40 bg-error-bg px-3 py-2 text-sm text-error"
      >
        <div className="flex items-center gap-2 font-semibold">
          <XCircle className="size-4" aria-hidden />
          Error
        </div>
        <div className="mt-2 text-xs font-semibold">SQL query:</div>
        <pre className="my-1 overflow-x-auto font-mono text-xs" dir="ltr">
          <code className="sql">{st.executedSql}</code>
        </pre>
        <div className="text-xs font-semibold">MySQL said:</div>
        <code className="text-xs">{st.message.text}</code>
      </div>
    )
  }
  const { box, Icon } = styles[st.message.type]
  return (
    <div className="mb-3 overflow-hidden rounded border border-border">
      <div className={`flex items-start gap-2 border-b px-3 py-2 text-sm ${box}`} role="status">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 whitespace-pre-line">{st.message.text}</div>
      </div>
      <pre className="overflow-x-auto bg-bg-inset px-3 py-2 font-mono text-xs" dir="ltr">
        <code className="sql">{st.sql}</code>
      </pre>
      {st.warnings.map((w, i) => (
        <div
          key={`${w.code}-${i}`}
          className="border-t border-border bg-notice-bg px-3 py-1 text-xs text-notice"
        >
          {w.level}: #{w.code} {w.message}
        </div>
      ))}
    </div>
  )
}
