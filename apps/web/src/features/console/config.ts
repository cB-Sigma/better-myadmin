import type { ConsoleSettings } from '@bettermyadmin/contracts'
import { api } from '../../lib/api'
import { storage } from '../sql/logic'

const LOCAL_KEY = 'bma_console_config'

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

/** Values changed in this browser (kept until user preferences are stored server-side). */
export function localConsoleSettings(): Partial<ConsoleSettings> {
  try {
    return JSON.parse(storage.get(LOCAL_KEY) ?? '{}') as Partial<ConsoleSettings>
  } catch {
    return {}
  }
}

/**
 * Persists one option: in this browser and through /console/config (pma: /console/update-config, which
 * validates the key and value). Values are sent the way the console posts them ('true'/'false').
 * pma: resources/js/modules/console/config.ts
 */
export async function saveConsoleSetting<K extends keyof ConsoleSettings>(
  server: number,
  key: K,
  value: ConsoleSettings[K],
): Promise<void> {
  const local = localConsoleSettings()
  local[key] = value
  storage.set(LOCAL_KEY, JSON.stringify(local))
  try {
    await api.consoleConfigUpdate(server, key, String(value))
  } catch {
    // the local value still applies; the server keeps phpMyAdmin's validation
  }
}

/** Mode: an invalid value falls back to info (Console.setConfig). */
export function normaliseMode(mode: unknown): ConsoleSettings['Mode'] {
  return mode === 'show' || mode === 'collapse' || mode === 'info' ? mode : 'info'
}
