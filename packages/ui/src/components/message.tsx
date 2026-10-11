import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export type MessageBoxType = 'success' | 'notice' | 'error' | 'info'

const tone = {
  success: { box: 'border-success/40 bg-success-bg text-success', Icon: CheckCircle2 },
  notice: { box: 'border-notice/40 bg-notice-bg text-notice', Icon: AlertTriangle },
  error: { box: 'border-error/40 bg-error-bg text-error', Icon: XCircle },
  info: { box: 'border-accent/40 bg-bg-subtle text-fg', Icon: Info },
} as const

interface MessageProps extends Omit<ComponentProps<'div'>, 'children'> {
  type: MessageBoxType
  /** The message (plain text keeps its line breaks); or pass `children`. */
  text?: string
  children?: ReactNode
}

/**
 * The icon + text row of a message, without box or margin: for cards that put more under it
 * (SqlMessage). Everything else uses MessageBox.
 * pma: src/Message.php::getMessageWithIcon
 */
export function MessageLine({ type, text, children, className, ...props }: MessageProps) {
  const { box, Icon } = tone[type]
  return (
    <div className={cn('flex items-start gap-2 border px-3 py-2 text-[13px]', box, className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 whitespace-pre-line" data-testid="message-text">
        {text ?? children}
      </div>
    </div>
  )
}

export interface MessageBoxProps extends MessageProps {
  /** The SQL that ran, shown under the message (Generator::getMessage). */
  sql?: string | undefined
  /** No bottom margin (the message sits in a flex/grid gap or is the only content). */
  flush?: boolean
}

/**
 * A phpMyAdmin success / notice / error message with its icon, and, with `sql`, the executed query
 * under it. Every page shows results through this (an ApiError via `errorMessage()` of the web
 * app); executed queries of the SQL tab use SqlMessage. Bottom margin `mb-3` unless `flush`.
 * pma: src/Message.php::getDisplay, src/Html/Generator.php::getMessage
 */
export function MessageBox({
  type,
  text,
  children,
  sql,
  flush = false,
  className,
  ...props
}: MessageBoxProps) {
  const withSql = sql !== undefined && sql !== ''
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      data-message-type={type}
      className={cn(
        !flush && 'mb-3',
        'overflow-hidden rounded',
        withSql && 'border border-border',
        className,
      )}
      {...props}
    >
      <MessageLine
        type={type}
        className={withSql ? 'border-x-0 border-t-0' : 'rounded'}
        {...(text !== undefined ? { text } : {})}
      >
        {children}
      </MessageLine>
      {withSql && (
        <pre className="overflow-x-auto bg-bg-inset px-3 py-2 font-mono text-xs" dir="ltr">
          <code className="sql">{sql}</code>
        </pre>
      )}
    </div>
  )
}
