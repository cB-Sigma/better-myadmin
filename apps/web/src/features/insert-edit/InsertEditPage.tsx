import type { InsertColumn, InsertFormResponse, SaveRowsRequest, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
  Label,
  MessageBox,
  NativeSelect,
  Panel,
  PanelBody,
  Table,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Fragment, type KeyboardEvent, useMemo, useState } from 'react'
import { ApiError, type InsertFormRequest, api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { GisEditor } from '../gis/GisEditor'
import { usePagePrefs } from '../preferences/PageSettings.tsx'
import { useLockPage } from '../shell/page-chrome'
import { HighlightedSql } from '../sql/HighlightedSql'
import { setFlash } from '../table/structure/flash'
import { ForeignBrowser } from './ForeignBrowser'
import { NullCheckbox, ValueWidget } from './ValueWidget'
import {
  type RowState,
  arrowTarget,
  changeCell,
  fieldIndex,
  initialRows,
  toSaveFields,
  toggleNull,
  validateCell,
} from './logic'

export interface InsertEditPageProps {
  server: number
  db: string
  table: string
  /** signed unique conditions of the rows to edit / copy (none = the Insert tab) */
  where: Array<{ clause: string; sig: string }>
  /** Copy (default_action=insert) */
  copy?: boolean
  clauseIsUnique?: boolean
  /** where "Go back to previous page" leads (the Browse URL when opened from there) */
  goto?: string | undefined
  /** sql_query of the Browse page */
  sqlQuery?: string | undefined
  /** the signature of sqlQuery (it comes from the URL); '' never verifies */
  sqlQuerySig?: string | undefined
}

/**
 * Insert / Edit / Copy rows.
 * pma: src/Controllers/Table/ChangeController.php, ChangeRowsController.php, ReplaceController.php,
 *      templates/table/insert/*.twig, resources/js/table/change.ts
 */
export function InsertEditPage(props: InsertEditPageProps) {
  const { server, db, table } = props
  // pma: Table\ChangeController: PageSettings::init('Edit')
  usePagePrefs(server, 'Edit')
  const [req, setReq] = useState<InsertFormRequest>({
    where: props.where,
    copy: props.copy === true,
    clauseIsUnique: props.clauseIsUnique === true,
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const q = useQuery({
    queryKey: qk.insertForm({ server, db, table }, req),
    queryFn: () => api.insertForm({ server, db, table }, req),
    gcTime: 0,
    staleTime: 0,
  })
  if (q.error instanceof ApiError) return <MessageBox {...errorMessage(q.error)} flush />
  if (q.data === undefined) return <div className="text-sm text-fg-subtle">{t('Loading…')}</div>
  return (
    <InsertEditForm
      key={JSON.stringify(req)}
      {...props}
      form={q.data}
      messages={messages}
      reload={(next, msgs) => {
        setMessages(msgs)
        setReq((r) => ({ ...r, ...next }))
      }}
    />
  )
}

function InsertEditForm({
  server,
  db,
  table,
  form: f,
  messages,
  reload,
  goto,
  sqlQuery,
  sqlQuerySig,
}: InsertEditPageProps & {
  form: InsertFormResponse
  messages: SqlMessage[]
  reload: (req: Partial<InsertFormRequest>, messages: SqlMessage[]) => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const initial = useMemo(() => initialRows(f), [f])
  const [rows, setRows] = useState<RowState[]>(initial)
  const editing = f.rows.some((r) => r.whereClause !== null)
  const [submitType, setSubmitType] = useState<SaveRowsRequest['submitType']>(editing ? 'save' : 'insert')
  const [afterInsert, setAfterInsert] = useState(f.afterInsert as SaveRowsRequest['afterInsert'])
  const [preview, setPreview] = useState<string[] | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [foreign, setForeign] = useState<{ row: number; col: number } | null>(null)
  const [gis, setGis] = useState<{ row: number; col: number } | null>(null)
  const [insertRows, setInsertRows] = useState(String(f.rows.length))
  // lock-page: a field differs from what the form was rendered with (added rows alone do not count)
  const dirty = rows.some((row, i) => {
    const base = initial[Math.min(i, initial.length - 1)]
    return base !== undefined && JSON.stringify(row.cells) !== JSON.stringify(base.cells)
  })
  useLockPage(dirty && !busy)

  const setRow = (r: number, fn: (row: RowState) => RowState) =>
    setRows((rs) => rs.map((x, i) => (i === r ? fn(x) : x)))

  // submit_type: switching to an insert blanks auto-increment values in edit mode, "Save" restores them
  const changeSubmitType = (v: SaveRowsRequest['submitType']) => {
    setSubmitType(v)
    if (!editing) return
    setRows((rs) =>
      rs.map((row, r) => ({
        ...row,
        cells: row.cells.map((c, i) => {
          const cell = f.rows[r]?.cells[i]
          if (cell?.autoIncrement !== true) return c
          return { ...c, value: v === 'save' ? (cell.prev ?? '') : '' }
        }),
      })),
    )
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    rows.forEach((row, r) => {
      if (row.ignore === true) return
      const server = f.rows[Math.min(r, f.rows.length - 1)]
      f.columns.forEach((col, i) => {
        const e = validateCell(col, server?.cells[i] as never, row.cells[i] as never, (m) => t(m))
        if (e !== null) errs[`${r}:${i}`] = e
      })
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const save = async (isPreview: boolean) => {
    if (!isPreview && !validate()) return
    const body: SaveRowsRequest = {
      rows: rows.map((row, r) => ({
        whereClause: row.whereClause,
        ignore: row.ignore === true,
        fields: toSaveFields(f, r, row),
      })),
      submitType,
      afterInsert,
      clauseIsUnique: f.clauseIsUnique,
      preview: isPreview,
      sqlQuery: sqlQuery ?? '',
      ...(sqlQuerySig !== undefined ? { sqlQuerySig } : {}),
    }
    setBusy(true)
    try {
      const r = await api.saveRows({ server, db, table }, body)
      if (isPreview) {
        setPreview(r.preview ?? [])
        return
      }
      await qc.invalidateQueries({ queryKey: qk.tbl({ server, db, table }) })
      const msgs = [r.message]
      if (r.next.action === 'back') {
        setFlash(msgs)
        const tbl = `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(table)}`
        if (goto !== undefined) await navigate({ to: goto })
        else if (r.next.sql !== undefined) {
          // back to the Browse query the rows came from (it runs again)
          await navigate({
            to: `${tbl}/browse`,
            search: { sql: r.next.sql.sql, sig: r.next.sql.sig } as never,
          })
        } else await navigate({ to: `${tbl}/sql` })
      } else if (r.next.action === 'insert') {
        reload(
          {
            where: [],
            copy: false,
            unsaved: r.unsaved,
            afterInsert: r.unsaved !== undefined ? afterInsert : 'new_insert',
          },
          msgs,
        )
      } else {
        reload({ where: r.next.where, copy: false, unsaved: r.unsaved, afterInsert }, msgs)
      }
    } catch (e) {
      const env = e instanceof ApiError ? e.envelope : null
      const text =
        env?.errno !== undefined
          ? `#${env.errno} - ${env.message}`
          : String(e instanceof Error ? e.message : e)
      reloadMessages([{ type: 'error', text, ...(env?.sql !== undefined ? { sql: env.sql } : {}) }])
    } finally {
      setBusy(false)
    }
  }
  const [localMessages, reloadMessages] = useState<SqlMessage[]>([])

  /** "Continue insertion with N rows": rows added/removed client-side */
  const continueInsertion = async (raw: string) => {
    setInsertRows(raw)
    // an empty or invalid number is ignored until the user types one (the input has min=1)
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n) || n < 1) return
    if (n === rows.length) return
    if (n < rows.length) {
      if (
        dirty &&
        !(await confirm({
          question: t(
            'You are trying to reduce the number of rows, but have already entered data in those rows which will be lost. Do you wish to continue?',
          ),
        }))
      ) {
        setInsertRows(String(rows.length))
        return
      }
      setRows((rs) => rs.slice(0, n))
      return
    }
    const template = initialRows(f).at(-1) as RowState
    setRows((rs) => [...rs, ...Array.from({ length: n - rs.length }, () => ({ ...template, ignore: true }))])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!e.ctrlKey) return
    const el = e.target as HTMLElement
    if (!['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || el.id === '') return
    const ids = arrowTarget(el.id, e.key)
    if (ids === null) return
    e.preventDefault()
    const next = ids.map((id) => document.getElementById(id)).find((x) => x !== null)
    if (next === undefined || next === null) return
    next.focus()
    if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) next.select()
  }

  const showType = f.showFieldTypes
  const showFunction = f.showFunctionFields
  const toggle = (which: 'function' | 'type', show: boolean) =>
    reload(which === 'function' ? { showFunctionFields: show } : { showFieldTypes: show }, [])

  const goRow = (
    <tr>
      <th colSpan={5} className="py-1 text-end">
        <Button type="submit" variant="primary">
          {t('Go')}
        </Button>
      </th>
    </tr>
  )
  const foreignCell = foreign === null ? null : rows[foreign.row]?.cells[foreign.col]
  const gisCell = gis === null ? null : rows[gis.row]?.cells[gis.col]

  return (
    <div className="space-y-3" data-testid="insert-edit">
      {[...messages, ...f.messages, ...localMessages].map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: messages are positional
        <div key={i} className="overflow-hidden rounded border border-border">
          <MessageBox type={m.type} text={m.text} />
          {m.sql !== undefined && m.sql !== '' && (
            <HighlightedSql sql={m.sql} className="bg-bg-inset px-3 py-2" />
          )}
        </div>
      ))}
      <form
        id="insertForm"
        className="lock-page"
        onSubmit={(e) => {
          e.preventDefault()
          void save(false)
        }}
        onReset={(e) => {
          e.preventDefault()
          setRows(initial)
          setErrors({})
        }}
      >
        {(!showFunction || !showType) && (
          <div className="text-[13px]">
            {t('Show')}
            {!showFunction && (
              <>
                {' : '}
                <Button variant="link" onClick={() => toggle('function', true)}>
                  {t('Function')}
                </Button>
              </>
            )}
            {!showType && (
              <>
                {' : '}
                <Button variant="link" onClick={() => toggle('type', true)}>
                  {t('Type')}
                </Button>
              </>
            )}
          </div>
        )}
        {rows.map((row, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: form rows are positional (multi_edit index)
          <Fragment key={r}>
            {row.ignore !== null && (
              <div className="flex items-center gap-1 text-[13px]">
                <Checkbox
                  id={`insert_ignore_${r}`}
                  name={`insert_ignore_${r}`}
                  checked={row.ignore}
                  onCheckedChange={(v) => setRow(r, (x) => ({ ...x, ignore: v === true }))}
                />
                <label htmlFor={`insert_ignore_${r}`}>{t('Ignore')}</label>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table zebra className="insertRowTable my-3 w-auto" onKeyDown={onKeyDown}>
                <thead>
                  {goRow}
                  <tr>
                    <th className="px-2 py-1">{t('Column')}</th>
                    {showType && (
                      <th className="px-2 py-1">
                        <Button variant="link" title={t('Hide')} onClick={() => toggle('type', false)}>
                          {t('Type')}
                        </Button>
                      </th>
                    )}
                    {showFunction && (
                      <th className="px-2 py-1">
                        <Button variant="link" title={t('Hide')} onClick={() => toggle('function', false)}>
                          {t('Function')}
                        </Button>
                      </th>
                    )}
                    <th className="px-2 py-1">{t('Null')}</th>
                    <th className="w-1/2 px-2 py-1">{t('Value')}</th>
                  </tr>
                </thead>
                <tfoot>{goRow}</tfoot>
                <tbody>
                  {f.columns.map((col, i) => (
                    <ColumnRow
                      key={col.md5}
                      col={col}
                      f={f}
                      r={r}
                      i={i}
                      row={row}
                      error={errors[`${r}:${i}`] ?? null}
                      setRow={(fn) => setRow(r, fn)}
                      onForeign={() => setForeign({ row: r, col: i })}
                      onGis={() => setGis({ row: r, col: i })}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
          </Fragment>
        ))}
        <Panel>
          <PanelBody id="actions_panel" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                name="submit_type"
                className="control_at_footer"
                value={submitType}
                onChange={(e) => changeSubmitType(e.target.value as SaveRowsRequest['submitType'])}
              >
                {editing && <option value="save">{t('Save')}</option>}
                <option value="insert">{t('Insert as new row')}</option>
                <option value="insertignore">{t('Insert as new row and ignore errors')}</option>
                <option value="showinsert">{t('Show insert query')}</option>
              </NativeSelect>
              <strong>{t('and then')}</strong>
              <NativeSelect
                name="after_insert"
                className="control_at_footer"
                value={afterInsert}
                onChange={(e) => setAfterInsert(e.target.value as SaveRowsRequest['afterInsert'])}
              >
                <option value="back">{t('Go back to previous page')}</option>
                <option value="new_insert">{t('Insert another new row')}</option>
                {editing && <option value="same_insert">{t('Go back to this page')}</option>}
                {editing && f.foundUniqueKey && f.isNumericWhere && (
                  <option value="edit_next">{t('Edit next row')}</option>
                )}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Hint
                message={t('Use TAB key to move from value to value, or CTRL+arrows to move anywhere.')}
              />
              <div className="flex gap-2">
                <Button className="preview_sql control_at_footer" onClick={() => void save(true)}>
                  {t('Preview SQL')}
                </Button>
                <Button type="reset" className="control_at_footer">
                  {t('Reset')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  id="buttonYes"
                  className="control_at_footer"
                  disabled={busy}
                >
                  {t('Go')}
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      </form>
      {f.insertMode && (
        <form
          id="continueForm"
          className="flex items-center gap-2 text-[13px]"
          onSubmit={(e) => e.preventDefault()}
        >
          <Label htmlFor="insert_rows">{t('Amount of rows to insert')}</Label>
          <Input
            type="number"
            id="insert_rows"
            name="insert_rows"
            min={1}
            className="w-20"
            value={insertRows}
            // addNewContinueInsertionFields runs on `change` (blur) and Enter, not while typing
            onChange={(e) => setInsertRows(e.target.value)}
            onBlur={(e) => void continueInsertion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void continueInsertion(e.currentTarget.value)
            }}
          />
        </form>
      )}
      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent id="previewSqlModal" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('Preview SQL')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="preview_sql" data-testid="preview-sql">
            {preview?.length === 0 ? t('No change') : preview?.map((s) => <HighlightedSql key={s} sql={s} />)}
          </DialogBody>
          <DialogFooter>
            <Button id="previewSQLCloseButton" onClick={() => setPreview(null)}>
              {t('Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {foreign !== null && foreignCell !== undefined && foreignCell !== null && (
        <ForeignBrowser
          server={server}
          db={db}
          table={table}
          field={(f.columns[foreign.col] as InsertColumn).field}
          data={Array.isArray(foreignCell.value) ? '' : foreignCell.value}
          onClose={() => setForeign(null)}
          onPick={(key) => {
            setRow(foreign.row, (x) => changeCell(x, foreign.col, { value: key }))
            setForeign(null)
          }}
        />
      )}
      {gis !== null && gisCell !== undefined && gisCell !== null && (
        <GisEditor
          field={(f.columns[gis.col] as InsertColumn).field}
          columnType={showType ? (f.columns[gis.col] as InsertColumn).displayType : ''}
          value={Array.isArray(gisCell.value) ? '' : gisCell.value}
          onClose={() => setGis(null)}
          onCopy={(v) => {
            setRow(gis.row, (x) => changeCell(x, gis.col, { value: v }))
            setGis(null)
          }}
        />
      )}
    </div>
  )
}

/** column_row.twig */
function ColumnRow({
  col,
  f,
  r,
  i,
  row,
  error,
  setRow,
  onForeign,
  onGis,
}: {
  col: InsertColumn
  f: InsertFormResponse
  r: number
  i: number
  row: RowState
  error: string | null
  setRow: (fn: (row: RowState) => RowState) => void
  onForeign: () => void
  onGis: () => void
}) {
  const cell = f.rows[Math.min(r, f.rows.length - 1)]?.cells[i]
  const state = row.cells[i]
  if (cell === undefined || state === undefined) return null
  const idx = fieldIndex(r, f.columnCount, col.columnNumber)
  return (
    <tr className="noclick">
      <td className="px-2 py-1 text-center">
        {col.comment !== null ? (
          <span className="border-b border-dashed border-fg" title={col.comment}>
            {col.field}
          </span>
        ) : (
          col.field
        )}
      </td>
      {f.showFieldTypes && (
        <td
          className={`px-2 py-1 text-center ${col.trueType !== 'set' && col.trueType !== 'enum' ? 'whitespace-nowrap' : ''}`}
        >
          <span className="column_type" dir="ltr">
            {col.displayType}
          </span>
        </td>
      )}
      {f.showFunctionFields && (
        <td className={`px-2 py-1 ${col.functionCell !== 'select' ? 'text-center' : ''}`}>
          {col.functionCell === 'binary' ? (
            t('Binary')
          ) : col.functionCell === 'none' ? (
            '--'
          ) : (
            <NativeSelect
              id={`field_${idx}_1`}
              name={`funcs[multi_edit][${r}][${col.md5}]`}
              value={state.fn}
              onChange={(e) => setRow((x) => changeCell(x, i, { fn: e.target.value }))}
            >
              {f.functions.map((o) => (
                <option key={o.value} value={o.value} title={o.title}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </td>
      )}
      <td className="px-2 py-1">
        <NullCheckbox
          col={col}
          idx={idx}
          rowId={r}
          checked={state.isNull}
          onChange={(v) => setRow((x) => toggleNull(x, i, v))}
        />
      </td>
      <td className="px-2 py-1" data-type={col.trueType} data-decimals={col.decimals}>
        <ValueWidget
          col={col}
          cell={cell}
          state={state}
          idx={idx}
          rowId={r}
          error={error}
          onChange={(patch) => setRow((x) => changeCell(x, i, patch))}
          onBrowseForeign={onForeign}
          onGis={onGis}
        />
      </td>
    </tr>
  )
}
