import { LANG_COOKIE } from '@bettermyadmin/contracts'
import { LanguageManager } from '@bettermyadmin/i18n'
import { translatorFor } from '@bettermyadmin/i18n/node'
import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from './app.ts'
import type { AppConfig } from './config.ts'

/** One LanguageManager per configuration (pma: LanguageManager::getInstance). */
export function languageManager(cfg: AppConfig): LanguageManager {
  return new LanguageManager({
    Lang: cfg.Lang,
    DefaultLang: cfg.DefaultLang,
    FilterLanguages: cfg.FilterLanguages,
  })
}

/**
 * Per-request language: selectLanguage + activate, then the language cookie is written on every response.
 * pma: src/Http/Middleware/LanguageLoading.php, LanguageAndThemeCookieSaving.php
 */
export function languageLoading(lm: LanguageManager): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { cfg } = c.get('deps')
    const sel = lm.selectLanguage({
      get: c.req.query('lang'),
      cookie: getCookie(c, LANG_COOKIE),
      acceptLanguage: c.req.header('accept-language'),
      userAgent: c.req.header('user-agent'),
    })
    c.set('languageManager', lm)
    c.set('language', sel.language)
    c.set('tr', translatorFor(sel.language.code))
    c.set('languageWarning', sel.ignoredUnsupported)
    await next()
    const sameSite = (
      ['Lax', 'Strict', 'None'].includes(cfg.CookieSameSite) ? cfg.CookieSameSite : 'Strict'
    ) as 'Lax' | 'Strict' | 'None'
    const path = cfg.Listen?.basePath !== undefined && cfg.Listen.basePath !== '' ? cfg.Listen.basePath : '/'
    // Config::setCookie default validity: 30 days
    setCookie(c, LANG_COOKIE, sel.language.code, {
      path,
      httpOnly: true,
      secure: c.get('isHttps'),
      sameSite,
      maxAge: 30 * 24 * 3600,
    })
  }
}
