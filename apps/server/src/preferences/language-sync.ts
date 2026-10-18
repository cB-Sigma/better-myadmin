import { LANG_COOKIE } from '@bettermyadmin/contracts'
import { translatorFor } from '@bettermyadmin/i18n/node'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../app.ts'
import type { MetaRequest } from '../metadata/service.ts'

/**
 * The language part of loadUserPreferences: a language chosen anywhere (the language cookie is
 * present) is silently stored as the `lang` preference (removed again for `en`); without the
 * cookie, a stored `lang` becomes the request's language (the cookie is then written with it).
 * pma: src/Config/UserPreferencesHandler.php::loadUserPreferences ("save language")
 */
export async function syncLanguagePreference(c: Context<AppEnv>, m: MetaRequest): Promise<void> {
  const { userprefs } = await m.appliedPrefs()
  const stored = userprefs.lang
  const current = c.get('language').code
  // pma: $config->issetCookie('pma_lang') || isset($_POST['lang'])
  if (getCookie(c, LANG_COOKIE) !== undefined || c.req.query('lang') !== undefined) {
    if ((stored === undefined && current !== 'en') || (stored !== undefined && current !== stored)) {
      // setUserValue('lang', Current::$lang, 'en')
      await (await m.meta()).userPreferences().persistOption('lang', current, 'en')
      m.forgetPrefs()
    }
    return
  }
  if (typeof stored !== 'string') return
  // read language from settings
  const language = c.get('languageManager').getLanguage(stored)
  if (language === undefined) return
  c.set('language', language)
  c.set('tr', translatorFor(language.code))
}
