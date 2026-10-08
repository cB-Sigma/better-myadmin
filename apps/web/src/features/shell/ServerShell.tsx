import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useParams } from '@tanstack/react-router'
import { Server } from 'lucide-react'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { NavigationPanel } from '../navigation/NavigationPanel'
import { SERVER_TABS } from './tabs'

export function ServerShell() {
  const { server } = useParams({ from: '/s/$server' })
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const label = auth.data?.servers.find((s) => s.index === server)?.label ?? `Server ${server}`
  return (
    <div className="flex h-full">
      <NavigationPanel server={server} />
      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5 text-sm"
        >
          <Server className="size-4 text-fg-muted" aria-hidden />
          <span className="text-fg-muted">Server:</span>
          <Link to="/s/$server" params={{ server }} className="font-medium">
            {label}
          </Link>
        </nav>
        <TabBar server={server} />
        <main className="min-h-0 flex-1 overflow-auto p-3">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function TabBar({ server }: { server: number }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Server menu" className="border-b border-border bg-bg">
      <ul id="topmenu" className="flex flex-wrap gap-0.5 px-2 pt-1.5 text-sm">
        {SERVER_TABS.map((t) => {
          const href = `/s/${server}/${t.path}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          const Icon = t.icon
          return (
            <li key={t.key}>
              <Link
                to={href}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-t border border-b-0 px-2.5 py-1.5 hover:no-underline ${
                  active
                    ? 'border-border bg-bg-subtle font-medium text-fg'
                    : 'border-transparent text-accent hover:bg-bg-subtle'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="size-4" aria-hidden />
                {t.text}
                {active && <span className="sr-only">(current)</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
