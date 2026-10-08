import type { I18nState } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import type { AppEnv } from '../app.ts'

export const i18nRoutes = new Hono<AppEnv>()

/**
 * GET /api/i18n[?lang=xx] — the language of this request and the selector's options
 * (pma: login/form.twig and home/index.twig `#languageSelect`, shown when `Lang` is empty and
 * LanguageManager::hasChoice()).
 */
i18nRoutes.get('/', (c) => {
  const { cfg } = c.get('deps')
  const lang = c.get('language')
  const tr = c.get('tr')
  const lm = c.get('languageManager')
  const body: I18nState = {
    key: lang.key,
    code: lang.code,
    dir: lang.dir,
    languages:
      cfg.Lang === '' && lm.hasChoice()
        ? lm.sortedLanguages().map((l) => ({ key: l.key, name: l.name }))
        : null,
    warning: c.get('languageWarning') ? tr.gettext('Ignoring unsupported language code.') : null,
  }
  return c.json(body)
})
