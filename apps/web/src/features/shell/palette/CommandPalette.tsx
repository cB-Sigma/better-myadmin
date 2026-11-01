import {
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandMenu,
  CommandShortcut,
  CommandStatus,
  PmaIcon,
} from '@bettermyadmin/ui'
import { THEMES, getTheme } from '@bettermyadmin/ui/themes'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useConfig } from '../../../lib/config.ts'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys.ts'
import { parsePhpQuery } from '../../../lib/search'
import { recentFavoriteQuery, useOpenRecentFavorite } from '../../navigation/NavExtras.tsx'
import { useLogout } from '../UserMenu.tsx'
import { CONSOLE_TOGGLE_EVENT } from '../hotkeys/useShortcuts.tsx'
import { useDatabaseScope, useServerScope, useTableScope } from '../scope.ts'
import { DB_TABS, SERVER_TABS, TABLE_TABS, type TabDef } from '../tabs.ts'
import { colorModeText, setTheme, useThemeState } from '../theme/theme.ts'
import { type PaletteEntry, highlightRuns, isPaletteShortcut, paletteGroups } from './groups.ts'
import { type PaletteScope, registeredCommands, useRegistryVersion } from './registry.ts'

/** Rows shown per navigation group (the server already caps what it sends). */
const LIMITS = { tables: 30, databases: 15 } as const
/** Typing pauses this long before the server is asked. */
const DEBOUNCE_MS = 120

const enc = encodeURIComponent
const DIALOG_ID = 'bma_command_palette_dialog'
const dialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

/**
 * BetterMyAdmin's command palette (parity exception X61; phpMyAdmin has none): Ctrl+Shift+P /
 * Cmd+Shift+P (Ctrl+K is phpMyAdmin's console toggle) or the top bar's button opens a searchable
 * list of the recent tables, the current level's tabs, general actions, themes, and the server's
 * databases and tables (matched on the server, ranked here by fuzzy.ts). Other features add
 * commands through registry.ts. The shortcut follows DisableShortcutKeys; the button is always there.
 */
export function CommandPalette({
  server,
  db,
  table,
  shortcutsDisabled,
}: PaletteScope & { shortcutsDisabled: boolean }) {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  openRef.current = open
  /** where the focus was when the palette opened: it goes back there on close */
  const opener = useRef<HTMLElement | null>(null)
  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }, [])
  const builtins = useBuiltinCommands({ server, db, table })

  useEffect(() => {
    if (shortcutsDisabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      if (openRef.current) setOpen(false)
      // another dialog is open: leave it alone (like the other shortcuts)
      else if (!dialogOpen()) show()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shortcutsDisabled, show])

  // the chosen command runs once the dialog has closed and given the focus back
  const pending = useRef<PaletteEntry | null>(null)
  const choose = (entry: PaletteEntry) => {
    pending.current = entry
    setOpen(false)
  }

  return (
    <>
      <Button
        size="sm"
        id="bma_command_palette"
        // i18n-new: BetterMyAdmin's command palette (parity exception X61)
        title={t('Command palette')}
        // i18n-new: BetterMyAdmin's command palette (parity exception X61)
        aria-label={t('Command palette')}
        aria-haspopup="dialog"
        aria-keyshortcuts={shortcutsDisabled ? undefined : 'Control+Shift+P Meta+Shift+P'}
        onClick={show}
      >
        <PmaIcon name="b_search" />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        id={DIALOG_ID}
        // i18n-new: BetterMyAdmin's command palette (parity exception X61)
        title={t('Command palette')}
        onCloseAutoFocus={(e) => {
          // a Dialog without a Radix trigger gives the focus to nobody: back to the opener
          e.preventDefault()
          if (opener.current?.isConnected === true) opener.current.focus()
          opener.current = null
          const entry = pending.current
          pending.current = null
          // then the command (a console toggle, a dialog or the next page takes the focus)
          if (entry !== null) setTimeout(() => void entry.run(), 0)
        }}
      >
        <PaletteBody scope={{ server, db, table }} builtins={builtins} onChoose={choose} />
      </CommandDialog>
    </>
  )
}

function PaletteBody({
  scope,
  builtins,
  onChoose,
}: {
  scope: PaletteScope
  builtins: PaletteEntry[]
  onChoose: (entry: PaletteEntry) => void
}) {
  const { server, db } = scope
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [query])
  const targets = useQuery({
    queryKey: qk.commandPalette(server, debounced, db),
    queryFn: () => api.commandPalette(server, debounced, db),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const recent = useQuery(recentFavoriteQuery(server))
  const openRecent = useOpenRecentFavorite(server)
  useRegistryVersion()
  const empty = query.trim() === ''

  const headings = {
    recent: t('Recently visited tables'),
    tables: t('Tables'),
    databases: t('Databases'),
  }
  const entries: PaletteEntry[] = []
  if (empty) {
    for (const tb of recent.data?.recent ?? []) {
      entries.push({
        id: `recent:${JSON.stringify([tb.db, tb.table])}`,
        group: headings.recent,
        label: tb.table,
        detail: tb.db,
        icon: 's_tbl',
        match: [tb.table],
        run: () => openRecent(tb),
      })
    }
  }
  entries.push(...builtins, ...registeredCommands(scope))
  for (const tb of targets.data?.tables ?? []) {
    entries.push({
      id: `table:${JSON.stringify([tb.db, tb.table])}`,
      group: headings.tables,
      label: tb.table,
      detail: tb.db,
      icon: tb.view ? 's_views' : 's_tbl',
      match: [tb.table, `${tb.db}.${tb.table}`],
      run: () =>
        void navigate({
          to: '/s/$server/db/$db/t/$table/browse',
          params: { server, db: tb.db, table: tb.table },
        }),
    })
  }
  for (const name of targets.data?.databases ?? []) {
    entries.push({
      id: `db:${name}`,
      group: headings.databases,
      label: name,
      icon: 's_db',
      run: () => void navigate({ to: '/s/$server/db/$db/structure', params: { server, db: name } }),
    })
  }
  const groups = paletteGroups(entries, query, {
    [headings.tables]: LIMITS.tables,
    [headings.databases]: LIMITS.databases,
  })

  // the highlighted row: the best match after each keystroke and whenever the best match changes
  // (the server's results arrive), else the row the user moved to
  const byId = new Map(groups.flatMap((g) => g.rows.map((r) => [r.entry.id, r.entry] as const)))
  const first = groups[0]?.rows[0]?.entry.id ?? ''
  const key = `${query}\u0000${first}`
  const [moved, setMoved] = useState({ key: '', value: '' })
  const selected = moved.key === key && byId.has(moved.value) ? moved.value : first
  // cmdk updates aria-activedescendant only when it changes the value itself (arrow keys, hover),
  // not for a controlled value: point the combobox and the listbox at the highlighted option
  useLayoutEffect(() => {
    const root = document.getElementById(DIALOG_ID)
    const option = root?.querySelector(`[cmdk-item][data-value="${CSS.escape(selected)}"]`)
    for (const el of root?.querySelectorAll('[cmdk-input], [cmdk-list]') ?? []) {
      if (option?.id) el.setAttribute('aria-activedescendant', option.id)
      else el.removeAttribute('aria-activedescendant')
    }
  })

  return (
    <CommandMenu
      // i18n-new: BetterMyAdmin's command palette (parity exception X61)
      label={t('Search databases, tables and commands')}
      value={selected}
      onValueChange={(value) => setMoved({ key, value })}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        // i18n-new: BetterMyAdmin's command palette (parity exception X61)
        placeholder={t('Search databases, tables and commands')}
      />
      {targets.isFetching && <CommandStatus>{t('Searching')}</CommandStatus>}
      <CommandList>
        {/* i18n-new: BetterMyAdmin's command palette (parity exception X61) */}
        <CommandEmpty>{t('No matches')}</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.heading} heading={g.heading}>
            {g.rows.map(({ entry, positions }) => (
              <CommandItem
                key={entry.id}
                value={entry.id}
                onSelect={(v) => {
                  const e = byId.get(v)
                  if (e !== undefined) onChoose(e)
                }}
              >
                {entry.icon !== undefined && <PmaIcon name={entry.icon} />}
                <span className="min-w-0 truncate">
                  {highlightRuns(entry.label, positions).map((r, i) =>
                    r.hit ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: runs of a fixed label
                      <mark key={i} className="bg-transparent font-bold text-inherit">
                        {r.text}
                      </mark>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: runs of a fixed label
                      <span key={i}>{r.text}</span>
                    ),
                  )}
                </span>
                {entry.detail !== undefined && entry.detail !== '' && (
                  <span className="min-w-0 truncate text-xs opacity-70">{entry.detail}</span>
                )}
                {entry.shortcut !== undefined && <CommandShortcut>{entry.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandMenu>
  )
}

/**
 * The palette's own commands: the current level's tabs (Menu::get*Tabs, the same definitions and
 * msgids as the tab bar), Home, Settings, the console, Log out, the themes and colour modes.
 */
function useBuiltinCommands({ server, db, table }: PaletteScope): PaletteEntry[] {
  const cfg = useConfig()
  const navigate = useNavigate()
  const logout = useLogout()
  const serverScope = useServerScope(server)
  const dbScope = useDatabaseScope(server, db)
  const tableScope = useTableScope(server, db, table)
  const themeOpts = useMemo(
    () => ({ themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server }),
    [cfg.ThemeDefault, cfg.ThemePerServer, server],
  )
  const theme = useThemeState(themeOpts)

  const go = (href: string) => {
    const [path = '', qs = ''] = href.split('?')
    void navigate({ to: path as never, search: parsePhpQuery(qs) as never })
  }
  const tabs = <K extends string>(
    heading: string,
    defs: Record<K, TabDef>,
    keys: K[],
    base: string,
    search: Partial<Record<K, string>> = {},
  ): PaletteEntry[] =>
    keys.map((key) => {
      const d = defs[key]
      return {
        id: `tab:${base}:${key}`,
        group: heading,
        // Menu::get*Tabs: __('Structure'), __('SQL'), … (the tab bar's msgids)
        label: t(d.text),
        icon: d.icon,
        keywords: [d.text, d.path],
        run: () => go(`${base}/${d.path}${search[key] ?? ''}`),
      }
    })

  const out: PaletteEntry[] = []
  const serverBase = `/s/${server}`
  if (table !== '') {
    out.push(
      ...tabs(
        t('Table'),
        TABLE_TABS,
        tableScope.data?.tabs.map((x) => x.key) ?? [],
        `${serverBase}/db/${enc(db)}/t/${enc(table)}`,
        { browse: '?pos=0', export: '?single_table=true' },
      ),
    )
  } else if (db !== '') {
    out.push(
      ...tabs(
        t('Database'),
        DB_TABS,
        dbScope.data?.tabs.map((x) => x.key) ?? [],
        `${serverBase}/db/${enc(db)}`,
      ),
    )
  } else {
    out.push(...tabs(t('Server'), SERVER_TABS, serverScope.data?.tabs.map((x) => x.key) ?? [], serverBase))
  }

  const actions = t('Actions')
  out.push(
    {
      id: 'action:home',
      group: actions,
      label: t('Home'),
      icon: 'b_home',
      run: () => void navigate({ to: '/s/$server', params: { server } }),
    },
    {
      id: 'action:settings',
      group: actions,
      label: t('Settings'),
      icon: 's_cog',
      keywords: ['Settings', 'Preferences'],
      run: () => void navigate({ to: '/s/$server/preferences/manage', params: { server } }),
    },
    {
      id: 'action:console',
      group: actions,
      // i18n-new: BetterMyAdmin's command palette (parity exception X61)
      label: t('Toggle console'),
      icon: 'b_sql',
      keywords: ['Console'],
      shortcut: 'Ctrl+Alt+C',
      run: () => void window.dispatchEvent(new CustomEvent(CONSOLE_TOGGLE_EVENT)),
    },
    {
      id: 'action:logout',
      group: actions,
      label: t('Log out'),
      icon: 's_loggoff',
      keywords: ['Logout', 'Sign out'],
      run: () => logout.mutate(),
    },
  )

  const themeHeading = t('Theme')
  for (const m of THEMES) {
    out.push({
      id: `theme:${m.id}`,
      group: themeHeading,
      label: m.name,
      icon: 's_theme',
      detail: m.id === theme.theme ? '✓' : undefined,
      keywords: ['Theme'],
      run: () => void setTheme(themeOpts, m.id),
    })
  }
  const modes = getTheme(theme.theme)?.colorModes ?? []
  const modeHeading = t('Color mode for the theme')
  for (const mode of modes) {
    out.push({
      id: `color-mode:${mode}`,
      group: modeHeading,
      label: colorModeText(mode),
      icon: 's_theme',
      detail: mode === theme.colorMode ? '✓' : undefined,
      keywords: [mode, 'Appearance'],
      run: () => void setTheme(themeOpts, theme.theme, mode),
    })
  }
  return out
}
