import { DocLink, PanelItem, PmaIcon } from '@bettermyadmin/ui'
import { useLanguage } from '../../../lib/i18n'
import { LanguageLabel, LanguageSelect } from '../LanguageSelect'

/** LanguageManager::hasChoice() with `$cfg['Lang'] === ''`: the server sends no list otherwise. */
export function useLanguageChoice(): boolean {
  const { state } = useLanguage()
  return state !== null && state.languages !== null && state.languages.length > 1
}

/**
 * `#li_select_lang` of the Appearance settings card: the i18n branch's autosubmit language selector.
 * pma: resources/templates/home/index.twig (#li_select_lang)
 */
export function LanguageSlot() {
  if (!useLanguageChoice()) return null
  return (
    <PanelItem id="li_select_lang" className="flex flex-wrap items-center gap-2">
      <label htmlFor="languageSelect" className="flex items-center gap-1 whitespace-nowrap">
        <PmaIcon name="s_lang" /> <LanguageLabel /> <DocLink page="faq" anchor="faq7-2" />
      </label>
      <LanguageSelect className="input w-auto" />
    </PanelItem>
  )
}
