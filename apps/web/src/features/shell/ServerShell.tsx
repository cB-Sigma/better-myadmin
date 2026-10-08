import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useParams } from '@tanstack/react-router'
import { BookOpen, Database, Home, LogOut, RefreshCw, Server, Settings } from 'lucide-react'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { SERVER_TABS } from './tabs'

export function ServerShell() {
  const { server } = useParams({ from: '/s/$server' })
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const label = auth.data?.servers.find((s) => s.index === server)?.label ?? `Server ${server}`
  return (
    <div className="flex h-full">
      <NavPanel server={server} />
      <div className="flex min-w-0 flex-1 flex-col">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5 text-sm">
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

function NavPanel({ server }: { server: number }) {
  const qc = useQueryClient()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: (r) => {
      sessionStorage.clear()
      if (r.logoutUrl !== null) window.location.href = r.logoutUrl
      else void qc.invalidateQueries({ queryKey: qk.auth })
    },
  })
  const icon = 'size-4'
  const btn = 'rounded p-1 text-fg-muted hover:bg-nav-pointer hover:text-fg'
  return (
    <aside
      id="pma_navigation"
      className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle print:hidden"
      aria-label="Navigation panel"
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <Database className="size-6 text-accent" aria-hidden />
        <span className="text-base font-semibold">BetterMyAdmin</span>
      </div>
      <div id="navipanellinks" className="flex items-center gap-1 px-2 pb-2">
        <Link to="/s/$server" params={{ server }} className={btn} title="Home">
          <Home className={icon} aria-hidden />
          <span className="sr-only">Home</span>
        </Link>
        <button type="button" className={btn} title="Log out" onClick={() => logout.mutate()}>
          <LogOut className={icon} aria-hidden />
          <span className="sr-only">Log out</span>
        </button>
        <a className={btn} href="https://docs.phpmyadmin.net/en/latest/" target="_blank" rel="noopener noreferrer" title="phpMyAdmin documentation">
          <BookOpen className={icon} aria-hidden />
          <span className="sr-only">phpMyAdmin documentation</span>
        </a>
        <button type="button" className={btn} title="Navigation panel settings" disabled>
          <Settings className={icon} aria-hidden />
          <span className="sr-only">Navigation panel settings</span>
        </button>
        <button type="button" className={btn} title="Reload navigation panel" onClick={() => qc.invalidateQueries({ queryKey: qk.srv(server) })}>
          <RefreshCw className={icon} aria-hidden />
          <span className="sr-only">Reload navigation panel</span>
        </button>
      </div>
      <div className="px-3 py-2 text-xs text-fg-subtle">The navigation tree is part of milestone M1.</div>
    </aside>
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
                  active ? 'border-border bg-bg-subtle font-medium text-fg' : 'border-transparent text-accent hover:bg-bg-subtle'
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
