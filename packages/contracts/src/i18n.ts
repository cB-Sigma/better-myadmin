import { z } from 'zod'

/** Cookie remembering the chosen language (pma: `pma_lang`, written on every request). */
export const LANG_COOKIE = 'bma_lang'

export const LanguageOption = z.object({
  /** Lower-case code, the `lang` parameter value (`pt_br`). */
  key: z.string(),
  /** `Native - English` (Language::getName). */
  name: z.string(),
})
export type LanguageOption = z.infer<typeof LanguageOption>

/** GET /api/i18n[?lang=xx] — the request's language (LanguageManager::selectLanguage). */
export const I18nState = z.object({
  key: z.string(),
  /** Catalogue code (`pt_BR`), also the `<html lang>` value phpMyAdmin prints. */
  code: z.string(),
  dir: z.enum(['ltr', 'rtl']),
  /**
   * The language selector's options sorted by English name, or null when phpMyAdmin hides the
   * selector (`Lang` is set, or there is only one language).
   */
  languages: z.array(LanguageOption).nullable(),
  /** "Ignoring unsupported language code." (translated) when a requested code was not available. */
  warning: z.string().nullable(),
})
export type I18nState = z.infer<typeof I18nState>
