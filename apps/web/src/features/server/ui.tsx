import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, CircleHelp, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '../../lib/api'
import { t } from '../../lib/i18n'

/**
 * Minimal local building blocks of the server pages (to be swapped for packages/ui): page title,
 * documentation link, cards, message boxes, hint, tables.
 */

/** MySQLDocumentation::show — the help icon link (target mysql_doc) */
export function DocLink({ url, className = '' }: { url: string | null | undefined; className?: string }) {
  if (url === null || url === undefined) return null
  return (
    <a
      href={url}
      target="mysql_doc"
      rel="noopener noreferrer"
      title={t('Documentation')}
      className={className}
    >
      <CircleHelp className="inline size-4 align-text-bottom" aria-hidden />
      <span className="sr-only">{t('Documentation')}</span>
    </a>
  )
}

export function PageTitle({
  icon: Icon,
  children,
  docUrl,
}: { icon?: LucideIcon; children: ReactNode; docUrl?: string | null | undefined }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
      {Icon !== undefined && <Icon className="size-5 text-fg-muted" aria-hidden />}
      {children}
      <DocLink url={docUrl} />
    </h2>
  )
}

export function Card({
  title,
  children,
  footer,
  className = '',
  id,
}: { title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`mb-3 rounded border border-border ${className}`}>
      {title !== undefined && (
        <div className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">{title}</div>
      )}
      <div className="px-3 py-2 text-sm">{children}</div>
      {footer !== undefined && (
        <div className="border-t border-border bg-bg-subtle px-3 py-2 text-sm">{footer}</div>
      )}
    </section>
  )
}

const STYLES = {
  success: ['border-success/40 bg-success-bg text-success', CheckCircle2],
  notice: ['border-notice/40 bg-notice-bg text-notice', AlertTriangle],
  error: ['border-error/40 bg-error-bg text-error', XCircle],
  info: ['border-accent/40 bg-bg-subtle text-fg', Info],
} as const

export function Alert({
  type,
  children,
  className = '',
}: { type: keyof typeof STYLES; children: ReactNode; className?: string }) {
  const [box, Icon] = STYLES[type]
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`mb-3 flex items-start gap-2 rounded border px-3 py-2 text-sm ${box} ${className}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Generator::mysqlDie for an API error, or the plain message */
export function ErrorBox({ error }: { error: unknown }) {
  if (!(error instanceof ApiError))
    return error === null || error === undefined ? null : <Alert type="error">{String(error)}</Alert>
  const e = error.envelope
  return (
    <Alert type="error">
      <div className="font-semibold">{t('Error')}</div>
      {e.sql !== undefined && (
        <>
          <div className="mt-1 text-xs font-semibold">{t('SQL query:')}</div>
          <pre className="my-1 overflow-x-auto font-mono text-xs" dir="ltr">
            <code className="sql">{e.sql}</code>
          </pre>
          <div className="text-xs font-semibold">{t('MySQL said: ')}</div>
        </>
      )}
      <code className="text-xs">
        {e.errno !== undefined ? `#${e.errno} - ` : ''}
        {e.message}
      </code>
    </Alert>
  )
}

/** Generator::showHint — help icon whose text shows on hover/focus */
export function Hint({ text }: { text: string }) {
  return (
    <span className="pma_hint inline-block" title={text}>
      <CircleHelp className="inline size-4 text-fg-muted" aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  )
}

export function Loading() {
  return (
    <p className="text-sm text-fg-muted" role="status">
      {t('Loading…')}
    </p>
  )
}

/** Dense striped table classes */
export const tableCls =
  'border-collapse text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-start [&_thead_th]:bg-grid-header [&_tbody_tr:nth-child(odd)]:bg-grid-odd [&_tbody_tr:nth-child(even)]:bg-grid-even [&_tbody_tr:hover]:bg-grid-hover'

/** The success box with the SQL that ran (Generator::getMessage) */
export function SqlBox({ message, sql }: { message: string; sql: string }) {
  return (
    <div className="mb-3 overflow-hidden rounded border border-border">
      {message !== '' && (
        <div
          className="flex items-start gap-2 border-b border-success/40 bg-success-bg px-3 py-2 text-sm text-success"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message}
        </div>
      )}
      <pre className="overflow-x-auto bg-bg-inset px-3 py-2 font-mono text-xs" dir="ltr">
        <code className="sql">{sql}</code>
      </pre>
    </div>
  )
}

/** A dynamic in-app path for <Link to> (routes are built from runtime values). */
export const path = (p: string): string => p
