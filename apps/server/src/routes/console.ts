import {
  type ConsoleConfigResponse,
  ConsoleConfigUpdate,
  type ConsoleSettings,
} from '@bettermyadmin/contracts'
import { type Gettext, englishTranslator } from '@bettermyadmin/i18n'
import { Hono } from 'hono'
import { BmaError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { defaultOfPath, withMeta } from '../metadata/service.ts'
import type { ServerEnv } from './server.ts'

export const consoleRoutes = new Hono<ServerEnv>()

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
  constructor(tr: Gettext) {
    super('VALIDATION', tr.gettext('Unexpected parameter value.'), 400)
  }
}

/** pma: src/Controllers/Console/UpdateConfigController.php::parseValueParam */
export function parseConsoleValue(
  key: string,
  raw: unknown,
  tr: Gettext = englishTranslator(),
): boolean | number | string {
  if (!KEYS.includes(key)) throw new UnexpectedParameter(tr)
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
  throw new UnexpectedParameter(tr)
}

/**
 * GET /api/servers/:s/console/config — what console/display.twig receives: `$cfg['Console']` with the
 * user's preferences applied (UserPreferencesHandler::loadUserPreferences).
 */
consoleRoutes.get('/config', (c) =>
  withMeta(c, {}, async (m) => {
    const settings = await m.settings()
    const body: ConsoleConfigResponse = {
      settings: settings.Console as ConsoleSettings,
      debugSql: settings.DBG.sql,
      maxCharactersInDisplayedSql: settings.MaxCharactersInDisplayedSQL,
      confirm: settings.Confirm,
    }
    return c.json(body)
  }),
)

/**
 * POST /api/servers/:s/console/config — UserPreferencesHandler::setUserValue('Console/<key>'): the user
 * preferences in the configuration storage (pma__userconfig, the local store) or the session.
 * pma: /console/update-config
 */
consoleRoutes.post('/config', async (c) => {
  const tr = c.get('tr')
  const req = await parseJson(c, ConsoleConfigUpdate)
  const value = parseConsoleValue(req.key, req.value, tr)
  return withMeta(c, {}, async (m) => {
    const path = `Console/${req.key}`
    const r = await (await m.meta()).userPreferences().persistOption(path, value, defaultOfPath(path))
    if (r !== true) return c.json({ message: r.text }, 500)
    return c.json({ message: tr.gettext('Console settings has been updated successfully.') })
  })
})
