import { t, useLanguage } from '../../lib/i18n'

/**
 * The language `<select>` (autosubmit): options are the lower-case codes labelled `Native - English`,
 * sorted by English name, the active one selected.
 * pma: resources/templates/login/form.twig, home/index.twig (`#languageSelect`)
 */
export function LanguageSelect(props: { labelledBy?: string; className?: string }) {
  const { state, setLanguage } = useLanguage()
  if (state === null || state.languages === null) return null
  return (
    <select
      name="lang"
      id="languageSelect"
      className={props.className ?? 'input'}
      lang="en"
      dir="ltr"
      aria-labelledby={props.labelledBy}
      value={state.key}
      onChange={(e) => void setLanguage(e.target.value)}
    >
      {state.languages.map((l) => (
        <option key={l.key} value={l.key}>
          {l.name}
        </option>
      ))}
    </select>
  )
}

/** "Language" plus the English hint phpMyAdmin adds when the word is translated. */
export function LanguageLabel() {
  const label = t('Language')
  return (
    <>
      {label}
      {label !== 'Language' && (
        <>
          {' '}
          <i lang="en" dir="ltr">
            (Language)
          </i>
        </>
      )}
    </>
  )
}
