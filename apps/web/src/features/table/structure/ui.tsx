import type { SqlMessage } from '@bettermyadmin/contracts'
import { AlertTriangle, CheckCircle2, CircleHelp, X, XCircle } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { ApiError } from '../../../lib/api'
import { t } from '../../../lib/i18n'

/**
 * Minimal local building blocks of the table-structure feature (to be swapped for packages/ui).
 */

export function Button({
  children,
  variant = 'secondary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'link'
}) {
  const v = {
    primary: 'border-accent bg-accent text-accent-fg hover:bg-accent-hover',
    secondary: 'border-border-strong bg-bg-subtle text-fg hover:bg-bg-inset',
    danger: 'border-error bg-error text-white hover:opacity-90',
    link: 'border-transparent bg-transparent text-accent hover:underline px-1',
  }[variant]
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Card({
  title,
  id,
  children,
  footer,
  className = '',
}: { title?: ReactNode; id?: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mb-3 overflow-hidden rounded border border-border ${className}`}>
      {title !== undefined && (
        <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5 text-sm font-semibold">
          {title}
        </div>
      )}
      <div className="p-3">{children}</div>
      {footer !== undefined && <div className="border-t border-border bg-bg-subtle px-3 py-2">{footer}</div>}
    </section>
  )
}

/** pma: Util::showMySQLDocu */
export function DocLink({ page }: { page: string }) {
  return (
    <a
      href={`https://dev.mysql.com/doc/refman/8.0/en/${page}.html`}
      target="mysql_doc"
      rel="noopener noreferrer"
      title={t('Documentation')}
      className="d-print-none"
    >
      <CircleHelp className="inline size-4" aria-hidden />
      <span className="sr-only">{t('Documentation')}</span>
    </a>
  )
}

const tone = {
  success: { box: 'border-success/40 bg-success-bg text-success', Icon: CheckCircle2 },
  notice: { box: 'border-notice/40 bg-notice-bg text-notice', Icon: AlertTriangle },
  error: { box: 'border-error/40 bg-error-bg text-error', Icon: XCircle },
} as const

/** The message card with the SQL under it (Generator::getMessage). */
export function MessageBox({ message }: { message: SqlMessage }) {
  const { box, Icon } = tone[message.type]
  return (
    <div
      className="mb-3 overflow-hidden rounded border border-border"
      role={message.type === 'error' ? 'alert' : 'status'}
    >
      <div className={`flex items-start gap-2 px-3 py-2 text-sm ${box}`}>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 whitespace-pre-line" data-testid="message-text">
          {message.text}
        </div>
      </div>
      {message.sql !== undefined && message.sql !== '' && (
        <pre className="overflow-x-auto bg-bg-inset px-3 py-2 font-mono text-xs" dir="ltr">
          <code className="sql">{message.sql}</code>
        </pre>
      )}
    </div>
  )
}

/** An API error as a message card (MySQL errors keep their SQL). */
export function errorMessage(e: unknown): SqlMessage {
  if (e instanceof ApiError) {
    const sql = e.envelope.sql
    const text =
      e.envelope.errno !== undefined ? `#${e.envelope.errno} - ${e.envelope.message}` : e.envelope.message
    return sql === undefined ? { type: 'error', text } : { type: 'error', text, sql }
  }
  return { type: 'error', text: String(e) }
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-notice/40 bg-notice-bg px-3 py-2 text-sm text-notice" role="status">
      {children}
    </div>
  )
}

/** A dialog on <dialog> (Esc closes, focus trapped by the browser). */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d === null) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto rounded border border-border bg-bg p-0 text-fg shadow-xl backdrop:bg-black/40 ${wide ? 'w-[min(96vw,1200px)]' : 'w-[min(96vw,640px)]'}`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-3 py-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label={t('Close')}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-auto p-3">{children}</div>
          {footer !== undefined && (
            <div className="flex justify-end gap-2 border-t border-border bg-bg-subtle px-3 py-2">
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  )
}

/** The "Preview SQL" modal (components/_preview_sql.twig: "No change" when empty). */
export function PreviewSqlModal({ sql, onClose }: { sql: string | null; onClose: () => void }) {
  return (
    <Modal
      title={t('Preview SQL')}
      open={sql !== null}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('Close')}</Button>}
    >
      <div className="preview_sql" data-testid="preview-sql">
        {sql === '' ? (
          t('No change')
        ) : (
          <pre className="overflow-x-auto font-mono text-xs" dir="ltr">
            <code className="sql">{sql}</code>
          </pre>
        )}
      </div>
    </Modal>
  )
}

/** `window.confirm` with phpMyAdmin's strDoYouReally wording */
export function confirmSql(sql: string): boolean {
  return window.confirm(t('Do you really want to execute "%s"?', sql))
}
