/**
 * `#li_select_lang` of the Appearance settings card. The i18n layer (LanguageManager port) fills
 * this slot; until it lands only English exists, so — like phpMyAdmin with a single language —
 * nothing is rendered (`$cfg['Lang'] === '' && LanguageManager::hasChoice()`).
 * pma: resources/templates/home/index.twig (#li_select_lang)
 */
export function LanguageSlot() {
  return null
}

/** LanguageManager::hasChoice() */
LanguageSlot.hasChoice = (): boolean => false
