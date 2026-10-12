import {
  Button,
  Input,
  Modal,
  NativeCheckbox,
  NativeSelect,
  PmaIcon,
  Textarea,
  buttonVariants,
} from '@bettermyadmin/ui'
import { type ReactNode, useState } from 'react'
import { t } from '../../../lib/i18n'
import { DefinitionEditor } from '../common'
import { type HistoryObj, type OptionsForm, detail, historyGroups } from './history'

/**
 * The visual query builder's panes (`?query`): the column options, the edit panes of a history
 * entry, the "Active options" history and the Build Query dialog.
 * pma: resources/templates/database/designer/main.twig (designer_optionse, query_rename_to,
 *      query_having, query_Aggregate, query_where, .panel #ab, buildQueryModal),
 *      resources/js/designer/history.ts
 */

const REL_OPTS: Array<[string, string]> = [
  ['--', '--'],
  ['=', '='],
  ['>', '>'],
  ['<', '<'],
  ['>=', '>='],
  ['<=', '<='],
  ['NOT', 'NOT'],
  ['IN', 'IN'],
  ['EXCEPT', 'Except'],
  ['NOT IN', 'NOT IN'],
]
const AGGREGATES: Array<[string, string]> = [
  ['---', '---'],
  ['sum', 'SUM'],
  ['min', 'MIN'],
  ['max', 'MAX'],
  ['avg', 'AVG'],
  ['count', 'COUNT'],
]

function RelOpt({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect name={id} id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {REL_OPTS.map(([v, l]) => (
        <option key={v} value={v}>
          {v === 'EXCEPT' ? t(l) : l}
        </option>
      ))}
    </NativeSelect>
  )
}

function Aggregate({
  id,
  name = id,
  value,
  onChange,
  none,
}: {
  id: string
  name?: string
  value: string
  onChange: (v: string) => void
  /** HAVING lists start with None */
  none?: string
}) {
  const list =
    none === undefined
      ? AGGREGATES
      : [AGGREGATES[0] as [string, string], ['None', none], ...AGGREGATES.slice(1)]
  return (
    <NativeSelect name={name} id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {list.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </NativeSelect>
  )
}

/** the framed floating pane (`table.table-borderless` with `.input_tab`) */
export function Pane({
  id,
  style,
  children,
}: {
  id: string
  style?: React.CSSProperties
  children: ReactNode
}) {
  return (
    <table id={id} className="designer-pane" style={style}>
      <tbody>
        <tr>
          <td className="input_tab">
            <table className="w-full text-center">{children}</table>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

const Head = ({ children, colSpan = 2 }: { children: ReactNode; colSpan?: number }) => (
  <thead>
    <tr>
      <td colSpan={colSpan} className="text-center whitespace-nowrap">
        <strong>{children}</strong>
      </td>
    </tr>
  </thead>
)

const Row = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <tr>
    <td className="whitespace-nowrap px-1">{label}</td>
    <td className="px-1">{children}</td>
  </tr>
)

const Bold = ({ children }: { children: ReactNode }) => (
  <tr>
    <td className="text-center whitespace-nowrap">
      <b>{children}</b>
    </td>
  </tr>
)

function OkCancel({
  okId,
  cancelId,
  onOk,
  onCancel,
}: {
  okId: string
  cancelId: string
  onOk: () => void
  onCancel: () => void
}) {
  return (
    <tbody>
      <tr>
        <td colSpan={2} className="text-center whitespace-nowrap">
          <input
            type="button"
            id={okId}
            className={buttonVariants({ size: 'sm' })}
            name="Button"
            value={t('OK')}
            onClick={onOk}
          />
          <input
            type="button"
            id={cancelId}
            className={buttonVariants({ size: 'sm' })}
            name="Button"
            value={t('Cancel')}
            onClick={onCancel}
          />
        </td>
      </tr>
    </tbody>
  )
}

/** #designer_optionse: "Add an option for column …" */
export function OptionsPane({
  column,
  form,
  setForm,
  onOk,
  onCancel,
  style,
}: {
  column: string
  form: OptionsForm
  setForm: (f: OptionsForm) => void
  onOk: () => void
  onCancel: () => void
  style: React.CSSProperties
}) {
  const set = <K extends keyof OptionsForm>(k: K, v: OptionsForm[K]) => setForm({ ...form, [k]: v })
  return (
    <Pane id="designer_optionse" style={style}>
      <thead>
        <tr>
          <td colSpan={2} id="option_col_name" className="text-center whitespace-nowrap">
            <strong>{t('Add an option for column "%s".', column)}</strong>
          </td>
        </tr>
      </thead>
      <tbody id="where">
        <Bold>WHERE</Bold>
        <Row label={t('Relationship operator')}>
          <RelOpt id="rel_opt" value={form.relOpt} onChange={(v) => set('relOpt', v)} />
        </Row>
        <Row
          label={
            <>
              {t('Value')}
              <br />
              {t('subquery')}
            </>
          }
        >
          <Textarea
            id="Query"
            cols={18}
            value={form.query}
            onChange={(e) => set('query', e.currentTarget.value)}
          />
        </Row>
        <Bold>{t('Rename to')}</Bold>
        <Row label={t('New name')}>
          <Input
            type="text"
            id="new_name"
            value={form.newName}
            onChange={(e) => set('newName', e.currentTarget.value)}
          />
        </Row>
        <Bold>{t('Aggregate')}</Bold>
        <Row label={t('Operator')}>
          <Aggregate id="operator" value={form.operator} onChange={(v) => set('operator', v)} />
        </Row>
        <Row label={<b>GROUP BY</b>}>
          <NativeCheckbox
            value="groupby"
            id="groupby"
            checked={form.groupBy}
            onChange={(e) => set('groupBy', e.currentTarget.checked)}
          />
        </Row>
        <Row label={<b>ORDER BY</b>}>
          <NativeSelect
            name="orderby"
            id="orderby"
            value={form.orderBy}
            onChange={(e) => set('orderBy', e.currentTarget.value)}
          >
            <option value="---">---</option>
            <option value="ASC">ASC</option>
            <option value="DESC">DESC</option>
          </NativeSelect>
        </Row>
        <Bold>HAVING</Bold>
        <Row label={t('Operator')}>
          <Aggregate
            id="h_operator"
            value={form.hOperator}
            onChange={(v) => set('hOperator', v)}
            none={t('None')}
          />
        </Row>
        <Row label={t('Relationship operator')}>
          <RelOpt id="h_rel_opt" value={form.hRelOpt} onChange={(v) => set('hRelOpt', v)} />
        </Row>
        <Row
          label={
            <>
              {t('Value')}
              <br />
              {t('subquery')}
            </>
          }
        >
          <Textarea
            id="having"
            cols={18}
            value={form.having}
            onChange={(e) => set('having', e.currentTarget.value)}
          />
        </Row>
      </tbody>
      <OkCancel okId="ok_add_object" cancelId="cancel_close_option" onOk={onOk} onCancel={onCancel} />
    </Pane>
  )
}

export type EditPane = 'Where' | 'Having' | 'Rename' | 'Aggregate'

export interface EditValues {
  relOpt: string
  query: string
  operator: string
  renameTo: string
}

/** query_where / query_having / query_rename_to / query_Aggregate (DesignerHistory.historyEdit) */
export function EditHistoryPane({
  pane,
  values,
  setValues,
  onOk,
  onCancel,
}: {
  pane: EditPane
  values: EditValues
  setValues: (v: EditValues) => void
  onOk: () => void
  onCancel: () => void
}) {
  const set = <K extends keyof EditValues>(k: K, v: EditValues[K]) => setValues({ ...values, [k]: v })
  // DesignerHistory.changeStyle
  const style: React.CSSProperties = { left: 530, top: 130, position: 'absolute', zIndex: 103 }
  if (pane === 'Rename') {
    return (
      <Pane id="query_rename_to" style={style}>
        <Head>{t('Rename to')}</Head>
        <tbody id="rename_to">
          <Row label={t('New name')}>
            <Input
              type="text"
              id="e_rename"
              value={values.renameTo}
              onChange={(e) => set('renameTo', e.currentTarget.value)}
            />
          </Row>
        </tbody>
        <OkCancel okId="ok_edit_rename" cancelId="query_rename_to_button" onOk={onOk} onCancel={onCancel} />
      </Pane>
    )
  }
  if (pane === 'Aggregate') {
    return (
      <Pane id="query_Aggregate" style={style}>
        <Head>{t('Aggregate')}</Head>
        <tbody>
          <Row label={t('Operator')}>
            <Aggregate
              id="e_operator"
              name="operator"
              value={values.operator}
              onChange={(v) => set('operator', v)}
            />
          </Row>
        </tbody>
        <OkCancel okId="ok_edit_Aggr" cancelId="query_Aggregate_Button" onOk={onOk} onCancel={onCancel} />
      </Pane>
    )
  }
  if (pane === 'Having') {
    return (
      <Pane id="query_having" style={style}>
        <Head>HAVING</Head>
        <tbody id="rename_to">
          <Row label={t('Operator')}>
            {/* the template's "None" here is not translated */}
            <Aggregate
              id="hoperator"
              value={values.operator}
              onChange={(v) => set('operator', v)}
              none="None"
            />
          </Row>
          <Row label={t('Operator')}>
            <RelOpt id="hrel_opt" value={values.relOpt} onChange={(v) => set('relOpt', v)} />
          </Row>
          <Row
            label={
              <>
                {t('Value')}
                <br />
                {t('subquery')}
              </>
            }
          >
            <Textarea
              id="hQuery"
              cols={18}
              value={values.query}
              onChange={(e) => set('query', e.currentTarget.value)}
            />
          </Row>
        </tbody>
        <OkCancel okId="ok_edit_having" cancelId="query_having_button" onOk={onOk} onCancel={onCancel} />
      </Pane>
    )
  }
  return (
    <Pane id="query_where" style={style}>
      <Head>WHERE</Head>
      <tbody id="rename_to">
        <Row label={t('Operator')}>
          <RelOpt id="erel_opt" value={values.relOpt} onChange={(v) => set('relOpt', v)} />
        </Row>
        <Row
          label={
            <>
              {t('Value')}
              <br />
              {t('subquery')}
            </>
          }
        >
          <Textarea
            id="eQuery"
            cols={18}
            value={values.query}
            onChange={(e) => set('query', e.currentTarget.value)}
          />
        </Row>
      </tbody>
      <OkCancel okId="ok_edit_where" cancelId="query_where_button" onOk={onOk} onCancel={onCancel} />
    </Pane>
  )
}

/** `.panel #ab`: the history accordion, one section per table */
export function HistoryPanel({
  history,
  onAndOr,
  onEdit,
  onDelete,
}: {
  history: readonly HistoryObj[]
  onAndOr: (i: number) => void
  onEdit: (i: number) => void
  onDelete: (i: number) => void
}) {
  const [active, setActive] = useState<number | null>(null)
  return (
    <div id="ab">
      {historyGroups(history).map((g, gi) => (
        <div key={`${g.tab}-${g.indexes[0]}`}>
          <h3 className="tiger">
            <Button variant="link" onClick={() => setActive(active === gi ? null : gi)}>
              {g.tab}
            </Button>
          </h3>
          {active === gi && (
            <div className="toggle_container">
              {g.indexes.map((i) => {
                const h = history[i] as HistoryObj
                const d = detail(h)
                const groupOrOrder = h.type === 'GroupBy' || h.type === 'OrderBy'
                return (
                  <div key={i} className="block">
                    <table className="w-auto">
                      <thead>
                        <tr>
                          <td>
                            <button type="button" onClick={() => onAndOr(i)} title={h.andOr ? 'OR' : 'AND'}>
                              <PmaIcon
                                name={h.andOr ? 'designer/or_icon' : 'designer/and_icon'}
                                alt={h.andOr ? 'OR' : 'AND'}
                              />
                            </button>
                          </td>
                          <td className="ps-1 text-end">
                            <PmaIcon name="b_select" alt={t('Column name')} />
                          </td>
                          <td width={175} className="ps-1">
                            {h.columnName}
                          </td>
                          <td className="text-center">
                            <span title={d}>
                              <PmaIcon name="s_info" alt={d} />
                            </span>
                          </td>
                          <td title={d}>{h.type}</td>
                          {!groupOrOrder && (
                            <td>
                              <button type="button" onClick={() => onEdit(i)} title={t('Edit')}>
                                <PmaIcon name="b_edit" alt={t('Edit')} />
                              </button>
                            </td>
                          )}
                          <td>
                            <button type="button" onClick={() => onDelete(i)} title={t('Delete')}>
                              <PmaIcon name="b_drop" alt={t('Delete')} />
                            </button>
                          </td>
                        </tr>
                      </thead>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** #buildQueryModal: the built SELECT in the SQL editor; Submit runs it */
export function BuildQueryModal({
  sql,
  codemirror,
  onSubmit,
  onClose,
}: {
  sql: string
  codemirror: boolean
  onSubmit: (sql: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(sql)
  return (
    <Modal
      id="buildQueryModal"
      title="SELECT"
      open
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          <Button id="buildQuerySubmitButton" onClick={() => onSubmit(value)}>
            {t('Submit')}
          </Button>
        </>
      }
    >
      <form id="vqb_form" onSubmit={(e) => e.preventDefault()}>
        <DefinitionEditor
          id="textSqlquery"
          label="SELECT"
          value={value}
          onChange={setValue}
          codemirror={codemirror}
        />
      </form>
    </Modal>
  )
}
