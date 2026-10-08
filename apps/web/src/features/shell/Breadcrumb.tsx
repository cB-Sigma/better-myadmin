import { PmaIcon, iconParts, useUiSettings } from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { useConfig } from '../../lib/config.ts'
import { useDatabaseScope, useServerScope, useTableScope } from './scope.ts'
import { defaultDatabasePath, defaultServerPath, defaultTablePath } from './tabs.ts'

/**
 * `nav#server-breadcrumb`: Server › Database (+ “db comment”) › Table/View (+ “table comment”).
 * Icons and the "Server:" / "Database:" / "Table:" / "View:" prefixes follow TabsMode. Clicking
 * the bar (not a link) scrolls the page to the top unless Ctrl/Meta is held.
 * pma: src/Menu.php::getBreadcrumbs, templates/menu/main.twig, functions.ts::breadcrumbScrollToTop
 */
export function Breadcrumb({
  server,
  db,
  table,
  onScrollTop,
}: {
  server: number
  db: string
  table: string
  onScrollTop: () => void
}) {
  const cfg = useConfig()
  const { TabsMode } = useUiSettings()
  const parts = iconParts(TabsMode)
  const scope = useServerScope(server)
  const dbScope = useDatabaseScope(server, db)
  const tblScope = useTableScope(server, db, table)
  const isView = tblScope.data?.isView === true
  const enc = encodeURIComponent
  const srvPath = defaultServerPath(cfg.DefaultTabServer)

  const onBarClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a') !== null) return
    if (e.ctrlKey || e.metaKey) return
    onScrollTop()
  }

  const name = scope.data?.name ?? ''
  const serverHref: string = `/s/${server}${srvPath === '' ? '' : `/${srvPath}`}`
  const dbHref: string = `/s/${server}/db/${enc(db)}/${defaultDatabasePath(cfg.DefaultTabDatabase)}`
  const tableHref: string = `/s/${server}/db/${enc(db)}/t/${enc(table)}/${defaultTablePath(cfg.DefaultTabTable)}`
  const comment =
    table !== '' ? (tblScope.data?.comment ?? '') : db !== '' ? (dbScope.data?.comment ?? '') : ''

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse convenience; the scroll-to-top icon is the keyboard path
    <nav
      id="server-breadcrumb"
      aria-label="breadcrumb"
      onClick={onBarClick}
      className="breadcrumb-navbar min-w-0"
    >
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-[13px]">
        <li className="breadcrumb-item inline-flex items-center gap-1">
          {parts.icon && <PmaIcon name="s_host" />}
          <Link to={serverHref} data-raw-text={name} draggable={false}>
            {parts.text && 'Server: '}
            {name}
          </Link>
        </li>
        {db !== '' && (
          <li className="breadcrumb-item inline-flex items-center gap-1">
            <span aria-hidden className="breadcrumb-divider px-1">
              »
            </span>
            {parts.icon && <PmaIcon name="s_db" />}
            <Link to={dbHref} data-raw-text={db} draggable={false}>
              {parts.text && 'Database: '}
              {db}
            </Link>
          </li>
        )}
        {db !== '' && table !== '' && (
          <li className="breadcrumb-item inline-flex items-center gap-1">
            <span aria-hidden className="breadcrumb-divider px-1">
              »
            </span>
            {parts.icon && <PmaIcon name={isView ? 'b_views' : 's_tbl'} />}
            <Link to={tableHref} search={{ pos: 0 } as never} data-raw-text={table} draggable={false}>
              {parts.text && (isView ? 'View: ' : 'Table: ')}
              {table}
            </Link>
          </li>
        )}
        {comment !== '' && (
          <span className="breadcrumb-comment ps-2 font-bold italic" draggable={false}>
            “{comment}”
          </span>
        )}
      </ol>
    </nav>
  )
}
