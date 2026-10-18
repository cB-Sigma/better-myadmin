import { TabBar, type TabItem, type TabLinkComponent } from '@bettermyadmin/ui'
import { Link, useLocation } from '@tanstack/react-router'
import { t } from '../../lib/i18n'
import { parsePhpQuery } from '../../lib/search'
import { useDatabaseScope, useServerScope, useTableScope } from './scope.ts'
import { DB_TABS, SERVER_TABS, TABLE_TABS, type TabDef, isTabActive } from './tabs.ts'

/** The router link the tab bar renders (Link prefetches on intent, per the preloading policy). */
const TabLink: TabLinkComponent = ({ href, className, children, ...rest }) => {
  const [path = '', qs = ''] = href.split('?')
  return (
    <Link to={path} search={parsePhpQuery(qs) as never} className={className} {...rest}>
      {children}
    </Link>
  )
}

function items<K extends string>(
  defs: Record<K, TabDef>,
  keys: K[],
  base: string,
  pathname: string,
  search: Partial<Record<K, string>> = {},
): TabItem[] {
  const rest = pathname.startsWith(`${base}/`) ? decodeURIComponent(pathname.slice(base.length + 1)) : ''
  return keys.map((key) => {
    const d = defs[key]
    return {
      key,
      // Menu::get*Tabs: __('Databases'), __('SQL'), …
      label: t(d.text),
      icon: d.icon,
      href: `${base}/${d.path}${search[key] ?? ''}`,
      active: isTabActive(d, rest.replace(/\/$/, '')),
    }
  })
}

const enc = encodeURIComponent

/** pma: src/Menu.php::getServerTabs → templates/menu/main.twig */
export function ServerTabBar({ server }: { server: number }) {
  const scope = useServerScope(server)
  const { pathname } = useLocation()
  const keys = scope.data?.tabs.map((t) => t.key) ?? []
  return (
    <TabBar
      ariaLabel="Server menu"
      link={TabLink}
      items={items(SERVER_TABS, keys, `/s/${server}`, pathname)}
    />
  )
}

/** pma: src/Menu.php::getDbTabs */
export function DatabaseTabBar({ server, db }: { server: number; db: string }) {
  const scope = useDatabaseScope(server, db)
  const { pathname } = useLocation()
  const keys = scope.data?.tabs.map((t) => t.key) ?? []
  return (
    <TabBar
      ariaLabel="Database menu"
      link={TabLink}
      items={items(DB_TABS, keys, `/s/${server}/db/${enc(db)}`, pathname)}
    />
  )
}

/** pma: src/Menu.php::getTableTabs (Browse carries pos=0, Export single_table=true) */
export function TableTabBar({ server, db, table }: { server: number; db: string; table: string }) {
  const scope = useTableScope(server, db, table)
  const { pathname } = useLocation()
  const keys = scope.data?.tabs.map((t) => t.key) ?? []
  return (
    <TabBar
      ariaLabel="Table menu"
      link={TabLink}
      items={items(TABLE_TABS, keys, `/s/${server}/db/${enc(db)}/t/${enc(table)}`, pathname, {
        browse: '?pos=0',
        export: '?single_table=true',
      })}
    />
  )
}
