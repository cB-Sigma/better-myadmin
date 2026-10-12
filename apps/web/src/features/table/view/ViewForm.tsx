import type { SqlMessage, ViewData, ViewFormResponse } from '@bettermyadmin/contracts'
import { Button, Input, Modal, NativeCheckbox, NativeSelect, Panel } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { SqlEditor } from '../../sql/editor/SqlEditor'
import type { SqlEditorHandle } from '../../sql/editor/types'
import { ResultMessages } from '../common/ResultMessages'
import { setFlash } from '../structure/flash'

/**
 * The view form: the Create view page (navigation "New"), the Edit view page (table and database
 * Structure) and the Create view dialog of the query results.
 *
 * pma: resources/templates/view_create.twig, resources/templates/modals/create_view.twig,
 *      resources/js/modules/functions/handleCreateViewModal.ts, functions.ts::onloadCreateView
 */

type Scope = { server: number; db: string }

function useViewForm(scope: Scope, q: { table?: string | undefined; sql?: string | undefined }) {
  return useQuery({
    queryKey: qk.dbPage(scope, 'view-form', q),
    queryFn: () => api.viewForm(scope, q),
  })
}

/** the posted values: a select without a matching option posts its first one */
function initial(form: ViewFormResponse): ViewData {
  const v = form.view
  return {
    ...v,
    algorithm: form.algorithmOptions.includes(v.algorithm) ? v.algorithm : (form.algorithmOptions[0] ?? ''),
    sqlSecurity: form.securityOptions.includes(v.sqlSecurity) ? v.sqlSecurity : '',
    with: form.withOptions.includes(v.with) ? v.with : '',
  }
}

/** view_create.twig's table of options */
function ViewFields({
  scope,
  form,
  view,
  set,
  editor,
}: {
  scope: Scope
  form: ViewFormResponse
  view: ViewData
  set: (patch: Partial<ViewData>) => void
  editor: React.RefObject<SqlEditorHandle | null>
}) {
  const create = form.operation === 'create'
  const row = (label: ReactNode, control: ReactNode, htmlFor?: string) => (
    <tr>
      <td className="whitespace-nowrap py-1 pe-3 align-middle">
        {htmlFor === undefined ? label : <label htmlFor={htmlFor}>{label}</label>}
      </td>
      <td className="w-full py-1">{control}</td>
    </tr>
  )
  return (
    <table className="rte_table w-full text-sm">
      <tbody>
        {create &&
          row(
            'OR REPLACE',
            <NativeCheckbox
              name="view[or_replace]"
              id="or_replace"
              checked={view.orReplace}
              onChange={(e) => set({ orReplace: e.target.checked })}
            />,
            'or_replace',
          )}
        {row(
          'ALGORITHM',
          <NativeSelect
            name="view[algorithm]"
            id="algorithm"
            value={view.algorithm}
            onChange={(e) => set({ algorithm: e.target.value })}
          >
            {form.algorithmOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>,
          'algorithm',
        )}
        {row(
          t('Definer'),
          <Input
            name="view[definer]"
            aria-label={t('Definer')}
            maxLength={100}
            size={50}
            className="w-auto"
            value={view.definer}
            onChange={(e) => set({ definer: e.target.value })}
          />,
        )}
        {row(
          'SQL SECURITY',
          <NativeSelect
            name="view[sql_security]"
            aria-label="SQL SECURITY"
            value={view.sqlSecurity}
            onChange={(e) => set({ sqlSecurity: e.target.value })}
          >
            <option value="" />
            {form.securityOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>,
        )}
        {create &&
          row(
            t('VIEW name'),
            <Input
              name="view[name]"
              aria-label={t('VIEW name')}
              size={20}
              maxLength={64}
              className="w-auto"
              onFocus={(e) => e.target.select()}
              value={view.name}
              onChange={(e) => set({ name: e.target.value })}
            />,
          )}
        {row(
          t('Column names'),
          <Input
            name="view[column_names]"
            aria-label={t('Column names')}
            maxLength={100}
            size={50}
            className="w-auto"
            onFocus={(e) => e.target.select()}
            value={view.columnNames}
            onChange={(e) => set({ columnNames: e.target.value })}
          />,
        )}
        {row(
          'AS',
          <>
            <SqlEditor
              handleRef={editor}
              id="view_as"
              ariaLabel="AS"
              initialValue={view.as}
              rows={15}
              cols={40}
              codemirror={form.codemirror}
              lint={null}
              autocomplete={null}
              onChange={(v) => set({ as: v })}
            />
            <Button
              variant="secondary"
              id="format"
              className="sqlbutton mt-1"
              onClick={() =>
                void api.sqlFormat(scope.server, editor.current?.getValue() ?? view.as, false).then((f) => {
                  editor.current?.setValue(f.sql)
                  set({ as: f.sql })
                })
              }
            >
              Format
            </Button>
          </>,
        )}
        {row(
          'WITH CHECK OPTION',
          <NativeSelect
            name="view[with]"
            aria-label="WITH CHECK OPTION"
            value={view.with}
            onChange={(e) => set({ with: e.target.value })}
          >
            <option value="" />
            {form.withOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>,
        )}
      </tbody>
    </table>
  )
}

/** the form state, the save and its messages */
function useViewSave(scope: Scope, form: ViewFormResponse | undefined) {
  const qc = useQueryClient()
  const [view, setView] = useState<ViewData | null>(null)
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const editor = useRef<SqlEditorHandle>(null)
  const current = view ?? (form === undefined ? null : initial(form))
  const set = (patch: Partial<ViewData>) => {
    if (current !== null) setView({ ...current, ...patch })
  }
  const save = async (): Promise<SqlMessage[] | null> => {
    if (form === undefined || current === null) return null
    try {
      const as = editor.current?.getValue() ?? current.as
      const r = await api.viewSave(scope, { operation: form.operation, view: { ...current, as } })
      setMessages(r.messages)
      if (!r.ok) return null
      await qc.invalidateQueries({ queryKey: qk.nav(scope.server) })
      return r.messages
    } catch (e) {
      setMessages([errorMessage(e)])
      return null
    }
  }
  return { view: current, set, save, messages, editor }
}

/** /view/create (Create view, or Edit view with `table`) */
export function ViewCreatePage({ server, db, table, sql }: Scope & { table?: string; sql?: string }) {
  const scope = { server, db }
  const q = useViewForm(scope, { table, sql })
  const s = useViewSave(scope, q.data)
  const navigate = useNavigate()
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined || s.view === null) return null
  const form = q.data
  const view = s.view
  return (
    <div id="div_view_options" className="my-3">
      <ResultMessages messages={s.messages} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void s.save().then((done) => {
            if (done === null) return
            // the success answer is the view's Structure page with the message
            setFlash(done)
            void navigate({
              to: '/s/$server/db/$db/t/$table/structure',
              params: { server, db, table: view.name },
            })
          })
        }}
      >
        <Panel
          title={form.operation === 'create' ? t('Create view') : t('Edit view')}
          footer={
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t('Go')}
              </Button>
            </div>
          }
        >
          <ViewFields scope={scope} form={form} view={view} set={s.set} editor={s.editor} />
        </Panel>
      </form>
    </div>
  )
}

/** the query results' "Create view" (modals/create_view.twig with the form's "Details" card) */
export function CreateViewDialog({
  server,
  db,
  sql,
  onClose,
  onDone,
}: Scope & { sql: string; onClose: () => void; onDone: (messages: SqlMessage[]) => void }) {
  const scope = { server, db }
  const q = useViewForm(scope, { sql })
  const s = useViewSave(scope, q.data)
  return (
    <Modal
      open
      onClose={onClose}
      id="createViewModal"
      title={t('Create view')}
      footer={
        <>
          <Button
            variant="secondary"
            id="createViewModalGoButton"
            disabled={q.data === undefined}
            onClick={() =>
              void s.save().then((done) => {
                if (done !== null) onDone(done)
              })
            }
          >
            {t('Go')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <ResultMessages messages={s.messages.filter((m) => m.type !== 'success')} />
      {q.isError && <ResultMessages messages={[errorMessage(q.error)]} />}
      {q.data !== undefined && s.view !== null && (
        <div id="div_view_options">
          <Panel title={t('Details')}>
            <ViewFields scope={scope} form={q.data} view={s.view} set={s.set} editor={s.editor} />
          </Panel>
        </div>
      )}
    </Modal>
  )
}
