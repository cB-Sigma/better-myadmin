import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * Bootstrap `.card` with header: `variant="card"` (default) is the plain `.card > .card-header +
 * .card-body` of every page (bottom margin `mb-3` included); `variant="home"` the boxes of the home
 * page (`#maincontainer .card`, large themed header, used in a grid). Put content in `PanelBody`
 * (padded) or `PanelList`; `footer` is the `.card-footer` (button row).
 * pma: resources/templates/home/index.twig (`.card > .card-header + .list-group`)
 */
export function Panel({
  title,
  actions,
  footer,
  variant = 'card',
  className,
  children,
  headerId,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  variant?: 'card' | 'home'
  headerId?: string
}) {
  const home = variant === 'home'
  return (
    <section
      className={cn(
        'bma-card',
        home
          ? 'overflow-hidden rounded-(--radius) border border-(--card-border) bg-(--card-bg) text-fg shadow-(--card-shadow)'
          : 'mb-3 overflow-hidden rounded-(--radius) border border-border text-fg',
        className,
      )}
      {...(headerId !== undefined ? { 'aria-labelledby': headerId } : {})}
      {...props}
    >
      {title !== undefined &&
        (home ? (
          <header className="bma-card-head flex items-center justify-between gap-2 bg-(--card-head-bg) px-3 py-1 text-(--card-head-fg) [box-shadow:var(--card-head-inset,none)] [text-shadow:var(--card-head-text-shadow,none)]">
            {/* `.card-header` is a div in phpMyAdmin, not a heading */}
            <div
              {...(headerId !== undefined ? { id: headerId } : {})}
              className="text-(length:--card-head-size) font-normal"
            >
              {title}
            </div>
            {actions}
          </header>
        ) : (
          <header
            {...(headerId !== undefined ? { id: headerId } : {})}
            className="bma-card-head flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5 text-[13px] font-semibold"
          >
            {title}
            {actions !== undefined && <span className="ms-auto font-normal">{actions}</span>}
          </header>
        ))}
      {children}
      {footer !== undefined && (
        <div className="border-t border-border bg-bg-subtle px-3 py-2 text-[13px]">{footer}</div>
      )}
    </section>
  )
}

/** `.list-group.list-group-flush` */
export function PanelList({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('divide-y divide-(--card-divider) text-[13px]', className)} {...props} />
}

export function PanelItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('px-3 py-1.5', className)} {...props} />
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-3 text-[13px]', className)} {...props} />
}

/** Bootstrap `.alert` variants used by Message::getDisplay (success / primary(notice) / warning / danger / info). */
export function Alert({
  variant,
  className,
  ...props
}: ComponentProps<'div'> & { variant: 'success' | 'notice' | 'warning' | 'error' | 'info' }) {
  const styles = {
    success: 'border-success/40 bg-success-bg text-success',
    notice: 'border-accent/30 bg-notice-bg text-notice',
    warning: 'border-warning/40 bg-warning-bg text-warning',
    error: 'border-error/40 bg-error-bg text-error',
    info: 'border-info/40 bg-info-bg text-info',
  } as const
  return (
    <div
      role="alert"
      className={cn('rounded-(--radius) border px-3 py-2 text-[13px]', styles[variant], className)}
      {...props}
    />
  )
}
