import { showMessage } from '@bettermyadmin/ui'
import { useEffect } from 'react'
import { t } from '../../lib/i18n'

/**
 * "View output as text": the dump in a textarea with Back / Refresh / Copy to clipboard (top and
 * bottom); F5 refreshes instead of reloading the page.
 * pma: src/Export/Export.php::getHtmlForDisplayedExportHeader / ::getHtmlForDisplayedExportFooter,
 *      resources/js/export_output.ts
 */
export function ExportOutput({
  text,
  onBack,
  onRefresh,
}: {
  text: string
  onBack: () => void
  onRefresh: () => void
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        onRefresh()
      }
    }
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [onRefresh])
  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => showMessage(t('Successfully copied!')),
      () => showMessage(t('Copying failed!'), false),
    )
  }
  const links = (
    <>
      <p>
        [{' '}
        <button type="button" className="text-accent" onClick={onBack}>
          {t('Back')}
        </button>{' '}
        ]
      </p>
      <p>
        [{' '}
        <button type="button" className="disableAjax export_refresh_btn text-accent" onClick={onRefresh}>
          {t('Refresh')}
        </button>{' '}
        ]
      </p>
      <p className="mt-3">
        [{' '}
        <button type="button" className="export_copy_to_clipboard_btn disableAjax text-accent" onClick={copy}>
          {t('Copy to clipboard')}
        </button>{' '}
        ]
      </p>
    </>
  )
  return (
    <div className="my-3">
      {links}
      <form name="nofunction" className="my-3">
        <textarea
          name="sqldump"
          cols={50}
          rows={30}
          id="textSQLDUMP"
          wrap="off"
          readOnly
          value={text}
          className="h-[70vh] w-full font-mono text-[12px]"
        />
      </form>
      {links}
    </div>
  )
}
