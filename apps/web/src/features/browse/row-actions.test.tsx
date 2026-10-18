import { UiSettingsProvider, defaultUiSettings } from '@bettermyadmin/ui'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionLink } from './GridTable.tsx'

/**
 * The content of the Edit / Copy / Delete row links (Results::getActionLinkContent): RowActionType
 * `icons` is the image alone, `text` the text alone, anything else Generator::getIcon, which
 * follows ActionLinksMode. RowActionType is a server directive (no user preference), so its two
 * modes are rendered here; the default is compared with phpMyAdmin in tests/e2e/browse-checklist.
 */
function content(rowActionType: string, actionLinksMode: 'icons' | 'text' | 'both' = 'both') {
  const html = renderToStaticMarkup(
    <UiSettingsProvider value={{ ...defaultUiSettings, ActionLinksMode: actionLinksMode }}>
      <ActionLink mode={rowActionType} icon="b_edit" text="Edit" />
    </UiSettingsProvider>,
  )
  return {
    icon: /<svg[^>]*\bic_b_edit\b/.test(html),
    // the text next to the icon (an icon's <title> is its alt text)
    text: html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ''),
    alt: /<title>Edit<\/title>/.test(html),
  }
}

describe('row action links per RowActionType [p02-71812e]', () => {
  it('icons: the image with the text as its alt', () => {
    expect(content('icons')).toEqual({ icon: true, text: '', alt: true })
  })
  it('text: the text alone', () => {
    expect(content('text')).toEqual({ icon: false, text: 'Edit', alt: false })
  })
  it('both: Generator::getIcon, so ActionLinksMode decides', () => {
    expect(content('both')).toEqual({ icon: true, text: 'Edit', alt: false })
    expect(content('both', 'icons')).toEqual({ icon: true, text: '', alt: true })
    expect(content('both', 'text')).toEqual({ icon: false, text: 'Edit', alt: false })
  })
})
