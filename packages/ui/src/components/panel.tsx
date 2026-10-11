import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * Bootstrap `.card` with header (the home-page boxes, most fieldsets).
 * pma: resources/templates/home/index.twig (`.card > .card-header + .list-group`)
 */
export function Panel({
  title,
  actions,
  className,
  children,
  headerId,
  footer,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode
  actions?: ReactNode
  headerId?: string
  /** `.card-footer.text-end` (the form's submit buttons) */
  footer?: ReactNode
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-(--radius) border border-(--card-border) bg-(--card-bg) text-fg shadow-(--card-shadow)',
        className,
      )}
      {...(headerId !== undefined ? { 'aria-labelledby': headerId } : {})}
      {...props}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between gap-2 bg-(--card-head-bg) px-3 py-1 text-(--card-head-fg)">
          <h2
            {...(headerId !== undefined ? { id: headerId } : {})}
            className="text-(length:--card-head-size) font-normal"
          >
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
      {footer !== undefined && (
        <footer className="border-t border-(--card-divider) px-3 py-2 text-end">{footer}</footer>
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
