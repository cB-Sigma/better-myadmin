import type { DdlResponse, IndexFormResponse } from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal, MySqlDocLink, PreviewSqlDialog } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'

/**
 * Add / edit index dialog and the rename dialog.
 *
 * pma: resources/templates/table/index_form.twig, index_rename_form.twig,
 *      resources/js/modules/indexes.ts (checkIndexName, checkIndexType), functions.ts::indexEditorDialog
 */
type EditorIndex = IndexFormResponse['index']

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
}: {
  scope: TableRef
  form: IndexFormResponse
  onDone: (r: DdlResponse) => void
  onCancel?: () => void
}) {
  const [index, setIndex] = useState<EditorIndex>(form.index)
  const [addN, setAddN] = useState(1)
  const [advanced, setAdvanced] = useState(form.sliders === 'open')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null)
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
  const move = (i: number, d: number) => {
    const cols = [...index.columns]
    const [c] = cols.splice(i, 1)
    if (c === undefined) return
    cols.splice(Math.max(0, Math.min(cols.length, i + d)), 0, c)
    setIndex({ ...index, columns: cols })
  }

  const submit = async (dryRun: boolean) => {
    setError(null)
    try {
      const r = await api.saveIndex(scope, { oldIndex: form.oldIndex, index, dryRun })
      if (dryRun) setPreview(r.preview ?? '')
      else onDone(r)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const spatial = index.choice === 'SPATIAL'
  return (
    <form
      id="index_frm"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
      className="text-sm"
    >
      <div className="mb-2 flex flex-wrap gap-4">
        <label className="flex flex-col">
          <strong>
            {t('Index name:')}{' '}
            <span
              title={t('"PRIMARY" <b>must</b> be the name of and <b>only of</b> a primary key!').replace(
                /<\/?b>/g,
                '',
              )}
            >
              ⓘ
            </span>
          </strong>
          <input
            id="input_index_name"
            className="input w-56"
            maxLength={64}
            value={index.name}
            disabled={index.choice === 'PRIMARY'}
            onChange={(e) => setIndex({ ...index, name: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <strong>
            {t('Index choice:')} <MySqlDocLink link="alter-table" />
          </strong>
          <select
            id="select_index_choice"
            className="input"
            value={index.choice}
            onChange={(e) => setChoice(e.target.value as EditorIndex['choice'])}
          >
            {form.primaryAllowed && <option value="PRIMARY">PRIMARY</option>}
            <option value="INDEX">INDEX</option>
            <option value="UNIQUE">UNIQUE</option>
            <option value="SPATIAL">SPATIAL</option>
            <option value="FULLTEXT">FULLTEXT</option>
          </select>
        </label>
      </div>
      {form.sliders !== 'disabled' && (
        <Button className="mb-2" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {t('Advanced options')}
        </Button>
      )}
      {(advanced || form.sliders === 'disabled') && (
        <div className="mb-2 grid max-w-xl grid-cols-2 gap-2">
          <label className="flex flex-col">
            <strong>{t('Key block size:')}</strong>
            <input
              className="input"
              value={index.keyBlockSize}
              onChange={(e) => setIndex({ ...index, keyBlockSize: e.target.value })}
            />
          </label>
          <label className="flex flex-col">
            <strong>{t('Index type:')}</strong>
            <select
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
          </label>
          <label className="flex flex-col">
            <strong>{t('Parser:')}</strong>
            <input
              className="input"
              value={index.parser}
              onChange={(e) => setIndex({ ...index, parser: e.target.value })}
            />
          </label>
          <label className="flex flex-col">
            <strong>{t('Comment:')}</strong>
            <input
              className="input"
              maxLength={1024}
              value={index.comment}
              onChange={(e) => setIndex({ ...index, comment: e.target.value })}
            />
          </label>
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
            // biome-ignore lint/suspicious/noArrayIndexKey: positional index parts
            <tr key={i} data-testid={`index-column-${i}`}>
              <td className="whitespace-nowrap">
                <span title={t('Drag to reorder')}>
                  <button type="button" aria-label={t('Drag to reorder')} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3" aria-hidden />
                  </button>
                  <button type="button" aria-label={t('Drag to reorder')} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3" aria-hidden />
                  </button>
                </span>
              </td>
              <td>
                <select
                  className="input"
                  aria-label={t('Column')}
                  value={c.name}
                  disabled={spatial && i > 0}
                  onChange={(e) => setCol(i, { name: e.target.value })}
                >
                  <option value="">-- {t('Ignore')} --</option>
                  {form.fields
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
                    className="input w-16"
                    aria-label={t('Size')}
                    value={c.subPart}
                    onChange={(e) => setCol(i, { subPart: e.target.value })}
                  />
                </td>
              )}
              <td>
                <select
                  className="input"
                  aria-label={t('Collation')}
                  value={c.collation}
                  onChange={(e) => setCol(i, { collation: e.target.value })}
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
          <Button
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
      {error !== null && <MessageBox {...error} flush className="mt-2" />}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="submit" variant="primary">
          {t('Go')}
        </Button>
        <Button id="preview_index_frm" onClick={() => void submit(true)}>
          {t('Preview SQL')}
        </Button>
        {onCancel !== undefined && <Button onClick={onCancel}>{t('Close')}</Button>}
      </div>
      <PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />
    </form>
  )
}

/** #indexDialogModal: "Add index" / "Edit index" */
export function IndexDialog({
  scope,
  query,
  onClose,
  onDone,
}: {
  scope: TableRef
  query: { index?: string; create?: number } | null
  onClose: () => void
  onDone: (r: DdlResponse) => void
}) {
  const form = useQuery({
    queryKey: qk.indexForm(scope, query),
    queryFn: () => api.indexForm(scope, query ?? {}),
    enabled: query !== null,
    gcTime: 0,
  })
  return (
    <Modal
      title={query?.index !== undefined ? t('Edit index') : t('Add index')}
      open={query !== null}
      onClose={onClose}
      size="xl"
    >
      {form.data !== undefined && (
        <IndexEditorForm scope={scope} form={form.data} onDone={onDone} onCancel={onClose} />
      )}
    </Modal>
  )
}

/** #indexDialogModal with index_rename_form.twig */
export function RenameIndexDialog({
  scope,
  index,
  onClose,
  onDone,
}: { scope: TableRef; index: string | null; onClose: () => void; onDone: (r: DdlResponse) => void }) {
  const [name, setName] = useState(index ?? '')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null)
  useEffect(() => setName(index ?? ''), [index])
  const submit = async (dryRun: boolean) => {
    if (index === null) return
    setError(null)
    try {
      const r = await api.renameIndex(scope, { oldIndex: index, name, dryRun })
      if (dryRun) setPreview(r.preview ?? '')
      else onDone(r)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Modal
      title={t('Rename index')}
      open={index !== null}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit(false)}>
            {t('Go')}
          </Button>
          <Button onClick={() => void submit(true)}>{t('Preview SQL')}</Button>
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      <label className="flex flex-col text-sm">
        <strong>{t('Index name:')}</strong>
        <input className="input" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error !== null && (
        <div className="mt-2 text-sm text-error" role="alert">
          {error.text}
        </div>
      )}
      <PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />
    </Modal>
  )
}
