import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { TabLinkComponent } from './tab-bar.tsx'

export interface NavPillItem {
  key: string
  label: ReactNode
  href: string
  active: boolean
}

/**
 * Bootstrap `ul.nav.nav-pills`: page-level links with the current one filled (the user
 * preferences tabs). Links are rendered by the caller's router link.
 * pma: resources/templates/preferences/header.twig (#user_prefs_tabs)
 */
export function NavPills({
  items,
  link: Link,
  id,
  className,
}: { items: NavPillItem[]; link: TabLinkComponent; id?: string; className?: string }) {
  return (
    <ul
      {...(id !== undefined ? { id } : {})}
      className={cn('bma-subnav nav nav-pills m-2 flex flex-wrap gap-1 text-[13px]', className)}
    >
      {items.map((i) => (
        <li key={i.key} className="nav-item my-1">
          <Link
            href={i.href}
            data-tab={i.key}
            className={cn(
              'nav-link inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold no-underline',
              i.active
                ? 'active border-border-strong bg-bg text-fg'
                : 'border-border bg-bg-subtle hover:bg-bg',
            )}
            {...(i.active ? { 'aria-current': 'page' as const } : {})}
          >
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export interface NavTabItem {
  id: string
  label: ReactNode
}

/**
 * Bootstrap `ul.nav.nav-tabs` switching panes of the same page (`data-bs-toggle="tab"`): ids
 * `<id>-tab` on the tab, `<id>` on its pane (the caller renders the panes).
 * pma: resources/templates/config/form_display/display.twig (#configFormDisplayTab)
 */
export function NavTabs({
  items,
  active,
  onSelect,
  id,
  className,
}: {
  items: NavTabItem[]
  active: string
  onSelect: (id: string) => void
  id?: string
  className?: string
}) {
  return (
    <ul
      {...(id !== undefined ? { id } : {})}
      role="tablist"
      className={cn('nav nav-tabs flex flex-wrap border-b border-border text-[13px]', className)}
    >
      {items.map((i) => (
        <li key={i.id} className="nav-item -mb-px" role="presentation">
          <a
            className={cn(
              'nav-link block rounded-t-(--radius) border px-3 py-1.5 no-underline',
              i.id === active
                ? 'active border-border border-b-bg bg-bg text-fg'
                : 'border-transparent hover:border-border hover:bg-bg-subtle',
            )}
            id={`${i.id}-tab`}
            href={`#${i.id}`}
            role="tab"
            aria-controls={i.id}
            aria-selected={i.id === active}
            onClick={(e) => {
              e.preventDefault()
              onSelect(i.id)
            }}
          >
            {i.label}
          </a>
        </li>
      ))}
    </ul>
  )
}
