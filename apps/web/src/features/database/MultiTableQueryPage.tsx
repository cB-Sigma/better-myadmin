import type { QueryResponse, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  Disclosure,
  Input,
  Label,
  NativeSelect,
  Panel,
  PanelBody,
  Textarea,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { StatementBlock } from '../sql/Results'
import type { CardEnv } from '../sql/SqlMessage'
import { runQuery } from '../sql/runner'
import { Messages, errorMessage } from './common'
import {
  OPERATORS,
  type QueryColumn,
  acceptsMultipleValues,
  acceptsTwoValues,
  generateQuery,
  isOpWithoutArg,
} from './queryGenerator'

/**
 * Database → Query (multi-table query builder).
 * pma: templates/database/multi_table_query/form.twig, resources/js/database/multi_table_query.ts
 */
const newColumn = (): QueryColumn => ({
  table: '',
  column: '',
  tableAlias: '',
  columnAlias: '',
  show: true,
  useCriteria: false,
  criteria: {
    logicalOp: 'AND',
    column: '',
    op: '=',
    rhs: 'text',
    text: '',
    values: ['', ''],
    rhsTable: '',
    rhsColumn: '',
  },
})

export function MultiTableQueryPage({ server, db }: { server: number; db: string }) {
  const q = useQuery({
    queryKey: qk.dbPage(server, db, 'multi-table-query'),
    queryFn: () => api.dbMultiTableForm(server, db),
  })
  const [cards, setCards] = useState<QueryColumn[] | null>(null)
  const [sql, setSql] = useState('')
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [result, setResult] = useState<QueryResponse | null>(null)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  const list = cards ?? Array.from({ length: d.defaultColumns }, newColumn)
  const columnsOf = (table: string) => d.tables.find((x) => x.name === table)?.columns ?? []
  const set = (i: number, p: Partial<QueryColumn>) =>
    setCards(list.map((c, j) => (j === i ? { ...c, ...p } : c)))
  const setCrit = (i: number, p: Partial<QueryColumn['criteria']>) =>
    set(i, { criteria: { ...(list[i] as QueryColumn).criteria, ...p } })
  const criteriaCount = list.filter((c) => c.useCriteria).length

  const update = async () => {
    const used = [...new Set(list.filter((c) => c.table !== '' && c.show).map((c) => c.table))]
    if (used.length === 0) {
      setMessages([{ type: 'error', text: 'Nothing selected' }])
      return
    }
    try {
      const keys = await api.dbMultiTableKeys(server, db, used)
      setSql(generateQuery(list, keys.foreignKeyConstrains) ?? '')
      setMessages([])
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }
  const submit = async () => {
    if (sql === '') {
      setMessages([{ type: 'error', text: t('Please enter the SQL query first.') }])
      return
    }
    try {
      setResult(await runQuery(server, { sql, db }, 'page'))
      setMessages([])
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }
  const env: CardEnv = {
    server,
    versionInt: 0,
    confirmQuery: () => true,
    codemirror: false,
    onAction: () => {},
  }

  return (
    <div>
      <Messages messages={messages} />
      <Disclosure label={t('Query window')} initialState="open">
        <Panel className="mb-3">
          <PanelBody>
            <div className="mb-3 flex flex-wrap gap-3">
              {list.map((c, i) => {
                const cols = columnsOf(c.table)
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cards are positional
                  <fieldset key={i} className="relative min-w-60 rounded border border-border p-2 text-sm">
                    <div className="flex items-center gap-1">
                      <NativeSelect
                        className="tableNameSelect"
                        value={c.table}
                        onChange={(e) => set(i, { table: e.target.value, column: '' })}
                      >
                        <option value="">{t('select table')}</option>
                        {d.tables.map((tb) => (
                          <option key={tb.name} value={tb.name}>
                            {tb.name}
                          </option>
                        ))}
                      </NativeSelect>
                      <span>.</span>
                      <NativeSelect
                        className="columnNameSelect"
                        value={c.column}
                        onChange={(e) =>
                          set(i, {
                            column: e.target.value,
                            ...(e.target.value === '*' ? { columnAlias: '' } : {}),
                          })
                        }
                      >
                        <option value="">{t('select column')}</option>
                        {c.table !== '' && <option value="*">*</option>}
                        {cols.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    {/* like phpMyAdmin: the checkbox is followed by a plain "Show" text, not a label */}
                    <div className="mt-1 flex items-center gap-1">
                      <Checkbox
                        className="show_col"
                        checked={c.show}
                        onCheckedChange={(v) => set(i, { show: v === true })}
                      />
                      <span>{t('Show')}</span>
                    </div>
                    <div className="mt-1 flex gap-1">
                      <Input
                        className="table_alias"
                        placeholder={t('Table alias')}
                        value={c.tableAlias}
                        onChange={(e) => set(i, { tableAlias: e.target.value })}
                      />
                      <Input
                        className="col_alias"
                        placeholder={t('Column alias')}
                        disabled={c.table !== '' && (c.column === '' || c.column === '*')}
                        value={c.columnAlias}
                        onChange={(e) => set(i, { columnAlias: e.target.value })}
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <Checkbox
                        className="criteria_col"
                        title={t('Use this column in criteria')}
                        checked={c.useCriteria}
                        onCheckedChange={(v) => {
                          set(i, { useCriteria: v === true })
                          setOpen({ ...open, [i]: v === true })
                        }}
                      />
                      <Button
                        variant="link"
                        className="jsCriteriaButton"
                        onClick={() => setOpen({ ...open, [i]: !open[i] })}
                      >
                        {t('criteria')}
                      </Button>
                    </div>
                    {open[i] === true && (
                      <table className="jsCriteriaOptions mt-1 text-sm [&_td]:p-1">
                        <tbody>
                          <tr className="sort_order">
                            <td>{t('Sort')}</td>
                            <td>
                              <label>
                                <input type="radio" name={`sort[${i}]`} /> {t('Ascending')}
                              </label>
                            </td>
                            <td>
                              <label>
                                <input type="radio" name={`sort[${i}]`} /> {t('Descending')}
                              </label>
                            </td>
                          </tr>
                          {criteriaCount > 1 && (
                            <tr className="logical_operator">
                              <td>{t('Add as')}</td>
                              {['AND', 'OR'].map((op) => (
                                <td key={op}>
                                  <label>
                                    <input
                                      type="radio"
                                      className="logical_op"
                                      name={`logical_op[${i}]`}
                                      value={op}
                                      checked={c.criteria.logicalOp === op}
                                      onChange={() => setCrit(i, { logicalOp: op })}
                                    />{' '}
                                    {op}
                                  </label>
                                </td>
                              ))}
                            </tr>
                          )}
                          <tr>
                            <td>Column</td>
                            <td colSpan={2}>
                              <NativeSelect
                                className="opColumn"
                                value={c.criteria.column}
                                onChange={(e) => setCrit(i, { column: e.target.value })}
                              >
                                <option value="">{t('select column')}</option>
                                {cols.map((col) => (
                                  <option key={col} value={col}>
                                    {col}
                                  </option>
                                ))}
                              </NativeSelect>
                            </td>
                          </tr>
                          <tr>
                            <td>Op</td>
                            <td>
                              <NativeSelect
                                className="criteria_op"
                                value={c.criteria.op}
                                onChange={(e) => setCrit(i, { op: e.target.value })}
                              >
                                {OPERATORS.map((op) => (
                                  <option key={op} value={op}>
                                    {op}
                                  </option>
                                ))}
                              </NativeSelect>
                            </td>
                            <td>
                              {!isOpWithoutArg(c.criteria.op) && (
                                <NativeSelect
                                  className="criteria_rhs"
                                  value={c.criteria.rhs}
                                  onChange={(e) =>
                                    setCrit(i, {
                                      rhs: e.target.value === 'anotherColumn' ? 'anotherColumn' : 'text',
                                    })
                                  }
                                >
                                  <option value="text">{t('Text')}</option>
                                  <option value="anotherColumn">{t('Another column')}</option>
                                </NativeSelect>
                              )}
                            </td>
                          </tr>
                          {c.criteria.rhs === 'anotherColumn' && !isOpWithoutArg(c.criteria.op) ? (
                            <tr className="rhs_table">
                              <td />
                              <td>
                                <NativeSelect
                                  className="tableNameSelect"
                                  value={c.criteria.rhsTable}
                                  onChange={(e) => setCrit(i, { rhsTable: e.target.value, rhsColumn: '' })}
                                >
                                  <option value="">{t('select table')}</option>
                                  {d.tables.map((tb) => (
                                    <option key={tb.name} value={tb.name}>
                                      {tb.name}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </td>
                              <td>
                                <NativeSelect
                                  className="opColumn"
                                  value={c.criteria.rhsColumn}
                                  onChange={(e) => setCrit(i, { rhsColumn: e.target.value })}
                                >
                                  <option value="">{t('select column')}</option>
                                  {columnsOf(c.criteria.rhsTable).map((col) => (
                                    <option key={col} value={col}>
                                      {col}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </td>
                            </tr>
                          ) : (
                            !isOpWithoutArg(c.criteria.op) && (
                              <tr className="rhs_text">
                                <td />
                                <td colSpan={2}>
                                  {acceptsMultipleValues(c.criteria.op) ? (
                                    <div className="options multi flex flex-col gap-1">
                                      {c.criteria.values.map((v, k) => (
                                        // biome-ignore lint/suspicious/noArrayIndexKey: option inputs are positional
                                        <div key={k} className="flex gap-1">
                                          <Input
                                            className="val"
                                            placeholder={t('Enter an option')}
                                            value={v}
                                            onChange={(e) =>
                                              setCrit(i, {
                                                values: c.criteria.values.map((x, m) =>
                                                  m === k ? e.target.value : x,
                                                ),
                                              })
                                            }
                                          />
                                          <Button
                                            size="sm"
                                            className="remove-option"
                                            onClick={() =>
                                              setCrit(i, {
                                                values: c.criteria.values.filter((_, m) => m !== k),
                                              })
                                            }
                                          >
                                            -
                                          </Button>
                                        </div>
                                      ))}
                                      <Button
                                        size="sm"
                                        className="add-option"
                                        onClick={() => setCrit(i, { values: [...c.criteria.values, ''] })}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  ) : acceptsTwoValues(c.criteria.op) ? (
                                    <div className="flex gap-1">
                                      {[0, 1].map((k) => (
                                        <Input
                                          key={k}
                                          className="val"
                                          placeholder={
                                            k === 0 ? t('Enter first value') : t('Enter second value')
                                          }
                                          value={c.criteria.values[k] ?? ''}
                                          onChange={(e) => {
                                            const values = [
                                              c.criteria.values[0] ?? '',
                                              c.criteria.values[1] ?? '',
                                            ]
                                            values[k] = e.target.value
                                            setCrit(i, { values })
                                          }}
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <Input
                                      className="rhs_text_val"
                                      placeholder={t('Enter criteria as free text')}
                                      value={c.criteria.text}
                                      onChange={(e) => setCrit(i, { text: e.target.value })}
                                    />
                                  )}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    )}
                    <button
                      type="button"
                      className="jsRemoveColumn absolute top-1 right-1 text-fg-muted"
                      aria-label={t('Remove this column')}
                      onClick={() => setCards(list.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </fieldset>
                )
              })}
            </div>
            <Button id="add_column_button" onClick={() => setCards([...list, newColumn()])}>
              + {t('Add column')}
            </Button>
            <div className="mt-3">
              <Textarea
                id="MultiSqlquery"
                name="sql_query"
                rows={6}
                className="font-mono"
                value={sql}
                onChange={(e) => setSql(e.target.value)}
              />
            </div>
          </PanelBody>
          <div className="flex gap-2 border-t border-border px-3 py-2">
            <Button id="update_query_button" onClick={() => void update()}>
              {t('Update query')}
            </Button>
            <Button
              id="copy_query"
              disabled={sql === ''}
              onClick={() => void navigator.clipboard?.writeText(sql)}
            >
              {t('Copy query')}
            </Button>
            <Button variant="primary" id="submit_query" onClick={() => void submit()}>
              {t('Submit query')}
            </Button>
          </div>
        </Panel>
      </Disclosure>
      <div id="sql_results">
        {result?.statements.map((st, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: statements are positional
          <StatementBlock key={i} st={st} env={env} />
        ))}
      </div>
    </div>
  )
}
