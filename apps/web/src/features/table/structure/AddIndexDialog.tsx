import type { IndexFormResponse } from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal } from '@bettermyadmin/ui'
import { useRef, useState } from 'react'
import type { TableRef } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { type EditorActions, type FormTarget, IndexEditorForm } from '../indexes/IndexEditor'
import type { DraftIndex, IndexChoice } from './advanced-index'

/**
 * The dialogs of the create table / add columns form's Index select (#addIndexModal): the index
 * form for the chosen columns (showAddIndexDialog), and the single / composite choice when an
 * index of that kind exists already (indexTypeSelectionDialog).
 *
 * pma: resources/js/modules/indexes.ts (createAddIndexModal, showAddIndexDialog, addIndexGo,
 *      indexTypeSelectionDialog, getCompositeIndexList), IndexesController create_edit_table
 */

/** showAddIndexDialog: the index form of `targets` (the `columns` JSON posted with create_edit_table) */
export function AddIndexFormDialog({
  scope,
  targets,
  initial,
  sliders,
  onGo,
  onCancel,
  onClose,
}: {
  scope: TableRef
  targets: FormTarget[]
  initial: DraftIndex
  sliders: string
  onGo: (index: DraftIndex) => void
  onCancel: () => void
  onClose: () => void
}) {
  const actions = useRef<EditorActions | null>(null)
  const [missing, setMissing] = useState(false)
  // index_form.twig: add_fields = count(columns), row i preselects the i-th posted column
  const [form] = useState<IndexFormResponse>(() => ({
    index: {
      name: initial.keyName,
      choice: initial.choice,
      keyBlockSize: initial.keyBlockSize,
      type: initial.type,
      parser: initial.parser,
      comment: initial.comment,
      columns: targets.map((f) => ({
        name: String(f.colIndex),
        subPart: initial.columns.find((c) => c.colIndex === f.colIndex)?.size ?? '',
        collation: '',
      })),
    },
    oldIndex: null,
    primaryAllowed: true,
    fields: [],
    addFields: 0,
    sliders,
  }))
  /** addIndexGo: every column select needs a column ("Please select column(s) for the index.") */
  const go = () => {
    const v = actions.current?.value()
    if (v === undefined) return
    if (v.columns.some((c) => c.name === '')) {
      setMissing(true)
      return
    }
    onGo({
      keyName: v.name,
      comment: v.comment,
      // Index_choice comes from the posted index (the select is disabled)
      choice: initial.choice,
      keyBlockSize: v.keyBlockSize,
      parser: v.parser,
      type: v.type,
      columns: v.columns.map((c) => ({ colIndex: Number(c.name), size: c.subPart })),
    })
  }
  return (
    <Modal
      id="addIndexModal"
      title={t('Add index')}
      open
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button id="addIndexModalGoButton" onClick={go}>
            {t('Go')}
          </Button>
          <Button id="addIndexModalCancelButton" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        </>
      }
    >
      {/* keypress Enter in #addIndexModal runs Go */}
      <div
        role="presentation"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          go()
        }}
      >
        {missing && (
          <MessageBox
            type="error"
            flush
            className="mb-2"
            text={t('Please select column(s) for the index.')}
          />
        )}
        <IndexEditorForm scope={scope} form={form} onDone={() => {}} actions={actions} targets={targets} />
      </div>
    </Modal>
  )
}

/** indexTypeSelectionDialog: single-column index, or composite with one of the existing ones */
export function IndexTypeDialog({
  choice,
  source,
  colIndex,
  names,
  onSingle,
  onComposite,
  onCancel,
  onClose,
}: {
  choice: IndexChoice
  source: DraftIndex[]
  colIndex: number
  names: readonly string[]
  onSingle: () => void
  onComposite: (arrayIndex: number) => void
  onCancel: () => void
  onClose: () => void
}) {
  const [composite, setComposite] = useState(false)
  // getCompositeIndexList: `alreadyPresent` is never reset, so every radio from the first index
  // holding the column on is `checked` and the browser keeps the last one
  const present = source.some((i) => i.columns.some((c) => c.colIndex === colIndex))
  const [with_, setWith] = useState<number | null>(present ? source.length - 1 : null)
  const [empty, setEmpty] = useState(false)
  const go = () => {
    if (!composite) return onSingle()
    if (with_ === null) {
      setEmpty(true)
      return
    }
    onComposite(with_)
  }
  return (
    <Modal
      id="addIndexModal"
      title={t('Add index')}
      open
      onClose={onClose}
      footer={
        <>
          <Button id="addIndexModalGoButton" onClick={go}>
            {t('Go')}
          </Button>
          <Button id="addIndexModalCancelButton" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        </>
      }
    >
      {empty && <MessageBox type="error" flush className="mb-2" text={t('Missing value in the form!')} />}
      <fieldset id="advance_index_creator" className="text-sm">
        <legend className="font-semibold">{choice.toUpperCase()}</legend>
        <div className="form-check">
          <input
            type="radio"
            id="single_column"
            name="index_choice"
            checked={!composite}
            onChange={() => setComposite(false)}
          />{' '}
          <label htmlFor="single_column">{t('Create single-column index')}</label>
        </div>
        <div className="form-check">
          <input
            type="radio"
            id="composite_index"
            name="index_choice"
            checked={composite}
            onChange={() => setComposite(true)}
          />{' '}
          <label htmlFor="composite_index">{t('Create composite index')}</label>
        </div>
        {composite && (
          <ul id="composite_index_list" className="mt-2">
            <div>{t('Composite with:')}</div>
            {source.map((idx, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the radios are valued by array index
              <li key={i}>
                <input
                  type="radio"
                  name="composite_with"
                  id={`composite_index_${i}`}
                  value={i}
                  checked={with_ === i}
                  onChange={() => setWith(i)}
                />{' '}
                <label htmlFor={`composite_index_${i}`}>
                  {idx.columns.map((c) => names[c.colIndex] ?? '').join(', ')}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </Modal>
  )
}
