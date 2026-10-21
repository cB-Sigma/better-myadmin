import type {
  CentralColumn,
  CentralColumnsActionResponse,
  CentralColumnsResponse,
  ColumnFormOptions,
  SqlMessage,
} from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  Checkbox,
  IconText,
  Input,
  Label,
  NativeSelect,
  Panel,
  PanelBody,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { CollationSelect, EnumEditor, TypeSelect } from '../table/structure/ColumnForm'
import { Messages, errorMessage } from './common'

/** One editor row (the inputs of main.twig / edit_table_row.twig). */
interface Draft {
  name: string
  type: string
  length: string
  defaultType: string
  defaultValue: string
  collation: string
  attribute: string
  isNull: boolean
  autoIncrement: boolean
}

const emptyDraft = (options: ColumnFormOptions): Draft => {
  const first = options.types.find((o) => !('separator' in o))
  return {
    name: '',
    type: first !== undefined && 'type' in first ? first.type : 'INT',
    length: '',
    defaultType: 'NONE',
    defaultValue: '',
    collation: '',
    attribute: '',
    isNull: false,
    autoIncrement: false,
  }
}

const toDraft = (c: CentralColumn): Draft => ({
  name: c.name,
  type: c.type.toUpperCase(),
  length: c.length,
  defaultType: c.defaultType,
  defaultValue: c.defaultValue,
  collation: c.collation,
  attribute: c.attribute.toUpperCase(),
  isNull: c.isNull,
  autoIncrement: c.extra === 'auto_increment',
})

const SORT_KEYS = ['name', 'type', 'length', 'default', 'collation', 'attribute', 'isnull', 'extra'] as const
type SortKey = (typeof SORT_KEYS)[number]

const sortValue = (c: CentralColumn, k: SortKey): string => {
  switch (k) {
    case 'name':
      return c.name
    case 'type':
      return c.type
    case 'length':
      return c.length
    case 'default':
      return c.default ?? ''
    case 'collation':
      return c.collation
    case 'attribute':
      return c.attribute
    case 'isnull':
      return c.isNull ? '1' : '0'
    case 'extra':
      return c.extra
  }
}

/** The editor cells of one row (Name … A_I). */
function EditorCells({
  options,
  draft,
  onChange,
  row,
  addRow = false,
}: {
  options: ColumnFormOptions
  draft: Draft
  onChange: (d: Draft) => void
  row: number
  /**
   * The "Add new column" row: central_columns.ts renames each control after its cell (col_name,
   * col_type, …). phpMyAdmin labels none of them; ours keep their aria-labels.
   */
  addRow?: boolean
}) {
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p })
  const [enumOpen, setEnumOpen] = useState(false)
  const nm = (field: string, cell: string) => (addRow ? cell : `${field}[${row}]`)
  return (
    <>
      <td className="text-nowrap">
        <Input
          id={`field_${row}_0`}
          name={nm('field_name', 'col_name')}
          maxLength={64}
          size={10}
          title={t('Column')}
          aria-label={t('Name')}
          required
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </td>
      <td className="text-nowrap">
        <TypeSelect
          options={options}
          name={nm('field_type', 'col_type')}
          value={draft.type}
          onChange={(v) => set({ type: v })}
        />
      </td>
      <td className="text-nowrap">
        <Input
          id={`field_${row}_2`}
          name={nm('field_length', 'col_length')}
          size={8}
          aria-label={t('Length/Value')}
          value={draft.length}
          onChange={(e) => set({ length: e.target.value })}
        />
        {/* p.enum_notice: shown for ENUM and SET (functions.ts checkEnumAndSet) */}
        {(draft.type === 'ENUM' || draft.type === 'SET') && (
          <p className="enum_notice" id={`enum_notice_${row}_2`}>
            <Button variant="link" className="open_enum_editor h-auto p-0" onClick={() => setEnumOpen(true)}>
              {t('Edit ENUM/SET values')}
            </Button>
          </p>
        )}
        {enumOpen && (
          <EnumEditor
            value={draft.length}
            column={draft.name}
            onClose={() => setEnumOpen(false)}
            onSave={(v) => {
              set({ length: v })
              setEnumOpen(false)
            }}
          />
        )}
      </td>
      <td className="text-nowrap">
        <NativeSelect
          name={nm('field_default_type', 'col_default')}
          className="default_type"
          aria-label={t('Default')}
          value={draft.defaultType}
          onChange={(e) => set({ defaultType: e.target.value })}
        >
          <option value="NONE">{pgettext('for default', 'None')}</option>
          <option value="USER_DEFINED">{t('As defined:')}</option>
          <option value="NULL">NULL</option>
          <option value="CURRENT_TIMESTAMP">CURRENT_TIMESTAMP</option>
        </NativeSelect>
        {draft.defaultType === 'USER_DEFINED' && (
          <Input
            name={`field_default_value[${row}]`}
            size={12}
            className="default_value"
            aria-label={t('As defined:')}
            value={draft.defaultValue}
            onChange={(e) => set({ defaultValue: e.target.value })}
          />
        )}
      </td>
      <td className="text-nowrap">
        <CollationSelect
          options={options}
          name={nm('field_collation', 'collation')}
          label={t('Collation')}
          value={draft.collation}
          onChange={(v) => set({ collation: v })}
        />
      </td>
      <td className="text-nowrap">
        <NativeSelect
          name={nm('field_attribute', 'col_attribute')}
          aria-label={t('Attribute')}
          // column_attribute.twig: values as listed, the selection compared upper-cased
          value={options.attributes.find((a) => a.toUpperCase() === draft.attribute.toUpperCase()) ?? ''}
          onChange={(e) => set({ attribute: e.target.value })}
        >
          {options.attributes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="text-nowrap">
        <Checkbox
          className="allow_null"
          aria-label={t('Null')}
          checked={draft.isNull}
          onCheckedChange={(v) => set({ isNull: v === true })}
        />
      </td>
      <td className="text-nowrap">
        <Checkbox
          aria-label={t('A_I')}
          checked={draft.autoIncrement}
          onCheckedChange={(v) => set({ autoIncrement: v === true })}
        />
      </td>
    </>
  )
}

const tableClass =
  'w-auto border-collapse text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left'

/**
 * Database → Central columns.
 * pma: templates/database/central_columns/{main,edit,edit_table_row}.twig,
 *      resources/js/database/central_columns.ts
 */
export function CentralColumnsPage({ server, db }: { server: number; db: string }) {
  const [nav, setNav] = useState<{ pos?: number; totalRows?: number }>({})
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'central-columns', nav),
    queryFn: () => api.dbCentralColumns({ server, db }, nav),
  })
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  return <CentralColumnsView server={server} db={db} d={d} setNav={setNav} />
}

function CentralColumnsView({
  server,
  db,
  d,
  setNav,
}: {
  server: number
  db: string
  d: CentralColumnsResponse
  setNav: (n: { pos?: number; totalRows?: number }) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [message, setMessage] = useState<SqlMessage | null>(null)
  const [showAdd, setShowAdd] = useState(d.totalRows === 0)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(d.options))
  const [editing, setEditing] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  const [table, setTable] = useState('')
  const [column, setColumn] = useState('')
  const [multi, setMulti] = useState<Array<Draft & { origName: string }> | null>(null)
  const populate = useQuery({
    queryKey: qk.dbPage({ server, db }, 'central-columns-populate', { table }),
    queryFn: () => api.dbCentralColumnsPopulate({ server, db }, table),
    enabled: table !== '',
  })

  const refresh = () => qc.invalidateQueries({ queryKey: qk.dbPage({ server, db }, 'central-columns') })
  // the forms post the page (add, add new, delete, multi edit): main.twig renders the add-new form
  // hidden as soon as the list has rows; only the inline row save is an AJAX call
  const reloading = useRef(false)
  useEffect(() => {
    if (!reloading.current) return
    reloading.current = false
    setShowAdd(d.totalRows === 0)
  }, [d])
  const act = async (fn: () => Promise<CentralColumnsActionResponse>, reload = true): Promise<boolean> => {
    try {
      const r = await fn()
      setMessage(r.message)
      // the page that comes back (the refetched list) decides
      reloading.current = reload
      await refresh()
      return r.ok
    } catch (e) {
      setMessage(errorMessage(e))
      return false
    }
  }
  const input = (x: Draft) => ({
    name: x.name,
    type: x.type,
    length: x.length,
    defaultType: x.defaultType,
    defaultValue: x.defaultValue,
    collation: x.collation,
    attribute: x.attribute,
    isNull: x.isNull,
    autoIncrement: x.autoIncrement,
  })
  const noneSelected = () => setMessage({ type: 'notice', text: t('Select at least one of the options!') })

  const pageMessage = message ?? d.message
  const maxRows = d.maxRows
  const pages = Math.ceil(d.totalRows / maxRows)
  const needle = filter.toLowerCase()
  let rows = d.columns.filter(
    (c) =>
      needle === '' ||
      [
        c.name,
        c.type,
        c.length,
        c.default ?? t('None'),
        c.collation,
        c.attribute,
        c.isNull ? t('Yes') : t('No'),
        c.extra,
      ]
        .join('\u0000')
        .toLowerCase()
        .includes(needle),
  )
  if (sort !== null) {
    rows = [...rows].sort((a, b) => {
      const r = sortValue(a, sort.key).localeCompare(sortValue(b, sort.key), undefined, { numeric: true })
      return sort.desc ? -r : r
    })
  }

  if (multi !== null) {
    return (
      <div className="my-3">
        {message !== null && <Messages messages={[message]} />}
        <form
          id="multi_edit_central_columns"
          onSubmit={(e) => {
            e.preventDefault()
            void act(() =>
              api.dbCentralColumnsAction(
                { server, db },
                {
                  action: 'multi-edit',
                  columns: multi.map((m) => ({ origName: m.origName, ...input(m) })),
                },
              ),
            ).then((ok) => ok && setMulti(null))
          }}
        >
          <Panel title={t('Structure')}>
            <PanelBody className="overflow-x-auto">
              <table id="table_columns" className={`${tableClass} noclick`}>
                <thead>
                  <tr className="bg-grid-header">
                    <th>{t('Name')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Length/Values')}</th>
                    <th>{t('Default')}</th>
                    <th>{t('Collation')}</th>
                    <th>{t('Attributes')}</th>
                    <th>{t('Null')}</th>
                    <th>{pgettext('Auto Increment', 'A_I')}</th>
                  </tr>
                </thead>
                <tbody>
                  {multi.map((m, i) => (
                    <tr key={m.origName}>
                      <EditorCells
                        options={d.options}
                        draft={m}
                        row={i}
                        onChange={(x) =>
                          setMulti(multi.map((y, j) => (j === i ? { ...x, origName: m.origName } : y)))
                        }
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanelBody>
            <div className="flex gap-2 border-t border-border px-3 py-2">
              <Button type="submit" variant="primary" name="save_multi_central_column_edit">
                {t('Save')}
              </Button>
              <Button onClick={() => setMulti(null)}>{t('Cancel')}</Button>
            </div>
          </Panel>
        </form>
      </div>
    )
  }

  const header = (key: SortKey, label: string) => (
    <th key={key} className="column_heading" title={t('Click to sort.')} data-column={key}>
      <Button variant="link" onClick={() => setSort({ key, desc: sort?.key === key ? !sort.desc : false })}>
        {label}
        {sort?.key === key && <span className="sorticon ms-1">{sort.desc ? '▼' : '▲'}</span>}
      </Button>
    </th>
  )
  const labels: Record<SortKey, string> = {
    name: t('Name'),
    type: t('Type'),
    length: t('Length/Value'),
    default: t('Default'),
    collation: t('Collation'),
    attribute: t('Attribute'),
    isnull: t('Null'),
    extra: t('A_I'),
  }

  return (
    <div className="my-3">
      {pageMessage !== null && <Messages messages={[pageMessage]} />}
      <div id="add_col_div" className="topmargin my-3">
        <Button variant="link" onClick={() => setShowAdd(!showAdd)}>
          {/* main.twig: <span>+</span>Add new column, read as one word */}
          {`${showAdd ? '-' : '+'}${t('Add new column')}`}
        </Button>
        {showAdd && (
          <form
            id="add_new"
            className="new_central_col"
            onSubmit={(e) => {
              e.preventDefault()
              void act(() =>
                api.dbCentralColumnsAction({ server, db }, { action: 'add-new', column: input(draft) }),
              ).then((ok) => {
                if (ok) {
                  setDraft(emptyDraft(d.options))
                  setShowAdd(false)
                }
              })
            }}
          >
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr className="bg-grid-header">
                    <th />
                    {SORT_KEYS.map((k) => (
                      <th key={k} data-column={k}>
                        {labels[k]}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td />
                    <EditorCells options={d.options} draft={draft} row={0} onChange={setDraft} addRow />
                    <td>
                      <Button id="add_column_save" type="submit" variant="primary">
                        {t('Save')}
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </form>
        )}
      </div>
      {d.totalRows <= 0 ? (
        <Alert variant="info">{t('The central list of columns for the current database is empty')}</Alert>
      ) : (
        <div className="navigation my-2 flex flex-wrap items-center gap-2">
          {d.pos - maxRows >= 0 && (
            <Button onClick={() => setNav({ pos: d.pos - maxRows, totalRows: d.totalRows })}>&lt;</Button>
          )}
          {pages > 1 && (
            // Util::pageselector('pos', …): the options carry the first row of each page
            <NativeSelect
              name="pos"
              className="pageselector ajax"
              aria-label={t('Page number:')}
              value={String(Math.floor(d.pos / maxRows) * maxRows)}
              onChange={(e) => setNav({ pos: Number(e.target.value), totalRows: d.totalRows })}
            >
              {Array.from({ length: pages }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: page numbers
                <option key={i} value={String(i * maxRows)}>
                  {i + 1}
                </option>
              ))}
            </NativeSelect>
          )}
          {d.pos + maxRows < d.totalRows && (
            <Button onClick={() => setNav({ pos: d.pos + maxRows, totalRows: d.totalRows })}>&gt;</Button>
          )}
          <Label htmlFor="filterRows">{t('Filter rows:')}</Label>
          <Input
            id="filterRows"
            className="filter_rows max-w-60"
            placeholder={t('Search this table')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <form
        id="add_column"
        className="central_columns_navigation my-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (column === '') return
          void act(() =>
            api.dbCentralColumnsAction({ server, db }, { action: 'add-from-table', table, column }),
          )
        }}
      >
        <IconText icon="centralColumns_add" text={t('Add column')} />
        <NativeSelect
          name="table-select"
          id="table-select"
          aria-label={t('Select a table')}
          value={table}
          onChange={(e) => {
            setTable(e.target.value)
            setColumn('')
          }}
        >
          <option value="" disabled>
            {t('Select a table')}
          </option>
          {d.tables.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="column-select"
          id="column-select"
          aria-label={t('Select a column.')}
          value={column}
          onChange={(e) => setColumn(e.target.value)}
        >
          <option value="">{populate.isFetching ? t('Loading…') : t('Select a column.')}</option>
          {(populate.data ?? []).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="primary">
          {t('Add')}
        </Button>
      </form>
      {d.totalRows > 0 && (
        <div id="tableslistcontainer" className="overflow-x-auto">
          <table id="table_columns" className={`${tableClass} tablesorter`}>
            <thead>
              <tr className="bg-grid-header">
                <th className="column_heading" />
                <th className="column_action" colSpan={2}>
                  {t('Action')}
                </th>
                {SORT_KEYS.map((k) => header(k, labels[k]))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, rowNum) => {
                const e = editing[c.name]
                const stopEdit = () => {
                  const { [c.name]: _, ...rest } = editing
                  setEditing(rest)
                }
                return (
                  <tr
                    key={c.name}
                    id={`f_${rowNum}`}
                    data-rownum={rowNum}
                    className="odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover"
                  >
                    <td className="text-nowrap">
                      <Checkbox
                        className="checkall"
                        id={`checkbox_row_${rowNum}`}
                        aria-label={c.name}
                        checked={selected.includes(c.name)}
                        onCheckedChange={(v) =>
                          setSelected(
                            v === true ? [...selected, c.name] : selected.filter((x) => x !== c.name),
                          )
                        }
                      />
                    </td>
                    {e === undefined ? (
                      <>
                        <td id={`edit_${rowNum}`} className="edit text-center">
                          <Button
                            variant="link"
                            onClick={() => setEditing({ ...editing, [c.name]: toDraft(c) })}
                          >
                            <IconText icon="b_edit" text={t('Edit')} />
                          </Button>
                        </td>
                        <td className="del_row" data-rownum={rowNum}>
                          <Button
                            variant="link"
                            onClick={async () => {
                              const ok = await confirm({
                                title: t('Confirm'),
                                question: t('Do you really want to delete this central column?'),
                              })
                              if (ok)
                                await act(() =>
                                  api.dbCentralColumnsAction(
                                    { server, db },
                                    {
                                      action: 'delete',
                                      columns: [c.name],
                                    },
                                  ),
                                )
                            }}
                          >
                            <IconText icon="b_drop" text={t('Delete')} />
                          </Button>
                        </td>
                        <td>
                          <span>{c.name}</span>
                        </td>
                        <td>
                          <span>{c.type}</span>
                        </td>
                        <td>
                          <span>{c.length}</span>
                        </td>
                        <td>
                          <span>{c.default ?? t('None')}</span>
                        </td>
                        <td>
                          <span>{c.collation}</span>
                        </td>
                        <td>
                          <span>{c.attribute}</span>
                        </td>
                        <td>
                          <span>{c.isNull ? t('Yes') : t('No')}</span>
                        </td>
                        <td>
                          <span>{c.extra}</span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td id={`save_${rowNum}`}>
                          <Button
                            variant="primary"
                            className="edit_save_form"
                            onClick={() =>
                              void act(
                                () =>
                                  api.dbCentralColumnsAction(
                                    { server, db },
                                    {
                                      action: 'edit',
                                      origName: c.name,
                                      column: input(e),
                                    },
                                  ),
                                false,
                              ).then((ok) => ok && stopEdit())
                            }
                          >
                            {t('Save')}
                          </Button>
                        </td>
                        <td className="del_row">
                          <Button className="edit_cancel_form" onClick={stopEdit}>
                            {t('Cancel')}
                          </Button>
                        </td>
                        <EditorCells
                          options={d.options}
                          draft={e}
                          row={rowNum}
                          onChange={(x) => setEditing({ ...editing, [c.name]: x })}
                        />
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Label className="flex items-center gap-2">
              <Checkbox
                id="tableslistcontainer_checkall"
                className="checkall_box"
                title={t('Check all')}
                checked={rows.length > 0 && selected.length === rows.length}
                onCheckedChange={(v) => setSelected(v === true ? rows.map((r) => r.name) : [])}
              />
              {t('Check all')}
            </Label>
            <em className="with-selected">{t('With selected:')}</em>
            <Button
              variant="link"
              className="mult_submit change_central_columns"
              title={t('Edit')}
              onClick={async () => {
                if (selected.length === 0) return noneSelected()
                try {
                  const list = await api.dbCentralColumnsEdit({ server, db }, selected)
                  setMessage(null)
                  setMulti(list.map((c) => ({ ...toDraft(c), origName: c.name })))
                } catch (err) {
                  setMessage(errorMessage(err))
                }
              }}
            >
              <IconText icon="b_edit" text={t('Edit')} />
            </Button>
            <Button
              variant="link"
              className="mult_submit"
              title={t('Delete')}
              onClick={async () => {
                if (selected.length === 0) return noneSelected()
                const ok = await act(() =>
                  api.dbCentralColumnsAction({ server, db }, { action: 'delete', columns: selected }),
                )
                if (ok) setSelected([])
              }}
            >
              <IconText icon="b_drop" text={t('Delete')} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
