import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { BookOpen, Database, Home, LogOut, RefreshCw, Settings } from 'lucide-react'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { ShellLayout } from './layout/ShellLayout.tsx'

/**
 * Server scope layout route component: the shell layout with its slots. The navigation panel
 * below and the console are separate features plugged into the `nav` / `console` slots.
 */
export function ServerShell() {
  const { server } = useParams({ from: '/s/$server' })
  return <ShellLayout server={server} nav={<NavPanel server={server} />} />
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
        <a
          className={btn}
          href="https://docs.phpmyadmin.net/en/latest/"
          target="_blank"
          rel="noopener noreferrer"
          title="phpMyAdmin documentation"
        >
          <BookOpen className={icon} aria-hidden />
          <span className="sr-only">phpMyAdmin documentation</span>
        </a>
        <button type="button" className={btn} title="Navigation panel settings" disabled>
          <Settings className={icon} aria-hidden />
          <span className="sr-only">Navigation panel settings</span>
        </button>
        <button
          type="button"
          className={btn}
          title="Reload navigation panel"
          onClick={() => qc.invalidateQueries({ queryKey: qk.srv(server) })}
        >
          <RefreshCw className={icon} aria-hidden />
          <span className="sr-only">Reload navigation panel</span>
        </button>
      </div>
      <div className="px-3 py-2 text-xs text-fg-subtle">The navigation tree is part of milestone M1.</div>
    </aside>
  )
}
