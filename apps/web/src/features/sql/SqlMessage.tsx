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
  const { box, Icon } = styles[st.message.type]
  return (
    <div className="mb-3 overflow-hidden rounded border border-border">
      <div className={`flex items-start gap-2 border-b px-3 py-2 text-sm ${box}`} role={st.message.type === 'error' ? 'alert' : 'status'}>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          {st.message.type === 'error' && <div className="font-semibold">Error</div>}
          {st.message.type === 'error' && <div className="mt-1 text-xs">MySQL said:</div>}
          <div className={st.message.type === 'error' ? 'font-mono text-xs' : ''}>{st.message.text}</div>
        </div>
      </div>
      <pre className="overflow-x-auto bg-bg-inset px-3 py-2 font-mono text-xs" dir="ltr">
        <code className="sql">{st.executedSql}</code>
      </pre>
      {st.warnings.map((w, i) => (
        <div key={`${w.code}-${i}`} className="border-t border-border bg-notice-bg px-3 py-1 text-xs text-notice">
          {w.level}: #{w.code} {w.message}
        </div>
      ))}
    </div>
  )
}
