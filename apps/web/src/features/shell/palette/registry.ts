import type { PmaIconName } from '@bettermyadmin/ui'
import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * The command palette's action registry (BetterMyAdmin only, parity exception X61).
 *
 * Any feature can add commands to the palette (Ctrl+Shift+P / Cmd+Shift+P, or the top bar's button)
 * without the palette knowing about it:
 *
 * ```tsx
 * // while a component is mounted (the commands may close over its state):
 * useRegisterCommands(() => [
 *   { id: 'browse:refresh', group: t('Browse'), label: t('Refresh'), icon: 's_reload', run: refetch },
 * ], [refetch])
 *
 * // or for the whole session, from module code; returns the function that removes them:
 * const unregister = registerCommands((scope) =>
 *   scope.db === '' ? [] : [{ id: 'db:designer', group: …, label: …, run: () => … }],
 * )
 * ```
 *
 * A source is a list of commands or a function of the current scope (server, database, table) that
 * returns one; it is called each time the palette renders. `label` and `group` are shown as given,
 * so pass translated text (`t()` with phpMyAdmin's msgid, or a BetterMyAdmin msgid annotated
 * `// i18n-new:`). Commands with the same `group` are listed together under that heading; ids must
 * be unique (a later registration with the same id replaces the earlier one). `run` is called after
 * the palette has closed, so it may open a dialog or navigate.
 */
export interface PaletteCommand {
  /** unique id, e.g. `console:toggle` */
  id: string
  /** the visible, translated text; it is what the query is matched against first */
  label: string
  /** the group heading (translated) */
  group: string
  icon?: PmaIconName | undefined
  /** secondary text shown after the label (a database name, the current theme…) */
  detail?: string | undefined
  /** further words the query may match (not shown), e.g. English synonyms or the route */
  keywords?: string[] | undefined
  /** a key combination shown at the end of the row (e.g. `Ctrl+Alt+C`) */
  shortcut?: string | undefined
  run: () => void | Promise<void>
}

export interface PaletteScope {
  server: number
  /** '' outside a database */
  db: string
  /** '' outside a table */
  table: string
}

export type CommandSource = readonly PaletteCommand[] | ((scope: PaletteScope) => readonly PaletteCommand[])

const sources = new Map<symbol, CommandSource>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version++
  for (const l of listeners) l()
}

/** Adds commands to the palette until the returned function is called. */
export function registerCommands(source: CommandSource): () => void {
  const key = Symbol('palette-commands')
  sources.set(key, source)
  changed()
  return () => {
    if (sources.delete(key)) changed()
  }
}

/** The registered commands for a scope, in registration order; a repeated id keeps the last one. */
export function registeredCommands(scope: PaletteScope): PaletteCommand[] {
  const byId = new Map<string, PaletteCommand>()
  for (const source of sources.values()) {
    const list = typeof source === 'function' ? source(scope) : source
    for (const c of list) {
      byId.delete(c.id)
      byId.set(c.id, c)
    }
  }
  return [...byId.values()]
}

/** Re-renders when commands are registered or removed; returns a counter that changes with them. */
export function useRegistryVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

/**
 * Registers commands while the calling component is mounted. `factory` is re-run (and the commands
 * replaced) when `deps` change, like useMemo: list in `deps` whatever the commands close over.
 */
export function useRegisterCommands(
  factory: () => readonly PaletteCommand[],
  deps: readonly unknown[],
): void {
  const latest = useRef(factory)
  latest.current = factory
  // the caller's deps decide when to rebuild
  useEffect(() => registerCommands(latest.current()), deps)
}
