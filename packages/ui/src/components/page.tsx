import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { LOADING } from '../lib/messages.ts'
import { useUiSettings } from '../settings.tsx'
import { MySqlDocLink } from './doc-link.tsx'

/**
 * The page heading every page starts with: icon, title, optional MySQL documentation link
 * (phpMyAdmin's `<h2>` with `Util::getImage` + `MySQLDocumentation::show`).
 */
export function PageHeader({
  icon: Icon,
  children,
  docUrl,
  className,
  ...props
}: Omit<ComponentProps<'h2'>, 'children'> & {
  icon?: LucideIcon
  children: ReactNode
  /** A ready documentation URL (packages/kbs); nothing is shown when null/undefined. */
  docUrl?: string | null | undefined
}) {
  return (
    <h2 className={cn('mb-3 flex items-center gap-2 text-lg font-semibold', className)} {...props}>
      {Icon !== undefined && <Icon className="size-5 text-fg-muted" aria-hidden />}
      {children}
      {docUrl !== null && docUrl !== undefined && <MySqlDocLink url={docUrl} />}
    </h2>
  )
}

/** The inline "Loading…" placeholder of a page section while its query runs. */
export function Loading({ className }: { className?: string }) {
  const { gettext } = useUiSettings()
  return (
    <p className={cn('text-[13px] text-fg-muted', className)} role="status">
      {gettext(LOADING)}
    </p>
  )
}

/**
 * phpMyAdmin's `.table` lists (`.pma_table`): dense rows, header on `--grid-header-bg`, and with
 * `zebra` the odd/even/hover row colours of the theme (`--grid-row-*`).
 */
export function Table({ zebra = false, className, ...props }: ComponentProps<'table'> & { zebra?: boolean }) {
  return (
    <table
      className={cn(
        'border-collapse text-[13px] [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-start [&_thead_th]:bg-grid-header',
        zebra &&
          '[&_tbody_tr:nth-child(odd)]:bg-grid-odd [&_tbody_tr:nth-child(even)]:bg-grid-even [&_tbody_tr:hover]:bg-grid-hover',
        className,
      )}
      {...props}
    />
  )
}
