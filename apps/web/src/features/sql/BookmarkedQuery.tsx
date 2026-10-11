import { useRef, useState } from 'react'
import { pmaDocUrl } from '../../lib/docs'
import { t } from '../../lib/i18n'
import type { BookmarkEntry } from '../bookmarks/provider'
import { DocIcon } from './SqlMessage'

export type BookmarkAction = 'submit' | 'view' | 'delete'

/**
 * The "Bookmarked SQL query" card of the SQL tab: bookmark, Submit / View only / Delete, variables.
 * pma: resources/templates/sql/query.twig (#id_bookmark), resources/js/sql.ts (#id_bookmark change)
 */
export function BookmarkedQuery({
  bookmarks,
  onGo,
}: {
  bookmarks: BookmarkEntry[]
  onGo: (b: BookmarkEntry, action: BookmarkAction, variables: Record<number, string>) => void
}) {
  const [id, setId] = useState('')
  const [action, setAction] = useState<BookmarkAction>('submit')
  const variables = useRef<Record<number, string>>({})
  const selected = bookmarks.find((b) => String(b.id) === id)
  const varCount = selected?.variableCount ?? 0
  const go = () => {
    if (selected !== undefined) onGo(selected, action, { ...variables.current })
  }
  return (
    <div className="mb-3 rounded border border-border" id="fieldsetBookmarkOptions">
      <div className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
        {t('Bookmarked SQL query')}
      </div>
      <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <label htmlFor="id_bookmark">{t('Bookmark:')}</label>
        <select
          id="id_bookmark"
          name="id_bookmark"
          className="input w-auto"
          value={id}
          onChange={(e) => {
            setId(e.target.value)
            variables.current = {}
          }}
        >
          <option value="">&nbsp;</option>
          {bookmarks.map((b) => (
            <option key={b.id} value={b.id} data-varcount={b.variableCount}>
              {b.label}
              {b.shared ? ` (${t('shared')})` : ''}
            </option>
          ))}
        </select>
        {(
          [
            ['submit', 'radio_bookmark_exe', t('Submit')],
            ['view', 'radio_bookmark_view', t('View only')],
            ['delete', 'radio_bookmark_del', t('Delete')],
          ] as const
        ).map(([value, htmlId, label]) => (
          <label key={value} className="flex items-center gap-1" htmlFor={htmlId}>
            <input
              type="radio"
              id={htmlId}
              name="action_bookmark"
              checked={action === value}
              onChange={() => setAction(value)}
            />
            {label}
          </label>
        ))}
      </div>
      {varCount > 0 && (
        <div className="px-3 pb-3 text-sm">
          <span className="mr-1">{t('Variables')}</span>
          <DocIcon href={pmaDocUrl('faq', 'faqbookmark')} target="documentation" />
          <div className="mt-1 flex flex-wrap gap-3" id="bookmarkVariables">
            {Array.from({ length: varCount }, (_, i) => i + 1).map((i) => (
              <div key={`${id}-${i}`} className="flex items-center gap-1">
                <label htmlFor={`bookmarkVariable${i}`}>
                  {/* Messages.strBookmarkVariable */}
                  {t('Variable %d:', i)}
                </label>
                <input
                  type="text"
                  size={10}
                  className="input w-28"
                  id={`bookmarkVariable${i}`}
                  name={`bookmark_variable[${i}]`}
                  onChange={(e) => {
                    variables.current[i] = e.target.value
                  }}
                  // Enter in a variable clicks this card's Go, not the main one
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      go()
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end border-t border-border bg-bg-subtle px-3 py-2">
        <button type="button" id="button_submit_bookmark" className="btn" onClick={go}>
          {t('Go')}
        </button>
      </div>
    </div>
  )
}
