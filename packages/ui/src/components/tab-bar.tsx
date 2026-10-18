import { Menu } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PmaIconName } from '../icons/pma-map.ts'
import { cn } from '../lib/cn.ts'
import { decodeEntities } from '../lib/entities.ts'
import { iconParts } from '../lib/link-mode.ts'
import { HAMBURGER_BREAKPOINT, visibleTabCount } from '../lib/overflow.ts'
import { useUiSettings } from '../settings.tsx'
import { PmaIcon } from './icon.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './menus.tsx'

export interface TabItem {
  /** phpMyAdmin tab key (`structure`, `sql`, …; user-group keys are `<level>_<key>`). */
  key: string
  label: string
  icon: PmaIconName
  href: string
  active: boolean
}

/** Renders a router link; receives the anchor props the bar needs. */
export type TabLinkComponent = (props: {
  href: string
  className: string
  children: ReactNode
  'aria-current'?: 'page'
  'data-tab': string
}) => ReactNode

export interface TabBarProps {
  items: TabItem[]
  ariaLabel: string
  link: TabLinkComponent
  id?: string
  className?: string
}

const MORE_ESTIMATE = 80

function useNarrow(): boolean {
  const query = `(max-width: ${HAMBURGER_BREAKPOINT - 1}px)`
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

/**
 * The tab menu (`ul#topmenu.navbar-nav`) with phpMyAdmin's overflow behaviour: tabs that do not
 * fit move from the right end into a "More" dropdown; below 768 px a "Toggle navigation" hamburger
 * replaces it. Icons/text follow `$cfg['TabsMode']`; the active tab carries a visually hidden
 * "(current)".
 * pma: resources/templates/menu/main.twig, resources/js/menu_resizer.ts
 */
export function TabBar({ items, ariaLabel, link: Link, id = 'topmenu', className }: TabBarProps) {
  const { TabsMode, gettext } = useUiSettings()
  const parts = iconParts(TabsMode)
  const navRef = useRef<HTMLElement>(null)
  const widths = useRef(new Map<string, number>())
  const moreWidth = useRef(MORE_ESTIMATE)
  const [count, setCount] = useState(items.length)
  const [measuring, setMeasuring] = useState(true)
  const narrow = useNarrow()
  const [expanded, setExpanded] = useState(false)
  const signature = `${TabsMode}|${items.map((i) => `${i.key}:${i.label}`).join(',')}`

  const recompute = useCallback(() => {
    const nav = navRef.current
    if (nav === null) return
    const ws = items.map((i) => widths.current.get(i.key) ?? 0)
    setCount(visibleTabCount(ws, nav.clientWidth, moreWidth.current))
  }, [items])

  // a new tab set (scope change, label change) is measured with every tab inline before paint
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure only when the tab set changes
  useLayoutEffect(() => {
    setMeasuring(true)
  }, [signature])

  useLayoutEffect(() => {
    if (!measuring) return
    const nav = navRef.current
    if (nav === null) return
    for (const el of nav.querySelectorAll<HTMLElement>('[data-tab-item]')) {
      widths.current.set(el.dataset.tabItem ?? '', el.getBoundingClientRect().width)
    }
    const more = nav.querySelector<HTMLElement>('[data-tab-more]')
    if (more !== null) moreWidth.current = more.getBoundingClientRect().width
    setMeasuring(false)
    recompute()
  }, [measuring, recompute])

  useEffect(() => {
    const nav = navRef.current
    if (nav === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(nav)
    return () => ro.disconnect()
  }, [recompute])

  const inline = narrow || measuring ? items : items.slice(0, count)
  const hidden = narrow || measuring ? [] : items.slice(count)

  const content = (t: TabItem) => (
    <>
      {/* get_icon(tab.icon, tab.text): the text is printed raw, entities render */}
      {parts.icon && <PmaIcon name={t.icon} alt={parts.text ? '' : decodeEntities(t.label)} />}
      {parts.text && <span>{decodeEntities(t.label)}</span>}
      {t.active && <span className="sr-only">{gettext('(current)')}</span>}
    </>
  )

  return (
    <nav ref={navRef} aria-label={ariaLabel} className={cn('menucontainer relative min-w-0', className)}>
      {narrow && (
        <button
          type="button"
          className="m-1 inline-flex items-center rounded border border-border-strong p-1"
          aria-label={gettext('Toggle navigation')}
          aria-expanded={expanded}
          aria-controls="navbarNav"
          onClick={() => setExpanded((v) => !v)}
        >
          <Menu className="size-5" aria-hidden />
        </button>
      )}
      <div id="navbarNav" className={cn(narrow && !expanded && 'hidden')}>
        <ul
          id={id}
          className={cn(
            'flex min-w-0 text-[13px]',
            narrow ? 'flex-col' : 'flex-nowrap items-end overflow-hidden',
          )}
        >
          {inline.map((t) => (
            <li key={t.key} data-tab-item={t.key} className={cn('nav-item shrink-0', t.active && 'active')}>
              <Link
                href={t.href}
                data-tab={t.key}
                className={cn('nav-link tab-link', t.active && 'tab-link-active')}
                {...(t.active ? { 'aria-current': 'page' as const } : {})}
              >
                {content(t)}
              </Link>
            </li>
          ))}
          {(measuring || hidden.length > 0) && !narrow && (
            <li data-tab-more className={cn('nav-item dropdown shrink-0', measuring && 'invisible absolute')}>
              <DropdownMenu>
                <DropdownMenuTrigger className="nav-link tab-link" id="navbarDropdown">
                  {/* menu_resizer.ts: the text is always there, the icon only when tabs show icons */}
                  {parts.icon && <PmaIcon name="b_more" />}
                  <span>{gettext('More')}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {hidden.map((t) => (
                    <DropdownMenuItem key={t.key} asChild>
                      <Link
                        href={t.href}
                        data-tab={t.key}
                        className={cn('dropdown-item', t.active && 'font-semibold')}
                        {...(t.active ? { 'aria-current': 'page' as const } : {})}
                      >
                        {content(t)}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )}
        </ul>
      </div>
    </nav>
  )
}
