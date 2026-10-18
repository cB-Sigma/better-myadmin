import type { UiSettings } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from './api.ts'
import { pgettext, t } from './i18n'
import { qk } from './queryKeys.ts'

type LinkMode = 'icons' | 'text' | 'both'

/**
 * The directives of `GET /api/meta/config-public` the shell reads (the endpoint returns every
 * client-visible directive; user preferences will be merged in by the preferences layer).
 */
export interface ClientConfig {
  ThemeDefault: string
  ThemeManager: boolean
  ThemePerServer: boolean
  TabsMode: LinkMode
  ActionLinksMode: LinkMode
  TableNavigationLinksMode: LinkMode
  RowActionType: LinkMode
  Confirm: boolean
  InitialSlidersState: 'open' | 'closed' | 'disabled'
  ShowHint: boolean
  DisableShortcutKeys: boolean
  /** drag and drop import of files dropped on any page */
  enable_drag_drop_import: boolean
  SendErrorReports: 'ask' | 'always' | 'never'
  TitleDefault: string
  TitleServer: string
  TitleDatabase: string
  TitleTable: string
  DefaultTabServer: string
  DefaultTabDatabase: string
  DefaultTabTable: string
  ShowChgPassword: boolean
  VersionCheck: boolean
  NavigationDisplayServers: boolean
  ServerDefault: number
  FirstDayOfCalendar: number
  [key: string]: unknown
}

/** phpMyAdmin defaults, used until the endpoint answered (and in unit tests). */
export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  ThemeDefault: 'pmahomme',
  ThemeManager: true,
  ThemePerServer: false,
  TabsMode: 'both',
  ActionLinksMode: 'both',
  TableNavigationLinksMode: 'icons',
  RowActionType: 'both',
  Confirm: true,
  InitialSlidersState: 'closed',
  ShowHint: true,
  DisableShortcutKeys: false,
  enable_drag_drop_import: true,
  SendErrorReports: 'ask',
  TitleDefault: '@HTTP_HOST@ | @PHPMYADMIN@',
  TitleServer: '@HTTP_HOST@ / @VSERVER@ | @PHPMYADMIN@',
  TitleDatabase: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ | @PHPMYADMIN@',
  TitleTable: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ | @PHPMYADMIN@',
  DefaultTabServer: '/',
  DefaultTabDatabase: '/database/structure',
  DefaultTabTable: '/sql',
  ShowChgPassword: true,
  VersionCheck: true,
  NavigationDisplayServers: true,
  ServerDefault: 1,
  FirstDayOfCalendar: 0,
}

export function useConfig(): ClientConfig {
  const q = useQuery({ queryKey: qk.config, queryFn: api.configPublic, staleTime: Number.POSITIVE_INFINITY })
  return q.data === undefined ? DEFAULT_CLIENT_CONFIG : { ...DEFAULT_CLIENT_CONFIG, ...q.data }
}

export function uiSettingsFrom(cfg: ClientConfig, serverVersion = 0, isMariaDb = false): UiSettings {
  return {
    ActionLinksMode: cfg.ActionLinksMode,
    TabsMode: cfg.TabsMode,
    TableNavigationLinksMode: cfg.TableNavigationLinksMode,
    RowActionType: cfg.RowActionType,
    Confirm: cfg.Confirm,
    InitialSlidersState: cfg.InitialSlidersState,
    ShowHint: cfg.ShowHint,
    serverVersion,
    isMariaDb,
    gettext: (msgid) => t(msgid),
    pgettext: (context, msgid) => pgettext(context, msgid),
    // Settings::getFirstDayOfCalendar: 1-7 kept, anything else 0
    FirstDayOfCalendar:
      cfg.FirstDayOfCalendar >= 1 && cfg.FirstDayOfCalendar <= 7 ? Math.trunc(cfg.FirstDayOfCalendar) : 0,
  }
}

/** The project's homepage (the login logo, the home page's "Official Homepage"). */
export const PROJECT_URL = 'https://github.com/cB-Abhinav-Gautam/better-myadmin'
