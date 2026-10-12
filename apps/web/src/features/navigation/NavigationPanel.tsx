import type { NavBranchQuery, NavNode, NavSettings, ServerListEntry } from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal } from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { clsx } from 'clsx'
import {
  BookOpen,
  BookText,
  ChevronsDownUp,
  Database,
  Home,
  Link as LinkIcon,
  LogOut,
  RefreshCw,
  Settings,
  Unlink,
} from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { PageSettingsForm } from '../preferences/PageSettings.tsx'
import { useLogout } from '../shell/UserMenu'
import { NavTree } from './NavTree'
import { currentScope } from './links'
import { type NavFetchers, NavTreeStore } from './store'

export interface NavigationPanelProps {
  server: number
  /**
   * Extension point: the Recent / Favorites dropdowns (tree/quick_warp.twig) shown above the tree,
   * provided by the metadata layer.
   */
  quickWarp?: ReactNode
  /** Extension point: controls after a node's text (hide, show hidden items) from the metadata layer. */
  nodeControls?: (node: NavNode) => ReactNode
}

const WIDTH_KEY = 'bma.navigationWidth'
const DEFAULT_WIDTH = 240

function readWidth(fallback: number): number {
  try {
    const v = localStorage.getItem(WIDTH_KEY)
    if (v !== null && /^\d+$/.test(v)) return Number(v)
  } catch {
    // storage unavailable
  }
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 0 : fallback
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // storage unavailable
  }
}

/**
 * The left navigation panel (pma: navigation/main.twig + navigation.ts): header links, server
 * selector, quick warp slot, tree controls and the virtualized tree, with a drag handle and a
 * collapser. The panel width is kept in localStorage (pma posts it to /navigation/update-width).
 */
export function NavigationPanel({ server, quickWarp, nodeControls }: NavigationPanelProps) {
  const qc = useQueryClient()
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const token = auth.data?.csrfToken ?? ''
  const fetchers = useMemo<NavFetchers>(
    () => ({
      tree: (q) =>
        qc.fetchQuery({
          queryKey: qk.navTree(server, q),
          queryFn: () => api.navTree(server, q),
          staleTime: 0,
        }),
      treeState: (req) => api.navTreeState(server, req),
      branch: (q) =>
        qc.fetchQuery({
          queryKey: qk.navBranch(server, q),
          queryFn: () => api.navBranch(server, q),
          staleTime: 30_000,
        }),
    }),
    [qc, server],
  )
  const store = useMemo(() => new NavTreeStore(server, fetchers, token), [server, fetchers, token])
  useSyncExternalStore(store.subscribe, store.getVersion)

  const { pathname } = useLocation()
  const { db, table } = currentScope(pathname)
  const scope = useRef({ db, table })
  scope.current = { db, table }

  useEffect(() => {
    void store.init(scope.current.db)
  }, [store])

  // link with main panel: after every navigation of the main panel
  const loaded = store.root !== null
  const synced = store.synced
  useEffect(() => {
    if (loaded && synced) void store.showCurrent(db, table)
  }, [store, loaded, synced, db, table])

  const settings = store.root?.settings
  const [width, setWidth] = useState(() => readWidth(DEFAULT_WIDTH))
  const lastWidth = useRef(0)
  const appliedConfigWidth = useRef(false)
  useEffect(() => {
    // the configured NavigationWidth applies until the user resizes the panel
    if (settings === undefined || appliedConfigWidth.current) return
    appliedConfigWidth.current = true
    try {
      if (localStorage.getItem(WIDTH_KEY) !== null) return
    } catch {
      // storage unavailable
    }
    if (window.innerWidth >= 768) setWidth(settings.NavigationWidth)
  }, [settings])

  const reload = useCallback(async () => {
    qc.removeQueries({ queryKey: qk.nav(server) })
    await store.reload()
    if (store.synced) await store.showCurrent(scope.current.db, scope.current.table)
  }, [qc, server, store])

  const prefetch = useCallback(
    (node: NavNode) => {
      const q: NavBranchQuery = { path: node.aPath, pos: store.pos }
      if (node.pagination?.position === 'pos2_nav') {
        q.pos2Name = node.pagination.name
        q.pos2Value = node.pagination.value
      }
      void qc.prefetchQuery({
        queryKey: qk.navBranch(server, q),
        queryFn: () => api.navBranch(server, q),
        staleTime: 30_000,
      })
    },
    [qc, server, store],
  )

  return (
    <div className="relative flex shrink-0 print:hidden">
      <aside
        id="pma_navigation"
        className="flex flex-col overflow-hidden border-r border-border bg-bg-subtle"
        style={{ width }}
        aria-label={t('Navigation panel')}
        hidden={width === 0}
      >
        <NavHeader server={server} settings={settings} onReload={() => void reload()} />
        {settings !== undefined && auth.data !== undefined && (
          <ServerChoice server={server} settings={settings} servers={auth.data.servers} />
        )}
        {quickWarp}
        {store.root?.controls === true && (
          <div id="navigation_controls" className="flex items-center gap-1 px-2 pb-1">
            <button
              type="button"
              id="pma_navigation_collapse"
              className="rounded p-1 text-fg-muted hover:bg-nav-pointer hover:text-fg"
              title={t('Collapse all')}
              onClick={() => store.collapseAll()}
            >
              <ChevronsDownUp className="size-4" aria-hidden />
              <span className="sr-only">{t('Collapse all')}</span>
            </button>
            <button
              type="button"
              id="pma_navigation_sync"
              className="rounded p-1 text-fg-muted hover:bg-nav-pointer hover:text-fg"
              title={store.synced ? 'Unlink from main panel' : 'Link with main panel'}
              aria-pressed={store.synced}
              onClick={() => store.setSynced(!store.synced)}
            >
              {store.synced ? (
                <LinkIcon className="size-4" aria-hidden />
              ) : (
                <Unlink className="size-4" aria-hidden />
              )}
              <span className="sr-only">
                {store.synced ? 'Unlink from main panel' : 'Link with main panel'}
              </span>
            </button>
          </div>
        )}
        {store.errors.length > 0 && (
          <MessageBox type="error" flush className="mx-2 mb-1">
            {[...new Set(store.errors)].map((e) => (
              <div key={e}>{e}</div>
            ))}
          </MessageBox>
        )}
        {store.rootError !== null && (
          <p className="mx-2 text-xs text-error" role="alert">
            An error has occurred while loading the navigation display
          </p>
        )}
        {settings !== undefined && (
          <NavTree
            store={store}
            rows={store.rows()}
            settings={settings}
            nodeControls={nodeControls}
            onPrefetch={prefetch}
          />
        )}
      </aside>
      <Resizer width={width} onResize={setWidth} onDone={(w) => saveWidth(w)} />
      <button
        type="button"
        id="pma_navigation_collapser"
        className="absolute top-1 z-10 flex h-5 w-4 items-center justify-center rounded border border-border bg-bg-subtle text-xs text-fg-muted hover:text-fg"
        style={{ left: Math.max(width - 18, 3) }}
        title={width === 0 ? 'Show panel' : 'Hide panel'}
        onClick={() => {
          // pma: ResizeHandler.collapse — toggles between 0 and the previous width (240 when unknown)
          const panelWidth = width === 0 && lastWidth.current === 0 ? DEFAULT_WIDTH : lastWidth.current
          lastWidth.current = width
          setWidth(panelWidth)
          saveWidth(panelWidth)
        }}
      >
        {width === 0 ? '→' : '←'}
      </button>
    </div>
  )
}

/** pma: #pma_navigation_resizer + ResizeHandler.mousedown/mousemove/mouseup */
function Resizer({
  width,
  onResize,
  onDone,
}: { width: number; onResize: (w: number) => void; onDone: (w: number) => void }) {
  const clamp = (x: number) => {
    const max = window.innerWidth - 100
    return Math.max(0, Math.min(Math.round(x), max))
  }
  return (
    <div
      id="pma_navigation_resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-label={t('Navigation panel width')}
      tabIndex={0}
      className="w-[3px] shrink-0 cursor-col-resize bg-border hover:bg-accent"
      onPointerDown={(e) => {
        e.preventDefault()
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        let last = width
        const move = (ev: PointerEvent) => {
          last = clamp(ev.clientX)
          onResize(last)
        }
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          onDone(last)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0
        if (step === 0) return
        const w = clamp(width + step)
        onResize(w)
        onDone(w)
      }}
    />
  )
}

function NavHeader({
  server,
  settings,
  onReload,
}: { server: number; settings: NavSettings | undefined; onReload: () => void }) {
  // the shell's logout: sessionStorage cleared, then LogoutURL, the partial-logout redirect to the
  // remaining server (LoginCookieDeleteAll = false) or the login page
  const logout = useLogout()
  const btn = 'rounded p-1 text-fg-muted hover:bg-nav-pointer hover:text-fg'
  const icon = 'size-4'
  const logoutText = settings?.authType === 'config' ? t('Empty session data') : t('Log out')
  const docsTitle = settings?.isMariaDb === true ? 'MariaDB Documentation' : 'MySQL Documentation'
  return (
    <div id="pma_navigation_header">
      {(settings?.NavigationDisplayLogo ?? true) && (
        <div id="pmalogo" className="flex items-center gap-2 px-3 py-3">
          <Logo server={server} settings={settings} />
        </div>
      )}
      <div id="navipanellinks" className="flex items-center gap-1 px-2 pb-2">
        <Link to="/s/$server" params={{ server }} className={btn} title={t('Home')}>
          <Home className={icon} aria-hidden />
          <span className="sr-only">{t('Home')}</span>
        </Link>
        <button
          type="button"
          className={clsx(btn, 'logout')}
          title={logoutText}
          onClick={() => logout.mutate()}
        >
          <LogOut className={icon} aria-hidden />
          <span className="sr-only">{logoutText}</span>
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
        <a
          className={btn}
          href={settings?.serverDocsUrl ?? 'https://dev.mysql.com/doc/refman/8.0/en/index.html'}
          target="_blank"
          rel="noopener noreferrer"
          title={docsTitle}
        >
          <BookText className={icon} aria-hidden />
          <span className="sr-only">{docsTitle}</span>
        </a>
        <NaviSettingsButton server={server} className={btn} iconClass={icon} />
        <button
          type="button"
          id="pma_navigation_reload"
          className={btn}
          title={t('Reload navigation panel')}
          onClick={onReload}
        >
          <RefreshCw className={icon} aria-hidden />
          <span className="sr-only">{t('Reload navigation panel')}</span>
        </button>
      </div>
    </div>
  )
}

/** pma: Navigation::getDisplay logo link (NavigationLogoLink / NavigationLogoLinkWindow) */
function Logo({ server, settings }: { server: number; settings: NavSettings | undefined }) {
  const inner = (
    <>
      <Database className="size-6 text-accent" aria-hidden />
      <span className="text-base font-semibold">BetterMyAdmin</span>
    </>
  )
  const link = settings?.NavigationLogoLink.trim() ?? 'index.php'
  if (settings !== undefined && link === '') return inner
  const external = /^[a-z][a-z0-9+.-]*:\/\//i.test(link)
  // an internal link (index.php or relative) opens the home page of the SPA
  if (!external) {
    return (
      <Link to="/s/$server" params={{ server }} className="flex items-center gap-2 hover:no-underline">
        {inner}
      </Link>
    )
  }
  const newWindow = settings?.NavigationLogoLinkWindow === 'new'
  return (
    <a
      href={link}
      className="flex items-center gap-2 hover:no-underline"
      {...(newWindow ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {inner}
    </a>
  )
}

/**
 * pma: Server\Select::render(true) — shown when NavigationDisplayServers and more than one server;
 * a list of links with DisplayServersList, otherwise a select.
 */
function ServerChoice({
  server,
  settings,
  servers,
}: { server: number; settings: NavSettings; servers: ServerListEntry[] }) {
  const router = useRouter()
  if (!settings.NavigationDisplayServers || servers.length <= 1) return null
  const go = (s: number) => router.history.push(`/s/${s}`)
  if (settings.DisplayServersList) {
    return (
      <div id="serverChoice" className="px-3 pb-2 text-[13px]">
        Current server:
        <ul id="list_server" className="ml-3 list-disc">
          {servers.map((s) => (
            <li key={s.index}>
              {s.index === server ? (
                <strong>{s.label}</strong>
              ) : (
                <Link to="/s/$server" params={{ server: s.index }}>
                  {s.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div id="serverChoice" className="flex flex-col gap-1 px-3 pb-2 text-[13px]">
      <label htmlFor="select_server">{t('Current server:')}</label>
      <select
        id="select_server"
        className="h-7 rounded border border-border bg-bg px-1"
        value={String(server)}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (v > 0) go(v)
        }}
      >
        <option value="0">(Servers) ...</option>
        {servers.map((s) => (
          <option key={s.index} value={String(s.index)}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The navigation gear: the Navi page settings (`#pma_navigation_settings`) in the "Page-related
 * settings" modal; hidden on the preferences pages (`disableNaviSettings`).
 * pma: src/Controllers/NavigationController.php (PageSettings::init('Navi', 'pma_navigation_settings')),
 *      resources/js/modules/page_settings.ts::showNaviSettings
 */
function NaviSettingsButton({
  server,
  className,
  iconClass,
}: { server: number; className: string; iconClass: string }) {
  const [open, setOpen] = useState(false)
  const submit = useRef<(() => Promise<boolean>) | null>(null)
  const { pathname } = useLocation()
  if (/\/preferences\//.test(pathname)) return null
  return (
    <>
      <button
        type="button"
        id="pma_navigation_settings_icon"
        className={className}
        title={t('Navigation panel settings')}
        onClick={() => setOpen(true)}
      >
        <Settings className={iconClass} aria-hidden />
        <span className="sr-only">{t('Navigation panel settings')}</span>
      </button>
      <Modal
        id="pageSettingsModal"
        title={t('Page-related settings')}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              id="pageSettingsModalApplyButton"
              onClick={async () => {
                if (submit.current === null || (await submit.current())) setOpen(false)
              }}
            >
              {t('Apply')}
            </Button>
            <Button id="pageSettingsModalCancelButton" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
          </>
        }
      >
        <PageSettingsForm server={server} group="Navi" submit={submit} />
      </Modal>
    </>
  )
}
