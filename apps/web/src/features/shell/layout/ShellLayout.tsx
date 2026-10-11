import {
  ConfirmProvider,
  PmaIcon,
  Toaster,
  TooltipProvider,
  UiSettingsProvider,
  iconParts,
} from '@bettermyadmin/ui'
import { Outlet, useLocation } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { uiSettingsFrom, useConfig } from '../../../lib/config.ts'
import { tProduct } from '../../../lib/i18n'
import { Breadcrumb } from '../Breadcrumb.tsx'
import { ServerTabBar } from '../ScopeTabBars.tsx'
import { UserMenu } from '../UserMenu.tsx'
import { ErrorReporting, PageErrorBoundary } from '../errors/ErrorReporting.tsx'
import { ShortcutLayer } from '../hotkeys/useShortcuts.tsx'
import { PageChromeProvider, PageIcons } from '../page-chrome.tsx'
import { useScopeParams, useServerScope } from '../scope.ts'
import { useThemeState } from '../theme/theme.ts'
import { pageTitle } from '../title.ts'

export interface ShellLayoutProps {
  server: number
  /** The navigation panel (owned by the navigation feature). */
  nav: ReactNode
  /** The bottom console drawer (owned by the console feature). */
  console?: ReactNode
}

/**
 * The page skeleton of base.twig as a layout with slots: navigation panel | (breadcrumb + page
 * icons, scope tab bar, page content, footer link) | console. Page titles, shortcuts, toasts,
 * the confirm modal and error reporting are mounted here once.
 * pma: resources/templates/base.twig, src/Header.php, src/Footer.php
 */
export function ShellLayout({ server, nav, console: consoleSlot }: ShellLayoutProps) {
  const cfg = useConfig()
  const { db, table } = useScopeParams()
  const scope = useServerScope(server)
  const location = useLocation()
  const scroller = useRef<HTMLDivElement>(null)
  // re-apply the theme for ThemePerServer when the server changes
  useThemeState({ themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server })

  const ui = useMemo(
    () => uiSettingsFrom(cfg, scope.data?.versionInt ?? 0, scope.data?.isMariaDb ?? false),
    [cfg, scope.data?.versionInt, scope.data?.isMariaDb],
  )

  // Header::getPageTitle, refreshed on every navigation like the AJAX `title` key
  useEffect(() => {
    if (scope.data === undefined) return
    document.title = pageTitle(cfg, {
      httpHost: window.location.host,
      host: scope.data.host,
      verbose: scope.data.verbose,
      db,
      table,
      appVersion: scope.data.appVersion,
    })
  }, [cfg, scope.data, db, table])

  const scrollTop = () => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
  const tabsParts = iconParts(cfg.TabsMode)

  return (
    <UiSettingsProvider value={ui}>
      <TooltipProvider>
        <ConfirmProvider>
          <PageChromeProvider>
            <div className="flex h-full flex-col">
              <div className="flex min-h-0 flex-1">
                <div className="contents print:hidden">{nav}</div>
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* pma: base.twig — #page_nav_icons follows the menu (#floating_menubar), it is not part of it */}
                  <div className="flex items-center gap-2 bg-(--breadcrumb-bg) px-3 py-1.5 text-(--breadcrumb-fg) print:hidden [&_a]:text-(--breadcrumb-fg) [&_.breadcrumb-comment]:text-(--breadcrumb-comment)">
                    <header id="floating_menubar" className="min-w-0 flex-1">
                      <Breadcrumb server={server} db={db} table={table} onScrollTop={scrollTop} />
                    </header>
                    <div id="page_nav_icons" className="flex shrink-0 items-center gap-2">
                      <UserMenu server={server} />
                      <PageIcons onTop={scrollTop} />
                    </div>
                  </div>
                  <div ref={scroller} id="page_scroll" className="min-h-0 flex-1 overflow-auto">
                    {db === '' && (
                      <div className="sticky top-0 z-10 border-b border-(--tab-border) bg-bg px-2 pt-1 print:hidden">
                        <ServerTabBar server={server} />
                      </div>
                    )}
                    <main id="page_content" className="p-3 pb-12">
                      <PageErrorBoundary resetKey={location.pathname}>
                        <Outlet />
                      </PageErrorBoundary>
                    </main>
                    <div id="selflink" className="px-3 pb-2 text-right print:hidden">
                      <a
                        href={location.href}
                        title={tProduct('Open new phpMyAdmin window')}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tabsParts.icon ? (
                          <PmaIcon name="window-new" alt={tProduct('Open new phpMyAdmin window')} />
                        ) : (
                          tProduct('Open new phpMyAdmin window')
                        )}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              {consoleSlot}
            </div>
            <Toaster />
            <ShortcutLayer server={server} db={db} table={table} disabled={cfg.DisableShortcutKeys} />
            <ErrorReporting server={server} setting={cfg.SendErrorReports} />
          </PageChromeProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </UiSettingsProvider>
  )
}
