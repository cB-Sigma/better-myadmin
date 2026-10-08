import { type I18n, setupI18n } from '@lingui/core'
import type { Catalog } from './compile.ts'
import { type PluralRule, extractPluralsForms, pluralRule } from './plural.ts'

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * gettext on top of a Lingui catalogue, with motranslator's semantics (phpMyAdmin's gettext):
 * a missing key returns the msgid, plurals pick the form via the ported Plural-Forms evaluator and fall
 * back to `n !== 1 ? plural : singular` when untranslated.
 *
 * Msgids are phpMyAdmin's verbatim (printf placeholders included), so they are passed as explicit Lingui
 * ids; placeholders are filled afterwards with the PHP `sprintf` port, exactly like `sprintf(__('…'), …)`.
 *
 * pma: vendor/phpmyadmin/motranslator/src/Translator.php
 */
export class Translator {
  readonly locale: string
  readonly i18n: I18n
  readonly #messages: Catalog['messages']
  readonly #plural: PluralRule

  constructor(locale: string, catalog: Catalog | null, i18n?: I18n) {
    this.locale = locale
    this.#messages = catalog?.messages ?? {}
    // the English "catalogue" is empty: Translator::extractPluralsForms's default applies
    this.#plural = pluralRule(
      catalog !== null && catalog.pluralForms !== '' ? catalog.pluralForms : extractPluralsForms(''),
    )
    this.i18n = i18n ?? setupI18n()
    this.i18n.load(locale, this.#messages)
    this.i18n.activate(locale)
  }

  /** Translator::gettext (`__()`) */
  gettext(msgid: string): string {
    if (!hasOwn(this.#messages, msgid)) return msgid
    return this.i18n._(msgid)
  }

  /** Translator::ngettext (`_ngettext()`) */
  ngettext(msgid: string, msgidPlural: string, n: number): string {
    const key = `${msgid}\u0000${msgidPlural}`
    if (!hasOwn(this.#messages, key)) return n !== 1 ? msgidPlural : msgid
    return this.i18n._(key, { i: this.#plural.select(n) })
  }

  /** Translator::pgettext (`_pgettext()`) */
  pgettext(msgctxt: string, msgid: string): string {
    const key = `${msgctxt}\u0004${msgid}`
    if (!hasOwn(this.#messages, key)) return msgid
    return this.i18n._(key)
  }

  /** Translator::npgettext (`_npgettext()`) */
  npgettext(msgctxt: string, msgid: string, msgidPlural: string, n: number): string {
    const key = `${msgctxt}\u0004${msgid}\u0000${msgidPlural}`
    if (!hasOwn(this.#messages, key)) return n !== 1 ? msgidPlural : msgid
    return this.i18n._(key, { i: this.#plural.select(n) })
  }

  /** Whether the catalogue has a translation (Translator::exists). */
  exists(key: string): boolean {
    return hasOwn(this.#messages, key)
  }
}

/** The untranslated (English) translator. */
export const englishTranslator = (): Translator => new Translator('en', null)

/** Minimal surface the formatting helpers need. */
export interface Gettext {
  gettext(msgid: string): string
  pgettext(msgctxt: string, msgid: string): string
}
