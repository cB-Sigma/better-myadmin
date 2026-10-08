import {
  type ConsoleConfigResponse,
  ConsoleConfigUpdate,
  type ConsoleSettings,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import type { AppConfig } from '../config.ts'
import { BmaError } from '../http/errors.ts'
import type { SessionData } from '../session/store.ts'
import type { ServerEnv } from './server.ts'
import { parseBody } from './sql.ts'

export const consoleRoutes = new Hono<ServerEnv>()

/**
 * Where Console/* values are persisted. phpMyAdmin's UserPreferencesHandler::setUserValue keeps them in
 * pmadb (pma__userconfig) or, without it, in the session; the pmadb writer installs itself here.
 */
export interface ConsolePrefsWriter {
  set(session: SessionData, key: string, value: boolean | number | string): Promise<void>
}

const sessionWriter: ConsolePrefsWriter = {
  set: async (session, key, value) => {
    session.consolePrefs ??= {}
    session.consolePrefs[key] = value
  },
}
let writer: ConsolePrefsWriter = sessionWriter

export function setConsolePrefsWriter(w: ConsolePrefsWriter | null): void {
  writer = w ?? sessionWriter
}

/** $cfg['Console'] merged with the user's values. */
export function consoleSettings(cfg: AppConfig, session: SessionData): ConsoleSettings {
  const c = cfg.Console as ConsoleSettings
  return { ...c, ...(session.consolePrefs ?? {}) } as ConsoleSettings
}

const BOOL_KEYS = [
  'StartHistory',
  'AlwaysExpand',
  'CurrentQuery',
  'EnterExecutes',
  'DarkTheme',
  'GroupQueries',
]
const KEYS = [...BOOL_KEYS, 'Mode', 'Height', 'OrderBy', 'Order']

class UnexpectedParameter extends BmaError {
  constructor() {
    super('VALIDATION', 'Unexpected parameter value.', 400)
  }
}

/** pma: src/Controllers/Console/UpdateConfigController.php::parseValueParam */
export function parseConsoleValue(key: string, raw: unknown): boolean | number | string {
  if (!KEYS.includes(key)) throw new UnexpectedParameter()
  // the form posts strings; JSON clients may send the typed value
  const value = typeof raw === 'boolean' || typeof raw === 'number' ? String(raw) : raw
  if (BOOL_KEYS.includes(key) && (value === 'true' || value === 'false')) return value === 'true'
  if (key === 'Mode' && (value === 'show' || value === 'collapse' || value === 'info')) return value
  if (
    key === 'Height' &&
    typeof value === 'string' &&
    /^\s*\d+(\.\d+)?\s*$/.test(value) &&
    Number(value) > 0
  ) {
    return Math.trunc(Number(value))
  }
  if (key === 'OrderBy' && (value === 'exec' || value === 'time' || value === 'count')) return value
  if (key === 'Order' && (value === 'asc' || value === 'desc')) return value
  throw new UnexpectedParameter()
}

/** GET /api/servers/:s/console/config — what console/display.twig receives. */
consoleRoutes.get('/config', (c) => {
  const { cfg } = c.get('deps')
  const body: ConsoleConfigResponse = {
    settings: consoleSettings(cfg, c.get('session')),
    debugSql: cfg.DBG.sql,
    maxCharactersInDisplayedSql: cfg.MaxCharactersInDisplayedSQL,
    confirm: cfg.Confirm,
  }
  return c.json(body)
})

/** POST /api/servers/:s/console/config — pma: /console/update-config */
consoleRoutes.post('/config', async (c) => {
  const req = await parseBody(c, ConsoleConfigUpdate)
  const value = parseConsoleValue(req.key, req.value)
  await writer.set(c.get('session'), req.key, value)
  return c.json({ message: 'Console settings has been updated successfully.' })
})
