import type { FindReplacePreviewResponse, SearchPageResponse, SqlMessage } from '@bettermyadmin/contracts'
import { Button, Input, Label, NativeCheckbox, NativeSelect, Panel, PanelBody } from '@bettermyadmin/ui'
import { type FormEvent, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { useFormLock } from '../../shell/page-chrome'
import { ResultMessages, errorMessage } from '../common/ResultMessages'
import { useSearchPage } from './SearchPage'
import { SearchPills } from './SearchPills'

/**
 * Find and replace in one Char-class column: a preview of the distinct values, then Replace.
 *
 * pma: resources/templates/table/find_replace/index.twig, replace_preview.twig,
 *      resources/js/table/find_replace.ts
 */
export function FindReplacePage({ scope }: { scope: TableRef }) {
  const q = useSearchPage(scope)
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  return (
    <div>
      <SearchPills scope={scope} active="find-replace" />
      <FindReplaceForm scope={scope} page={q.data} />
    </div>
  )
}

function FindReplaceForm({ scope, page }: { scope: TableRef; page: SearchPageResponse }) {
  // form.lock-page (AJAX.lockPageHandler)
  const lockRef = useFormLock()
  const [find, setFind] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [columnIndex, setColumnIndex] = useState(page.charColumns[0]?.index ?? 0)
  const [useRegex, setUseRegex] = useState(false)
  const [preview, setPreview] = useState<{
    req: Parameters<typeof api.tableFindReplace>[1]
    res: FindReplacePreviewResponse
  } | null>(null)
  const [shown, setShown] = useState(true)
  const [messages, setMessages] = useState<SqlMessage[]>([])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const req = { columnIndex, find, replaceWith, useRegex }
    try {
      setPreview({ req, res: await api.tableFindReplacePreview(scope, req) })
      setShown(false)
      setMessages([])
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }
  const replace = async (e: FormEvent) => {
    e.preventDefault()
    if (preview === null) return
    try {
      const r = await api.tableFindReplace(scope, preview.req)
      setMessages(r.messages)
      setPreview(null)
      setShown(true)
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }

  return (
    <>
      <ResultMessages messages={messages} />
      {preview !== null && (
        <div id="toggle_find_div" className="mb-2">
          <Button size="sm" id="toggle_find" onClick={() => setShown(!shown)}>
            {t(shown ? 'Hide find and replace criteria' : 'Show find and replace criteria')}
          </Button>
        </div>
      )}
      {shown && (
        <form ref={lockRef} id="find_replace_form" onSubmit={(e) => void submit(e)}>
          <Panel
            title={t('Find and replace')}
            footer=<Button type="submit" variant="primary">
              {t('Go')}
            </Button>
          >
            <PanelBody>
              <table className="w-auto text-sm">
                <tbody>
                  <tr>
                    <td className="px-2 py-1">
                      <Label htmlFor="findInput">{t('Find:')}</Label>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        id="findInput"
                        className="w-64"
                        name="find"
                        required
                        value={find}
                        onChange={(e) => setFind(e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Label htmlFor="replaceWithInput">{t('Replace with:')}</Label>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        id="replaceWithInput"
                        className="w-64"
                        name="replaceWith"
                        value={replaceWith}
                        onChange={(e) => setReplaceWith(e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Label htmlFor="columnIndexSelect">{t('Column:')}</Label>
                    </td>
                    <td className="px-2 py-1">
                      <NativeSelect
                        id="columnIndexSelect"
                        name="columnIndex"
                        value={columnIndex}
                        onChange={(e) => setColumnIndex(Number(e.target.value))}
                      >
                        {page.charColumns.map((c) => (
                          <option key={c.index} value={c.index}>
                            {c.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2">
                <NativeCheckbox
                  id="useRegexId"
                  name="useRegex"
                  checked={useRegex}
                  onChange={(e) => setUseRegex(e.target.checked)}
                />{' '}
                <Label htmlFor="useRegexId">{t('Use regular expression')}</Label>
              </div>
            </PanelBody>
          </Panel>
        </form>
      )}
      {preview !== null && (
        <form id="previewReplaceForm" className="mt-3" onSubmit={(e) => void replace(e)}>
          <Panel
            title={t('Find and replace - preview')}
            footer=<Button type="submit" variant="primary" id="buttonReplace">
              {t('Replace')}
            </Button>
          >
            <PanelBody>
              <table id="previewTable" className="w-auto text-sm" data-testid="replace-preview">
                <thead>
                  <tr className="text-left">
                    <th className="px-2">{t('Count')}</th>
                    <th className="px-2">{t('Original string')}</th>
                    <th className="px-2">{t('Replaced string')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.res.rows ?? []).map((r, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview rows
                    <tr key={i} className="odd:bg-grid-odd even:bg-grid-even">
                      <td className="px-2 text-right">{r.count}</td>
                      <td className="px-2">{r.original}</td>
                      <td className="px-2">{r.replaced}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanelBody>
          </Panel>
        </form>
      )}
    </>
  )
}
