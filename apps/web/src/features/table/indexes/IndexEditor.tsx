import type { DdlResponse, IndexFormResponse } from '@bettermyadmin/contracts'
import { Button, Hint, Modal, MySqlDocLink, PreviewSqlDialog, showMessage } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { GripVertical } from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'

/**
 * Add / edit index dialog and the rename dialog.
 *
 * pma: resources/templates/table/index_form.twig, index_rename_form.twig,
 *      resources/js/modules/indexes.ts (checkIndexName, checkIndexType), functions.ts::indexEditorDialog
 */
export type EditorIndex = IndexFormResponse['index']

/** IndexesController `create_edit_table`: the columns of the create/add form (`columns` JSON) */
export interface FormTarget {
  name: string
  type: string
  colIndex: number
}

/** the form's live actions: the modal's buttons drive it */
export interface EditorActions {
  go: () => void
  preview: () => void
  /** the index as the form holds it (indexes.ts::addColumnToIndex reads the inputs) */
  value: () => EditorIndex
}

const SPATIAL_TYPES = [
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geomtrycollection',
]

/** index_form.twig: FULLTEXT lists char/text columns, SPATIAL the spatial types */
export function columnAllowed(choice: string, type: string): boolean {
  if (choice === 'FULLTEXT' && !/(char|text)/i.test(type)) return false
  if (choice === 'SPATIAL' && !SPATIAL_TYPES.includes(type)) return false
  return true
}

export function IndexEditorForm({
  scope,
  form,
  onDone,
  onCancel,
  actions,
  targets,
}: {
  scope: TableRef
  form: IndexFormResponse
  onDone: (r: DdlResponse) => void
  onCancel?: () => void
  /**
   * In #indexDialogModal the form's card-footer is removed and the modal's own Go / Preview SQL
   * buttons drive it (functions.ts::indexDialogModal); the preview then has "Go back".
   */
  actions?: { current: EditorActions | null }
  /**
   * create_edit_table (the create table / add columns form): the column selects list these
   * columns by their form index, Index choice is disabled and the form has no footer.
   */
  targets?: FormTarget[]
}) {
  const [index, setIndex] = useState<EditorIndex>(form.index)
  const [addN, setAddN] = useState(1)
  // the index name gets the focus when it is empty (showIndexEditDialog)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (nameRef.current !== null && nameRef.current.value === '') nameRef.current.focus()
  }, [])
  const [advanced, setAdvanced] = useState(form.sliders === 'open')
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => setIndex(form.index), [form])

  // checkIndexName: PRIMARY forces the name; a non-primary named PRIMARY is cleared
  const setChoice = (choice: EditorIndex['choice']) =>
    setIndex({
      ...index,
      choice,
      name: choice === 'PRIMARY' ? 'PRIMARY' : index.name === 'PRIMARY' ? '' : index.name,
    })
  const setCol = (i: number, patch: Partial<EditorIndex['columns'][number]>) =>
    setIndex({ ...index, columns: index.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const move = (i: number, d: number) => {
    const cols = [...index.columns]
    const [c] = cols.splice(i, 1)
    if (c === undefined) return
    cols.splice(Math.max(0, Math.min(cols.length, i + d)), 0, c)
    setIndex({ ...index, columns: cols })
  }

  const submit = async (dryRun: boolean) => {
    try {
      const r = await api.saveIndex(scope, { oldIndex: form.oldIndex, index, dryRun })
      if (dryRun) setPreview(r.preview ?? '')
      else onDone(r)
    } catch (e) {
      // indexEditorDialog / indexRenameDialog: ajaxShowMessage(data.error, false), the dialog stays
      showMessage(errorMessage(e).text, false, 'error')
    }
  }

  if (actions !== undefined)
    actions.current = { go: () => void submit(false), preview: () => void submit(true), value: () => index }
  const spatial = index.choice === 'SPATIAL'
  return (
    <form
      id="index_frm"
      onSubmit={(e) => {
        e.preventDefault()
        if (targets === undefined) void submit(false)
      }}
      className="text-sm"
    >
      <div className="index_info mb-2 flex flex-wrap gap-4">
        <div className="flex flex-col">
          <strong>
            <label htmlFor="input_index_name">
              {t('Index name:')}{' '}
              <Hint message={t('"PRIMARY" <b>must</b> be the name of and <b>only of</b> a primary key!')} />
            </label>
          </strong>
          <input
            ref={nameRef}
            type="text"
            name="index[Key_name]"
            id="input_index_name"
            className="input w-56"
            size={25}
            maxLength={64}
            value={index.name}
            disabled={index.choice === 'PRIMARY'}
            onChange={(e) => setIndex({ ...index, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col">
          <strong>
            <label htmlFor="select_index_choice">
              {t('Index choice:')} <MySqlDocLink link="alter-table" />
            </label>
          </strong>
          <select
            name="index[Index_choice]"
            id="select_index_choice"
            className="input"
            value={index.choice}
            disabled={targets !== undefined}
            onChange={(e) => setChoice(e.target.value as EditorIndex['choice'])}
          >
            {form.primaryAllowed && <option value="PRIMARY">PRIMARY</option>}
            <option value="INDEX">INDEX</option>
            <option value="UNIQUE">UNIQUE</option>
            <option value="SPATIAL">SPATIAL</option>
            <option value="FULLTEXT">FULLTEXT</option>
          </select>
        </div>
      </div>
      {form.sliders !== 'disabled' && (
        <Button className="mb-2" size="sm" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {t('Advanced options')}
        </Button>
      )}
      {(advanced || form.sliders === 'disabled') && (
        <div id="advancedOptions" className="mb-2 grid max-w-xl grid-cols-2 gap-2">
          <div className="flex flex-col">
            <strong>
              <label htmlFor="input_key_block_size">{t('Key block size:')}</label>
            </strong>
            <input
              type="text"
              name="index[Key_block_size]"
              id="input_key_block_size"
              className="input"
              size={30}
              value={index.keyBlockSize}
              onChange={(e) => setIndex({ ...index, keyBlockSize: e.target.value })}
            />
          </div>
          <div className="flex flex-col">
            <strong>
              <label htmlFor="select_index_type">
                {t('Index type:')} <MySqlDocLink link="alter-table" />
              </label>
            </strong>
            <select
              name="index[Index_type]"
              id="select_index_type"
              className="input"
              value={index.type}
              disabled={spatial || index.choice === 'FULLTEXT'}
              onChange={(e) => setIndex({ ...index, type: e.target.value })}
            >
              {['', 'BTREE', 'HASH'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <strong>
              {/* the template's label points at input_parser, the field is input_parse */}
              <label htmlFor="input_parse">{t('Parser:')}</label>
            </strong>
            <input
              type="text"
              name="index[Parser]"
              id="input_parse"
              className="input"
              size={30}
              value={index.parser}
              onChange={(e) => setIndex({ ...index, parser: e.target.value })}
            />
          </div>
          <div className="flex flex-col">
            <strong>
              <label htmlFor="input_index_comment">{t('Comment:')}</label>
            </strong>
            <input
              type="text"
              name="index[Index_comment]"
              id="input_index_comment"
              className="input"
              size={30}
              maxLength={1024}
              value={index.comment}
              onChange={(e) => setIndex({ ...index, comment: e.target.value })}
            />
          </div>
        </div>
      )}
      <table id="index_columns" className="w-full">
        <thead>
          <tr className="text-left">
            <th />
            <th>{t('Column')}</th>
            {!spatial && <th>{t('Size')}</th>}
            <th>{t('Collation')}</th>
          </tr>
        </thead>
        <tbody>
          {index.columns.map((c, i) => (
            // showIndexEditDialog: `#index_columns tbody` is jQuery-UI sortable (axis y); the first
            // cell is the drag handle
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: positional index parts
              key={i}
              data-testid={`index-column-${i}`}
              className={dragOver === i && dragFrom !== null && dragFrom !== i ? 'bg-bg-subtle' : undefined}
              onDragOver={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                setDragOver(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragFrom !== null && dragFrom !== i) move(dragFrom, i - dragFrom)
                setDragFrom(null)
                setDragOver(null)
              }}
            >
              <td className="whitespace-nowrap">
                <span
                  className="drag_icon inline-flex cursor-move text-fg-muted"
                  title={t('Drag to reorder')}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = 'move'
                    const tr = e.currentTarget.closest('tr')
                    if (tr !== null) e.dataTransfer.setDragImage(tr, 0, 0)
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                >
                  <GripVertical className="size-4" aria-hidden />
                </span>
              </td>
              <td>
                <select
                  name="index[columns][names][]"
                  className="input"
                  aria-label={t('Column')}
                  value={c.name}
                  disabled={spatial && i > 0}
                  onChange={(e) => {
                    setCol(i, { name: e.target.value })
                    focusSize(e)
                  }}
                >
                  <option value="">-- {t('Ignore')} --</option>
                  {targets !== undefined
                    ? // the add_fields rows list every posted column, valued by its form index
                      targets.map((f) => (
                        <option key={f.colIndex} value={String(f.colIndex)}>
                          {f.name} [{f.type}]
                        </option>
                      ))
                    : form.fields
                        .filter(([, type]) => columnAllowed(index.choice, type))
                        .map(([name, type]) => (
                          <option key={name} value={name}>
                            {name} [{type}]
                          </option>
                        ))}
                </select>
              </td>
              {!spatial && (
                <td>
                  <input
                    type="text"
                    size={5}
                    name="index[columns][sub_parts][]"
                    className="input w-16"
                    aria-label={t('Size')}
                    value={c.subPart}
                    onChange={(e) => setCol(i, { subPart: e.target.value })}
                  />
                </td>
              )}
              <td>
                <select
                  name="index[columns][collations][]"
                  className="input"
                  aria-label={t('Collation')}
                  value={c.collation}
                  onChange={(e) => {
                    setCol(i, { collation: e.target.value })
                    focusSize(e)
                  }}
                >
                  <option value="">{t('None')}</option>
                  <option value="A" title="ASC">
                    A
                  </option>
                  <option value="D" title="DESC">
                    D
                  </option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!spatial && (
        <div className="add_more mt-2 flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={16}
            value={addN}
            aria-label={t('Add %s column(s) to index', addN)}
            onChange={(e) => setAddN(Number(e.target.value))}
          />
          {/* showIndexEditDialog shows div.add_fields once the slider is set up */}
          <Button
            id="add_fields"
            onClick={() =>
              setIndex({
                ...index,
                columns: [
                  ...index.columns,
                  ...Array.from({ length: addN }, () => ({ name: '', subPart: '', collation: '' })),
                ],
              })
            }
          >
            {t('Add %s column(s) to index', addN)}
          </Button>
        </div>
      )}
      {actions === undefined && targets === undefined && (
        <div className="mt-3 flex justify-end gap-2">
          <Button type="submit" variant="primary">
            {t('Go')}
          </Button>
          <Button id="preview_index_frm" onClick={() => void submit(true)}>
            {t('Preview SQL')}
          </Button>
          {onCancel !== undefined && <Button onClick={onCancel}>{t('Close')}</Button>}
        </div>
      )}
      <PreviewSqlDialog
        highlight
        sql={preview}
        onClose={() => setPreview(null)}
        {...(actions !== undefined ? { onBack: () => setPreview(null) } : {})}
      />
    </form>
  )
}

/** #indexDialogModal: "Add index" / "Edit index" */
export function IndexDialog({
  scope,
  query,
  onClose,
  onDone,
  title,
}: {
  scope: TableRef
  query: { index?: string; create?: number; primary?: boolean } | null
  onClose: () => void
  onDone: (r: DdlResponse) => void
  /** the dialog title (normalization: "Add primary key") */
  title?: string
}) {
  const form = useQuery({
    queryKey: qk.indexForm(scope, query),
    queryFn: () => api.indexForm(scope, query ?? {}),
    enabled: query !== null,
    gcTime: 0,
  })
  const actions = useRef<EditorActions | null>(null)
  return (
    <Modal
      id="indexDialogModal"
      title={title ?? (query?.index !== undefined ? t('Edit index') : t('Add index'))}
      open={query !== null}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button id="indexDialogModalGoButton" variant="primary" onClick={() => actions.current?.go()}>
            {t('Go')}
          </Button>
          <Button onClick={() => actions.current?.preview()}>{t('Preview SQL')}</Button>
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      {form.data !== undefined && (
        <IndexEditorForm
          scope={scope}
          form={form.data}
          onDone={onDone}
          onCancel={onClose}
          actions={actions}
        />
      )}
    </Modal>
  )
}

/** checkIndexName runs on the rename form too (no index choice there): a PRIMARY name is cleared */
const initialName = (i: string | null) => (i === null || i === 'PRIMARY' ? '' : i)

/** #indexDialogModal with index_rename_form.twig */
export function RenameIndexDialog({
  scope,
  index,
  onClose,
  onDone,
}: { scope: TableRef; index: string | null; onClose: () => void; onDone: (r: DdlResponse) => void }) {
  const [name, setName] = useState(initialName(index))
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => setName(initialName(index)), [index])
  const submit = async (dryRun: boolean) => {
    if (index === null) return
    try {
      const r = await api.renameIndex(scope, { oldIndex: index, name, dryRun })
      if (dryRun) setPreview(r.preview ?? '')
      else onDone(r)
    } catch (e) {
      // indexEditorDialog / indexRenameDialog: ajaxShowMessage(data.error, false), the dialog stays
      showMessage(errorMessage(e).text, false, 'error')
    }
  }
  return (
    <Modal
      id="indexDialogModal"
      title={t('Rename index')}
      open={index !== null}
      onClose={onClose}
      footer={
        <>
          <Button id="indexDialogModalGoButton" variant="primary" onClick={() => void submit(false)}>
            {t('Go')}
          </Button>
          <Button onClick={() => void submit(true)}>{t('Preview SQL')}</Button>
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      <form
        id="index_frm"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
      >
        <label className="flex flex-col text-sm" htmlFor="input_index_name">
          <strong>{t('Index name:')}</strong>
        </label>
        <input
          id="input_index_name"
          name="index"
          className="input"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
      <PreviewSqlDialog
        highlight
        sql={preview}
        onClose={() => setPreview(null)}
        onBack={() => setPreview(null)}
      />
    </Modal>
  )
}

/**
 * A value picked in an index column row focuses its Size input (tempSetFocus).
 * pma: resources/js/modules/functions.ts::showIndexEditDialog (table#index_columns select change)
 */
function focusSize(e: ChangeEvent<HTMLSelectElement>) {
  if (e.currentTarget.value === '') return
  e.currentTarget.closest('tr')?.querySelector('input')?.focus()
}
