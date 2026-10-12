import { Button, Input, Label, Modal, NativeSelect, Radio, showMessage } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type DbRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { PluginOptions } from '../../export/PluginOptions'
import { offlinePageList } from './offlineDb'

/**
 * The Designer's modals: `#designerGoModal` (Go / Cancel) with the page, schema export and add
 * table forms, and `#designerPromptModal` (Yes / No / Cancel).
 * pma: resources/templates/database/designer/main.twig (modals), edit_delete_pages.twig,
 *      page_save_as.twig, page_selector.twig, schema_export.twig, resources/js/designer/move.ts
 */

/** displayModal(form, heading, '#designerGoModal') */
export function GoModal({
  title,
  onGo,
  onClose,
  children,
}: {
  title: string
  onGo: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Modal
      id="designerGoModal"
      title={title}
      open
      onClose={onClose}
      closeLabel={t('Cancel')}
      size="md"
      footer={
        <>
          <Button id="designerModalGoButton" onClick={onGo}>
            {t('Go')}
          </Button>
          <Button onClick={onClose}>{t('Cancel')}</Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

/** promptToSaveCurrentPage: "Do you want to save the changes to the current page?" */
export function PromptModal({
  onYes,
  onNo,
  onClose,
}: {
  onYes: () => void
  onNo: () => void
  onClose: () => void
}) {
  return (
    <Modal
      id="designerPromptModal"
      title={t('Save page')}
      open
      onClose={onClose}
      closeLabel={t('Cancel')}
      size="md"
      footer={
        <>
          <Button id="designerModalYesButton" onClick={onYes}>
            {t('Yes')}
          </Button>
          <Button id="designerModalNoButton" onClick={onNo}>
            {t('No')}
          </Button>
          <Button onClick={onClose}>{t('Cancel')}</Button>
        </>
      }
    >
      <div>{t('Do you want to save the changes to the current page?')}</div>
    </Modal>
  )
}

function usePages(r: DbRef) {
  return useQuery({ queryKey: qk.dbPage(r, 'designer-pages'), queryFn: () => api.designerPages(r) })
}

/** page_selector.twig, plus the IndexedDB pages (DesignerPage.createPageList) without pdf pages */
function PageSelector({
  r,
  offline,
  value,
  onChange,
}: {
  r: DbRef
  offline: boolean
  value: string
  onChange: (v: string, text: string) => void
}) {
  const pages = usePages(r)
  const [local, setLocal] = useState<Array<{ id: number; name: string }>>([])
  useEffect(() => {
    if (offline) offlinePageList(r.db).then(setLocal, () => setLocal([]))
  }, [offline, r.db])
  return (
    <NativeSelect
      name="selected_page"
      id="selected_page"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value, e.currentTarget.selectedOptions[0]?.text ?? '')}
      className="w-auto"
    >
      <option value="0">-- {t('Select page')} --</option>
      {pages.data?.pdfwork === true &&
        pages.data.pages.map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.name}
          </option>
        ))}
      {local.map((p) => (
        <option key={`local-${p.id}`} value={String(p.id)}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  )
}

/** dialog=edit|delete: edit_delete_pages.twig; Go checks a page is selected */
export function EditDeletePagesModal({
  r,
  offline,
  operation,
  onGo,
  onClose,
}: {
  r: DbRef
  offline: boolean
  operation: 'editPage' | 'deletePage'
  onGo: (page: string) => void
  onClose: () => void
}) {
  const [page, setPage] = useState('0')
  return (
    <GoModal
      title={operation === 'editPage' ? t('Open page') : t('Delete page')}
      onClose={onClose}
      onGo={() => {
        if (page === '0') {
          showMessage(t('Please select a page to continue'), 2000)
          return
        }
        onGo(page)
      }}
    >
      <form id="edit_delete_pages" name="edit_delete_pages" onSubmit={(e) => e.preventDefault()}>
        <Label htmlFor="selected_page" className="me-2">
          {operation === 'editPage' ? t('Page to open') : t('Page to delete')}:
        </Label>
        <PageSelector r={r} offline={offline} value={page} onChange={(v) => setPage(v)} />
      </form>
    </GoModal>
  )
}

/** dialog=save_as: page_save_as.twig (save_page same | new) */
export function SaveAsModal({
  r,
  offline,
  selectedPage,
  onGo,
  onClose,
}: {
  r: DbRef
  offline: boolean
  selectedPage: number
  onGo: (v: { choice: 'same' | 'new'; page: string; name: string }) => void
  onClose: () => void
}) {
  // select current page by default
  const [page, setPage] = useState(selectedPage !== -1 ? String(selectedPage) : '0')
  const [pageText, setPageText] = useState('')
  const [choice, setChoice] = useState<'same' | 'new'>('same')
  const [value, setValue] = useState('')
  const pages = usePages(r)
  const submit = () => {
    if (choice === 'same') {
      if (page === '0') {
        showMessage(t('Please select a page to continue'), 2000)
        return
      }
      const text =
        pageText !== '' ? pageText : (pages.data?.pages.find((p) => String(p.id) === page)?.name ?? '')
      onGo({ choice, page, name: text })
      return
    }
    if (value.trim() === '') {
      showMessage(t('Please enter a valid page name'), 2000)
      return
    }
    onGo({ choice, page, name: value.trim() })
  }
  return (
    <GoModal title={t('Save page as')} onClose={onClose} onGo={submit}>
      <form
        id="save_as_pages"
        name="save_as_pages"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <table className="w-full">
          <tbody>
            <tr>
              <td className="py-1">
                <PageSelector
                  r={r}
                  offline={offline}
                  value={page}
                  onChange={(v, text) => {
                    setPage(v)
                    setPageText(text)
                  }}
                />
              </td>
            </tr>
            <tr>
              <td className="py-1">
                <div className="flex items-center gap-2">
                  <Radio
                    name="save_page"
                    id="savePageSameRadio"
                    value="same"
                    checked={choice === 'same'}
                    onChange={() => setChoice('same')}
                  />
                  <Label htmlFor="savePageSameRadio">{t('Save to selected page')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Radio
                    name="save_page"
                    id="savePageNewRadio"
                    value="new"
                    checked={choice === 'new'}
                    onChange={() => setChoice('new')}
                  />
                  <Label htmlFor="savePageNewRadio">{t('Create a page and save to it')}</Label>
                </div>
              </td>
            </tr>
            <tr>
              <td className="py-1">
                <Label htmlFor="selected_value" className="me-2">
                  {t('New page name')}
                </Label>
                <Input
                  type="text"
                  name="selected_value"
                  id="selected_value"
                  className="inline-block w-auto"
                  value={value}
                  // pma: init.ts — a click in the name field picks "Create a page and save to it"
                  onClick={() => setChoice('new')}
                  onChange={(e) => setValue(e.currentTarget.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </form>
    </GoModal>
  )
}

/** save3 on an unsaved page: the "Page name" form (save_page=new) */
export function SavePageModal({ onGo, onClose }: { onGo: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('')
  const submit = () => {
    if (value.trim() === '') {
      showMessage(t('Please enter a valid page name'), false)
      return
    }
    onGo(value.trim())
  }
  return (
    <GoModal title={t('Save page')} onClose={onClose} onGo={submit}>
      <form
        id="save_page"
        name="save_page"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Label htmlFor="selected_value">{t('Page name')}</Label>:
        <Input
          type="text"
          name="selected_value"
          className="ms-1 inline-block w-auto"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
      </form>
    </GoModal>
  )
}

/** dialog=export: schema_export.twig; Go posts the form to /schema-export (download) */
export function ExportSchemaModal({
  r,
  page,
  onGo,
  onClose,
}: {
  r: DbRef
  page: number
  onGo: (exportType: string, options: Record<string, string>) => void
  onClose: () => void
}) {
  const form = useRef<HTMLFormElement>(null)
  const q = useQuery({
    queryKey: qk.dbPage(r, 'designer-export', { page }),
    queryFn: () => api.designerExportForm(r, page),
  })
  const [format, setFormat] = useState<string | null>(null)
  const current = format ?? q.data?.choice ?? ''
  const none = new Set<string>()
  return (
    <GoModal
      title={t('Export relational schema')}
      onClose={onClose}
      onGo={() => {
        if (form.current === null) return
        const options: Record<string, string> = {}
        for (const [k, v] of new FormData(form.current).entries()) {
          if (typeof v !== 'string' || k === 'export_type') continue
          // only the chosen format's options are read by its plugin
          if (k.startsWith(`${current}_`)) options[k] = v
        }
        onGo(current, options)
      }}
    >
      {q.data !== undefined && (
        <form ref={form} id="id_export_pages" onSubmit={(e) => e.preventDefault()}>
          <input type="hidden" name="page_number" value={String(q.data.page)} />
          <div className="mb-3">
            <Label className="form-label block" htmlFor="plugins">
              {t('Select export relational type:')}
            </Label>
            <NativeSelect
              id="plugins"
              name="export_type"
              value={current}
              onChange={(e) => setFormat(e.currentTarget.value)}
              className="w-auto"
            >
              {q.data.plugins.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.text}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            {q.data.plugins.map((p) => (
              <PluginOptions
                key={p.name}
                plugin={p}
                hidden={p.name !== current}
                disabled={none}
                onChange={() => undefined}
                sectionsHidden={none}
                forcedOn={none}
              />
            ))}
          </div>
        </form>
      )}
    </GoModal>
  )
}

/** addOtherDbTables: two lists (databases, then the chosen database's tables) */
export function AddTablesModal({
  server,
  onGo,
  onClose,
}: {
  server: number
  onGo: (db: string, table: string) => void
  onClose: () => void
}) {
  const [db, setDb] = useState('')
  const [table, setTable] = useState('')
  // pma: `SHOW databases;` / `SHOW tables;` through /sql
  const dbs = useQuery({
    queryKey: qk.exportAliasNames(server, '', ''),
    queryFn: () => api.exportAliasNames(server, '', ''),
  })
  const tables = useQuery({
    queryKey: qk.exportAliasNames(server, db, ''),
    queryFn: () => api.exportAliasNames(server, db, ''),
    enabled: db !== '',
  })
  // the list shows the database's tables from the first one on (no "None" entry)
  // MySQL's SHOW DATABASES / SHOW TABLES order (binary), not the navigation's natural order
  const names = db === '' ? [] : [...(tables.data?.names ?? [])].sort()
  const current = table !== '' ? table : (names[0] ?? '')
  return (
    <GoModal title={t('Add tables from other databases')} onClose={onClose} onGo={() => onGo(db, current)}>
      <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
        <NativeSelect
          id="add_table_from"
          aria-label={t('Database')}
          value={db}
          onChange={(e) => {
            setDb(e.currentTarget.value)
            setTable('')
          }}
          className="w-auto"
        >
          <option value="">{t('None')}</option>
          {[...(dbs.data?.names ?? [])].sort().map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          id="add_table"
          aria-label={t('Table')}
          value={current}
          onChange={(e) => setTable(e.currentTarget.value)}
          className="w-auto"
        >
          {names.length === 0 && <option value="">{t('None')}</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </form>
    </GoModal>
  )
}
