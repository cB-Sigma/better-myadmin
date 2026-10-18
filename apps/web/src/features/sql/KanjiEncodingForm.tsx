import { pgettext, t } from '../../lib/i18n'

/**
 * The Kanji conversion options of the Japanese locale (knjenc: none / EUC-JP / SJIS, xkana).
 * pma: resources/templates/encoding/kanji_encoding_form.twig
 */
export function KanjiEncodingForm() {
  return (
    <ul className="space-y-1 text-[13px]">
      <li className="flex flex-wrap items-center gap-2">
        <input type="radio" name="knjenc" value="" defaultChecked id="kj-none" />
        <label htmlFor="kj-none">{pgettext('None encoding conversion', 'None')}</label>
        <input type="radio" name="knjenc" value="EUC-JP" id="kj-euc" />
        <label htmlFor="kj-euc">EUC</label>
        <input type="radio" name="knjenc" value="SJIS" id="kj-sjis" />
        <label htmlFor="kj-sjis">SJIS</label>
      </li>
      <li className="flex items-center gap-2">
        <input type="checkbox" name="xkana" value="kana" id="kj-kana" />
        <label htmlFor="kj-kana">{t('Convert to Kana')}</label>
      </li>
    </ul>
  )
}
