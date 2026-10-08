import type { ConsoleSettings } from '@bettermyadmin/contracts'
import { api } from '../../lib/api'

/** $cfg['Console'] defaults (src/Config/Settings/Console.php). */
export const CONSOLE_DEFAULTS: ConsoleSettings = {
  StartHistory: false,
  AlwaysExpand: false,
  CurrentQuery: true,
  EnterExecutes: false,
  DarkTheme: false,
  Mode: 'info',
  Height: 92,
  GroupQueries: false,
  OrderBy: 'exec',
  Order: 'asc',
}

/**
 * Persists one option through /console/config (pma: /console/update-config → setUserValue into the
 * user preferences of the configuration storage or the session). Values are sent the way the console
 * posts them ('true'/'false'). Nothing is kept in the browser, like phpMyAdmin.
 * pma: resources/js/modules/console/config.ts
 */
export async function saveConsoleSetting<K extends keyof ConsoleSettings>(
  server: number,
  key: K,
  value: ConsoleSettings[K],
): Promise<void> {
  try {
    await api.consoleConfigUpdate(server, key, String(value))
  } catch {
    // phpMyAdmin ignores a failed update-config request too (the page keeps the new value)
  }
}

/** Mode: an invalid value falls back to info (Console.setConfig). */
export function normaliseMode(mode: unknown): ConsoleSettings['Mode'] {
  return mode === 'show' || mode === 'collapse' || mode === 'info' ? mode : 'info'
}
