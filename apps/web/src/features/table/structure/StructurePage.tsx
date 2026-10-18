import type { DdlResponse, SqlMessage, StructureResponse } from '@bettermyadmin/contracts'
import {
  Button,
  MessageBox,
  Modal,
  MySqlDocLink,
  Panel,
  PanelBody,
  PreviewSqlDialog,
  removeMessage,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, KeyRound, ListTree } from 'lucide-react'
import { useState } from 'react'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { pgettext, t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { usePagePrefs } from '../../preferences/PageSettings.tsx'
import { StructurePills } from '../common/StructurePills'
import { IndexDialog, RenameIndexDialog } from '../indexes/IndexEditor'
import { confirmSql } from './confirm'
import { takeFlash } from './flash'

/**
 * The table Structure tab.
 *
 * pma: resources/templates/table/structure/display_structure.twig, display_partitions.twig,
 *      display_table_stats.twig, indexes.twig; resources/js/table/structure.ts, modules/indexes.ts
 */
type Column = StructureResponse['columns'][number]

const sqlLink = (server: number, sql: string) => `/s/${server}/sql?sql=${encodeURIComponent(sql)}`
/** a signed query run in the table's Browse view (pma: /sql with sql_query + sql_signature) */
const browseLink = (server: number, db: string, table: string, sql: string, sig: string, distinct = false) =>
  `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(table)}/browse?sql=${encodeURIComponent(sql)}&sig=${encodeURIComponent(sig)}${distinct ? '&distinct=1' : ''}`

export function StructurePage({ server, db, table }: { server: number; db: string; table: string }) {
  const scope: TableRef = { server, db, table }
  // pma: Table\StructureController: PageSettings::init('TableStructure')
  usePagePrefs(server, 'TableStructure')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: qk.tableStructure(scope),
    queryFn: () => api.tableStructure(scope),
  })
  const [messages, setMessages] = useState<SqlMessage[]>(() => takeFlash())
  const [selected, setSelected] = useState<string[]>([])
  const [confirm, setConfirm] = useState<{
    question: string
    /** the dialog title when it is not the question (drop_confirm.twig's <h1>) */
    heading?: string
    sql: string
    run: () => Promise<void>
    /** the "No" button (pma: DropColumnController answers "No change") */
    no?: () => void
  } | null>(null)
  const [indexQuery, setIndexQuery] = useState<{ index?: string; create?: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [moving, setMoving] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  /** confirmPreviewSql before dropping an index (#previewSqlConfirmModal) */
  const [dropIndex, setDropIndex] = useState<{ sql: string; name: string } | null>(null)
  /** #moveColumnsErrorModal */
  const [moveError, setMoveError] = useState<string | null>(null)
  const [maintenance, setMaintenance] = useState<DdlResponse['maintenance'] | null>(null)
  const [addCount, setAddCount] = useState(1)
  const [after, setAfter] = useState<string | null>(null)
  const [indexCount, setIndexCount] = useState('1')

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: qk.tbl(scope) })
    await qc.invalidateQueries({ queryKey: qk.nav(server) })
  }
  const act = async (fn: () => Promise<DdlResponse>) => {
    try {
      const r = await fn()
      if (r.confirm !== undefined) return r
      setMessages(r.messages)
      setMaintenance(r.maintenance ?? null)
      setSelected([])
      await refresh()
      return r
    } catch (e) {
      setMessages([errorMessage(e)])
      return null
    }
  }

  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  const s = q.data
  const editable = !s.isView && !s.isSystemSchema
  const columnNames = s.columns.map((c) => c.name)
  const afterField = after ?? columnNames.at(-1) ?? 'first'

  const addKey = async (type: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'SPATIAL' | 'FULLTEXT', column: Column) => {
    const clause = type === 'PRIMARY' ? 'ADD PRIMARY KEY' : `ADD ${type}`
    if (!confirmSql(`ALTER TABLE \`${table}\` ${clause}(\`${column.name}\`);`)) return
    await act(() => api.addKey(scope, { type, columns: [column.name], source: 'row' }))
  }
  const bulkKey = async (type: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'SPATIAL' | 'FULLTEXT') => {
    if (selected.length === 0) return setMessages([{ type: 'error', text: t('No column selected.') }])
    const r = await act(() => api.addKey(scope, { type, columns: selected, source: 'bulk' }))
    if (r?.confirm !== undefined) {
      setConfirm({
        ...r.confirm,
        run: async () => {
          await act(() => api.addKey(scope, { type, columns: selected, source: 'bulk', confirmed: true }))
        },
      })
    }
  }
  const dropColumn = async (c: Column) => {
    if (!confirmSql(c.dropSql)) return
    const box = showMessage(t('Dropping column'), false)
    await act(() => api.dropColumns(scope, { columns: [c.name], source: 'row' }))
    removeMessage(box)
  }
  const orderedSelection = columnNames.filter((n) => selected.includes(n))
  /** the With-selected buttons are always enabled; without a selection the action answers this */
  const noneSelected = () => {
    if (selected.length > 0) return false
    setMessages([{ type: 'error', text: t('No column selected.') }])
    return true
  }

  return (
    <div id="structure_content">
      <h1 className="hidden text-lg print:block">{table}</h1>
      {s.showRelationTab && <StructurePills scope={scope} active="structure" />}
      {messages.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: message list
        <MessageBox key={i} {...m} />
      ))}
      {maintenance && (
        <Panel title={maintenance.title}>
          <PanelBody>
            {[...new Set(maintenance.rows.map((r) => r.table))].map((name) => (
              <div key={name} className="mb-2">
                <div className="font-semibold">
                  {name} ({maintenance.partition})
                </div>
                <ul>
                  {maintenance.rows
                    .filter((r) => r.table === name)
                    .map((r, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: result rows
                      <li key={i} className="text-sm">
                        <span className="mr-1 rounded bg-bg-inset px-1">{r.msgType}</span>
                        {r.msgText}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </PanelBody>
        </Panel>
      )}

      <form id="fieldsForm" onSubmit={(e) => e.preventDefault()}>
        <div className="overflow-x-auto">
          <table id="tablestructure" className="w-auto border-collapse text-sm">
            <thead>
              <tr className="bg-grid-header text-left">
                <th className="px-1 print:hidden" />
                <th className="px-1">#</th>
                <th className="px-1">{t('Name')}</th>
                <th className="px-1">{t('Type')}</th>
                <th className="px-1">{t('Collation')}</th>
                <th className="px-1">{t('Attributes')}</th>
                <th className="px-1">{t('Null')}</th>
                <th className="px-1">{t('Default')}</th>
                {s.config.ShowColumnComments && <th className="px-1">{t('Comments')}</th>}
                <th className="px-1">{t('Extra')}</th>
                {editable && (
                  <th className="px-1 print:hidden" colSpan={3}>
                    {t('Action')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {s.columns.map((c, i) => (
                <tr
                  key={c.name}
                  className="odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover"
                  data-testid={`structure-row-${c.name}`}
                >
                  <td className="px-1 text-center print:hidden">
                    <input
                      type="checkbox"
                      id={`checkbox_row_${i + 1}`}
                      aria-label={c.name}
                      checked={selected.includes(c.name)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? [...selected, c.name] : selected.filter((x) => x !== c.name),
                        )
                      }
                    />
                  </td>
                  <td className="px-1 text-right">{i + 1}</td>
                  <th className="whitespace-nowrap px-1 text-left">
                    <label htmlFor={`checkbox_row_${i + 1}`}>
                      {c.comment !== '' ? (
                        <span className="commented_column underline decoration-dotted" title={c.comment}>
                          {c.name}
                        </span>
                      ) : (
                        c.name
                      )}
                      {c.isPrimary && (
                        <KeyRound className="ml-1 inline size-3 text-notice" aria-label={t('Primary')} />
                      )}
                      {c.hasIndex && (
                        <ListTree className="ml-1 inline size-3 text-fg-muted" aria-label={t('Index')} />
                      )}
                    </label>
                  </th>
                  <td
                    className={`px-1 ${c.baseType === 'set' || c.baseType === 'enum' ? '' : 'whitespace-nowrap'}`}
                  >
                    <bdo dir="ltr" lang="en">
                      {c.abbreviated ? <abbr title={c.printType}>{c.displayedType}</abbr> : c.displayedType}
                      {/* pma: display_structure.twig (mime_map) */}
                      {c.mediaType !== undefined && (
                        <>
                          <br />
                          {t('Media type:')} {c.mediaType}
                        </>
                      )}
                    </bdo>
                  </td>
                  <td className="px-1">
                    {c.collation !== null && <dfn title={c.collation.description}>{c.collation.name}</dfn>}
                  </td>
                  <td className="column_attribute whitespace-nowrap px-1">{c.attribute}</td>
                  <td className="px-1">{c.isNull ? t('Yes') : t('No')}</td>
                  <td className="whitespace-nowrap px-1">
                    {c.default !== null ? (
                      c.default
                    ) : (
                      <em>{c.isNull ? 'NULL' : pgettext('None for default', 'None')}</em>
                    )}
                  </td>
                  {s.config.ShowColumnComments && <td className="px-1">{c.comment}</td>}
                  <td className="whitespace-nowrap px-1">{c.extra}</td>
                  {editable && (
                    <>
                      <td className="px-1 print:hidden">
                        <Link
                          to="/s/$server/db/$db/t/$table/structure/change"
                          params={{ server, db, table }}
                          search={{ fields: c.name }}
                          className="change_column_anchor"
                        >
                          {t('Change')}
                        </Link>
                      </td>
                      <td className="px-1 print:hidden">
                        <Button
                          variant="link"
                          className="drop_column_anchor"
                          onClick={() => void dropColumn(c)}
                        >
                          {t('Drop')}
                        </Button>
                      </td>
                      <td className="px-1 print:hidden">
                        <RowActions
                          column={c}
                          hide={s.config.HideStructureActions}
                          onKey={(type) => void addKey(type, c)}
                          onCentral={
                            s.features.centralColumns
                              ? (op) => void act(() => api.structureCentralColumns(scope, op, [c.name]))
                              : null
                          }
                          server={server}
                          db={db}
                          table={table}
                        />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-sm print:hidden">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              id="fieldsForm_checkall"
              checked={selected.length === columnNames.length && columnNames.length > 0}
              onChange={(e) => setSelected(e.target.checked ? [...columnNames] : [])}
            />
            {t('Check all')}
          </label>
          <em className="mx-1">{t('With selected:')}</em>
          <Button
            variant="link"
            onClick={() =>
              noneSelected() ||
              void (async () => {
                // pma: Table\Structure\BrowseController — the SELECT runs in the Browse view
                try {
                  const r = await api.structureBrowse(scope, orderedSelection)
                  await navigate({ to: browseLink(server, db, table, r.sql, r.sig) })
                } catch (e) {
                  setMessages([errorMessage(e)])
                }
              })()
            }
          >
            {t('Browse')}
          </Button>
          {editable && (
            <>
              <Button
                variant="link"
                onClick={() =>
                  noneSelected() ||
                  void navigate({
                    to: `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(table)}/structure/change`,
                    // `fields[]=a&fields[]=b` (lib/search.ts): a repeated plain key keeps its last value
                    search: { fields: orderedSelection } as never,
                  })
                }
              >
                {t('Change')}
              </Button>
              <Button
                variant="link"
                onClick={() =>
                  noneSelected() ||
                  setConfirm({
                    // pma: DropColumnConfirmationController (table/structure/drop_confirm.twig)
                    heading: t('Dropping columns from the table'),
                    question: t('Do you really want to execute the following query?'),
                    sql: `ALTER TABLE \`${table}\`\n${orderedSelection.map((f) => `  DROP \`${f}\``).join(',\n')};`,
                    run: async () => {
                      await act(() => api.dropColumns(scope, { columns: orderedSelection, source: 'bulk' }))
                    },
                    // pma: DropColumnController (mult_btn ≠ Yes)
                    no: () => setMessages([{ type: 'success', text: t('No change') }]),
                  })
                }
              >
                {t('Drop')}
              </Button>
              {s.engine !== 'ARCHIVE' &&
                (['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT'] as const).map((k) => (
                  <Button key={k} variant="link" onClick={() => void bulkKey(k)}>
                    {t(
                      k === 'PRIMARY'
                        ? 'Primary'
                        : k === 'UNIQUE'
                          ? 'Unique'
                          : k === 'INDEX'
                            ? 'Index'
                            : k === 'SPATIAL'
                              ? 'Spatial'
                              : 'Fulltext',
                    )}
                  </Button>
                ))}
              {s.engine !== 'ARCHIVE' &&
                s.features.centralColumns &&
                (['add', 'remove'] as const).map((op) => (
                  <Button
                    key={op}
                    variant="link"
                    onClick={() =>
                      noneSelected() ||
                      void act(() => api.structureCentralColumns(scope, op, orderedSelection))
                    }
                  >
                    {op === 'add' ? t('Add to central columns') : t('Remove from central columns')}
                  </Button>
                ))}
            </>
          )}
        </div>
      </form>
      <hr className="my-3 border-border print:hidden" />

      <div id="structure-action-links" className="mb-3 flex flex-wrap gap-3 text-sm print:hidden">
        {s.links.editView && (
          <Link to="/s/$server/db/$db/view/create" params={{ server, db }} search={{ table }}>
            {t('Edit view')}
          </Link>
        )}
        <Button variant="link" className="jsPrintButton" onClick={() => window.print()}>
          {t('Print')}
        </Button>
        {editable && s.links.proposeTableStructure !== null && (
          <Link
            to={
              s.links.proposeSig === undefined
                ? sqlLink(server, s.links.proposeTableStructure)
                : `/s/${server}/db/${encodeURIComponent(db)}/sql?sql=${encodeURIComponent(s.links.proposeTableStructure)}&sig=${encodeURIComponent(s.links.proposeSig)}`
            }
          >
            {t('Propose table structure')}
          </Link>
        )}
        {editable && (
          <>
            {s.links.trackTable && (
              <Link to="/s/$server/db/$db/t/$table/tracking" params={{ server, db, table }}>
                {t('Track table')}
              </Link>
            )}
            <Button variant="link" id="move_columns_anchor" onClick={() => setMoving([...columnNames])}>
              {t('Move columns')}
            </Button>
            <Link to="/s/$server/db/$db/t/$table/normalization" params={{ server, db, table }}>
              {t('Normalize')}
            </Link>
            <Link to={sqlLink(server, `SHOW CREATE TABLE \`${db}\`.\`${table}\``)}>{t('Show create')}</Link>
          </>
        )}
        {s.isView && !s.isSystemSchema && s.links.trackTable && (
          <Link to="/s/$server/db/$db/t/$table/tracking" params={{ server, db, table }}>
            {t('Track view')}
          </Link>
        )}
      </div>

      {editable && (
        <form
          id="addColumns"
          className="mb-3 flex flex-wrap items-center gap-1 text-sm print:hidden"
          onSubmit={(e) => {
            e.preventDefault()
            const where = afterField === 'first' ? 'first' : 'after'
            void navigate({
              to: `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(table)}/structure/add?num=${Math.max(1, addCount)}&where=${where}&after=${encodeURIComponent(afterField)}`,
            })
          }}
        >
          {t('Add %s column(s)').split('%s')[0]}
          <input
            type="number"
            name="num_fields"
            min={1}
            required
            aria-label={t('Add column')}
            className="input w-16"
            value={addCount}
            onChange={(e) => setAddCount(Number(e.target.value))}
          />
          {t('Add %s column(s)').split('%s')[1]}
          <select
            name="after_field"
            aria-label={t('after %s', '')}
            className="input w-auto"
            value={afterField}
            onChange={(e) => setAfter(e.target.value)}
          >
            <option value="first">{t('at beginning of table')}</option>
            {columnNames.map((n) => (
              <option key={n} value={n}>
                {t('after %s', n)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary">
            {t('Go')}
          </Button>
        </form>
      )}

      {s.showIndexes && (
        <Panel
          id="index_div"
          title={
            <>
              {t('Indexes')} <MySqlDocLink link="optimizing-database-structure" />
            </>
          }
          footer={
            // pma: indexes.ts (.add_index click) → checkFormElementInRange(form, 'added_fields', …): the
            // click handler runs before the browser's own validation
            <form
              className="flex items-center gap-1 text-sm"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                const n = Number.parseInt(indexCount, 10)
                if (Number.isNaN(n)) return void window.alert(t('Please enter a valid number!'))
                if (n < 0) return void window.alert(t('Column count has to be larger than zero.'))
                setIndexCount(String(n))
                setIndexQuery({ create: n })
              }}
            >
              {t('Create an index on %s columns').split('%s')[0]}
              <input
                type="number"
                className="input mx-2 w-16"
                min={1}
                max={16}
                required
                name="added_fields"
                value={indexCount}
                onChange={(e) => setIndexCount(e.target.value)}
              />
              {t('Create an index on %s columns').split('%s')[1]}
              <Button type="submit" variant="primary" className="add_index">
                {t('Go')}
              </Button>
            </form>
          }
        >
          <PanelBody>
            <div className="index_info">
              {s.indexes.length === 0 ? (
                <div className="no_indexes_defined">
                  <MessageBox type="notice">{t('No index defined!')}</MessageBox>
                </div>
              ) : (
                <>
                  {s.indexNotices.map((n) => (
                    <MessageBox type="notice" key={n}>
                      {n}
                    </MessageBox>
                  ))}
                  <table id="table_index" className="mt-2 w-auto text-sm">
                    <thead>
                      <tr className="bg-grid-header text-left">
                        <th colSpan={3} className="px-1 print:hidden">
                          {t('Action')}
                        </th>
                        <th className="px-1">{t('Keyname')}</th>
                        <th className="px-1">{t('Type')}</th>
                        <th className="px-1">{t('Unique')}</th>
                        <th className="px-1">{t('Packed')}</th>
                        <th className="px-1">{t('Column')}</th>
                        <th className="px-1">{t('Cardinality')}</th>
                        <th className="px-1">{t('Collation')}</th>
                        <th className="px-1">{t('Null')}</th>
                        <th className="px-1">{t('Comment')}</th>
                      </tr>
                    </thead>
                    {s.indexes.map((index) => (
                      <tbody key={index.name} className="row_span" data-testid={`index-${index.name}`}>
                        {index.columns.map((col, n) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: index parts
                          <tr key={n} className="odd:bg-grid-odd even:bg-grid-even">
                            {n === 0 && (
                              <>
                                <td rowSpan={index.columns.length} className="px-1 print:hidden">
                                  <Button variant="link" onClick={() => setIndexQuery({ index: index.name })}>
                                    {t('Edit')}
                                  </Button>
                                </td>
                                <td rowSpan={index.columns.length} className="px-1 print:hidden">
                                  <Button variant="link" onClick={() => setRenaming(index.name)}>
                                    {t('Rename')}
                                  </Button>
                                </td>
                                <td rowSpan={index.columns.length} className="px-1 print:hidden">
                                  <Button
                                    variant="link"
                                    className="drop_primary_key_index_anchor"
                                    onClick={() => setDropIndex({ sql: index.dropSql, name: index.name })}
                                  >
                                    {t('Drop')}
                                  </Button>
                                </td>
                                <th rowSpan={index.columns.length} className="px-1 text-left">
                                  {index.name}
                                </th>
                                <td rowSpan={index.columns.length} className="px-1">
                                  {index.type}
                                </td>
                                <td rowSpan={index.columns.length} className="px-1">
                                  {index.unique ? t('Yes') : t('No')}
                                </td>
                                <td rowSpan={index.columns.length} className="px-1">
                                  {index.packed}
                                </td>
                              </>
                            )}
                            <td className="px-1">
                              {col.expression ?? col.name}
                              {col.subPart !== null && ` (${col.subPart})`}
                            </td>
                            <td className="px-1">{col.cardinality}</td>
                            <td className="px-1">{col.collation}</td>
                            <td className="px-1">{col.null}</td>
                            {n === 0 && (
                              <td rowSpan={index.columns.length} className="whitespace-pre-line px-1">
                                {index.comments}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </>
              )}
            </div>
          </PanelBody>
        </Panel>
      )}

      {s.partitions.available && <PartitionsCard s={s} scope={scope} act={act} />}

      {s.stats !== null && (
        <Panel id="tablestatistics" title={t('Information')}>
          <PanelBody>
            {s.stats.tableComment !== '' && (
              <div className="mb-2 text-sm">
                <strong>{t('Table comments:')}</strong>
                <em>
                  <pre>{s.stats.tableComment}</pre>
                </em>
              </div>
            )}
            <div className="flex flex-wrap gap-6">
              {s.stats.showSpaceUsage && (
                <table className="text-sm">
                  <caption className="text-left font-semibold">{t('Space usage')}</caption>
                  <tbody>
                    {(
                      [
                        [t('Data'), s.stats.data],
                        [t('Index'), s.stats.index],
                        [t('Overhead'), s.stats.overhead],
                        [t('Effective'), s.stats.overhead === null ? null : s.stats.effective],
                        [t('Total'), s.stats.total],
                      ] as Array<[string, [string, string] | null]>
                    )
                      .filter((r): r is [string, [string, string]] => r[1] !== null)
                      .map(([label, [v, unit]]) => (
                        <tr key={label}>
                          <th className="pr-3 text-left">{label}</th>
                          <td className="text-right">{v}</td>
                          <td className="pl-1">{unit}</td>
                        </tr>
                      ))}
                  </tbody>
                  {s.stats.optimizeSql !== null && (
                    <tfoot className="print:hidden">
                      <tr>
                        <th colSpan={3}>
                          <Link to={sqlLink(server, s.stats.optimizeSql)}>{t('Optimize table')}</Link>
                        </th>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
              <table className="text-sm">
                <caption className="text-left font-semibold">{t('Row statistics')}</caption>
                <tbody>
                  {s.stats.rows.map((r) => (
                    <tr key={r.label}>
                      <th className="pr-3 text-left">{r.label}</th>
                      <td>{r.title !== undefined ? <dfn title={r.title}>{r.value}</dfn> : r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PanelBody>
        </Panel>
      )}

      <Modal
        title={confirm?.heading ?? t('Do you really want to execute the following query?')}
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button
              variant="destructive"
              id="buttonYes"
              onClick={async () => {
                const c = confirm
                setConfirm(null)
                await c?.run()
              }}
            >
              {t('Yes')}
            </Button>
            <Button
              id="buttonNo"
              onClick={() => {
                confirm?.no?.()
                setConfirm(null)
              }}
            >
              {t('No')}
            </Button>
          </>
        }
      >
        {confirm?.heading !== undefined && <p className="mb-2">{confirm.question}</p>}
        <pre className="whitespace-pre-wrap font-mono text-xs text-error" data-testid="confirm-sql">
          {confirm?.sql}
        </pre>
      </Modal>

      <Modal
        id="moveColumnsModal"
        title={t('Move columns')}
        open={moving !== null && preview === null}
        onClose={() => setMoving(null)}
        footer={
          <>
            <Button
              id="designerModalGoButton"
              variant="primary"
              onClick={async () => {
                const order = moving
                setMoving(null)
                if (order === null || order.join('\u0000') === columnNames.join('\u0000')) return
                // pma: structure.ts — a failed move shows #moveColumnsErrorModal
                try {
                  const r = await api.moveColumns(scope, { order })
                  setMessages(r.messages)
                  await refresh()
                } catch (e) {
                  setMoveError(errorMessage(e).text)
                }
              }}
            >
              {t('Go')}
            </Button>
            <Button
              id="designerModalPreviewButton"
              onClick={async () => {
                if (moving === null || moving.join('\u0000') === columnNames.join('\u0000'))
                  return setPreview('')
                try {
                  setPreview((await api.moveColumns(scope, { order: moving, dryRun: true })).preview ?? '')
                } catch (e) {
                  setPreview(errorMessage(e).text)
                }
              }}
            >
              {t('Preview SQL')}
            </Button>
            <Button id="designerModalCloseButton" onClick={() => setMoving(null)}>
              {t('Close')}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm">{t('Move the columns by dragging them up and down.')}</p>
        <ul id="move_column_form">
          {(moving ?? []).map((n, i) => (
            <li key={n} className="flex items-center gap-2 border-b border-border py-0.5 text-sm">
              <button
                type="button"
                aria-label={`${n} ↑`}
                onClick={() => setMoving(swap(moving ?? [], i, i - 1))}
              >
                <ArrowUp className="size-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`${n} ↓`}
                onClick={() => setMoving(swap(moving ?? [], i, i + 1))}
              >
                <ArrowDown className="size-3" aria-hidden />
              </button>
              {n}
            </li>
          ))}
        </ul>
      </Modal>
      <PreviewSqlDialog
        highlight
        sql={preview}
        onClose={() => setPreview(null)}
        // #designerModalPreviewModal: "Go back" to Move columns
        {...(moving !== null ? { onBack: () => setPreview(null) } : {})}
      />
      <PreviewSqlDialog
        highlight
        sql={dropIndex?.sql ?? null}
        onClose={() => setDropIndex(null)}
        onConfirm={async () => {
          const d = dropIndex
          setDropIndex(null)
          if (d === null) return
          const box = showMessage(t('Dropping Primary Key/Index'), false)
          await act(() => api.dropIndex(scope, d.name))
          removeMessage(box)
        }}
      />
      <Modal
        id="moveColumnsErrorModal"
        title={t('Error')}
        open={moveError !== null}
        onClose={() => setMoveError(null)}
        footer={<Button onClick={() => setMoveError(null)}>{t('OK')}</Button>}
      >
        <MessageBox type="error" text={moveError ?? ''} />
      </Modal>
      <IndexDialog
        scope={scope}
        query={indexQuery}
        onClose={() => setIndexQuery(null)}
        onDone={(r) => {
          setIndexQuery(null)
          setMessages(r.messages)
          void refresh()
        }}
      />
      <RenameIndexDialog
        scope={scope}
        index={renaming}
        onClose={() => setRenaming(null)}
        onDone={(r) => {
          setRenaming(null)
          setMessages(r.messages)
          void refresh()
        }}
      />
    </div>
  )
}

function swap<T>(xs: T[], i: number, j: number): T[] {
  if (j < 0 || j >= xs.length) return xs
  const out = [...xs]
  const a = out[i] as T
  out[i] = out[j] as T
  out[j] = a
  return out
}

/** The "More" group of a column row (HideStructureActions → dropdown, else inline). */
function RowActions({
  column,
  hide,
  onKey,
  onCentral,
  server,
  db,
  table,
}: {
  column: Column
  hide: boolean
  onKey: (type: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'SPATIAL' | 'FULLTEXT') => void
  /** null without the central columns feature */
  onCentral: ((op: 'add' | 'remove') => void) | null
  server: number
  db: string
  table: string
}) {
  const items = (
    <ul
      className={
        hide
          ? 'absolute right-0 z-10 min-w-40 rounded border border-border bg-bg-elevated p-1 shadow'
          : 'flex gap-1'
      }
    >
      {(
        [
          ['PRIMARY', t('Primary'), column.actions.primary, 'add_primary_key_anchor'],
          ['UNIQUE', t('Unique'), column.actions.unique, 'add_unique_anchor'],
          ['INDEX', t('Index'), column.actions.index, 'add_index_anchor'],
          ['SPATIAL', t('Spatial'), column.actions.spatial, 'add_spatial_anchor'],
          ['FULLTEXT', t('Fulltext'), column.actions.fulltext, 'add_fulltext_anchor'],
        ] as const
      ).map(([type, label, enabled, cls]) => (
        <li key={type} className="whitespace-nowrap">
          {enabled ? (
            <Button variant="link" className={`add_key ${cls}`} onClick={() => onKey(type)}>
              {label}
            </Button>
          ) : (
            <span className="px-1 text-fg-subtle" aria-disabled="true">
              {label}
            </span>
          )}
        </li>
      ))}
      <li className="whitespace-nowrap">
        <Link
          to={
            column.distinctSig === undefined
              ? sqlLink(server, column.distinctSql)
              : browseLink(server, db, table, column.distinctSql, column.distinctSig, true)
          }
          className="px-1"
        >
          {t('Distinct values')}
        </Link>
      </li>
      {onCentral !== null && (
        <li className="browse whitespace-nowrap">
          {column.inCentralList ? (
            <Button variant="link" onClick={() => onCentral('remove')}>
              {t('Remove from central columns')}
            </Button>
          ) : (
            <Button variant="link" onClick={() => onCentral('add')}>
              {t('Add to central columns')}
            </Button>
          )}
        </li>
      )}
    </ul>
  )
  if (!hide) return items
  return (
    <details className="relative">
      <summary id="moreActionsButton" className="cursor-pointer text-accent">
        {t('More')}
      </summary>
      {items}
    </details>
  )
}

function PartitionsCard({
  s,
  scope,
  act,
}: {
  s: StructureResponse
  scope: TableRef
  act: (fn: () => Promise<DdlResponse>) => Promise<DdlResponse | null>
}) {
  const p = s.partitions
  const navigate = useNavigate()
  const sliders = s.config.InitialSlidersState
  const [open, setOpen] = useState(sliders === 'open' || sliders === 'disabled' || p.partitions.length === 0)
  type Op = 'ANALYZE' | 'CHECK' | 'OPTIMIZE' | 'REBUILD' | 'REPAIR' | 'TRUNCATE' | 'DROP'
  const ops: Op[] = [
    'ANALYZE',
    'CHECK',
    'OPTIMIZE',
    'REBUILD',
    'REPAIR',
    'TRUNCATE',
    ...(p.rangeOrList ? (['DROP'] as const) : []),
  ]
  const labels: Record<string, string> = {
    ANALYZE: t('Analyze'),
    CHECK: t('Check'),
    OPTIMIZE: t('Optimize'),
    REBUILD: t('Rebuild'),
    REPAIR: t('Repair'),
    TRUNCATE: t('Truncate'),
    DROP: t('Drop'),
  }
  const run = (operation: Op, partition: string) => {
    const go = () => void act(() => api.partitionMaintenance(scope, { operation, partition }))
    if (operation === 'DROP') {
      if (
        window.confirm(
          t(
            'Do you really want to DROP the selected partition(s)? This will also DELETE the data related to the selected partition(s)!',
          ),
        )
      )
        go()
    } else if (operation === 'TRUNCATE') {
      if (window.confirm(t('Do you really want to TRUNCATE the selected partition(s)?'))) go()
    } else go()
  }
  const editHref = `/s/${scope.server}/db/${encodeURIComponent(scope.db)}/t/${encodeURIComponent(scope.table)}/structure/partitioning`
  const card = (
    <Panel
      id="partitions"
      title={
        <>
          {t('Partitions')} <MySqlDocLink link="partitioning" />
        </>
      }
      footer={
        <div className="flex gap-2 print:hidden">
          {p.partitions.length === 0 ? (
            <Button onClick={() => void navigate({ to: editHref })}>{t('Partition table')}</Button>
          ) : (
            <>
              <Button
                id="remove_partitioning"
                onClick={() => {
                  if (window.confirm(t('Do you really want to remove partitioning?'))) {
                    void act(() => api.removePartitioning(scope))
                  }
                }}
              >
                {t('Remove partitioning')}
              </Button>
              <Button onClick={() => void navigate({ to: editHref })}>{t('Edit partitioning')}</Button>
            </>
          )}
        </div>
      }
    >
      <PanelBody>
        {p.partitions.length === 0 ? (
          <MessageBox type="notice">{t('No partitioning defined!')}</MessageBox>
        ) : (
          <>
            <p className="text-sm">
              {t('Partitioned by:')}{' '}
              <code>
                {p.method}({p.expression})
              </code>
            </p>
            {p.subMethod !== null && (
              <p className="text-sm">
                {t('Sub partitioned by:')}{' '}
                <code>
                  {p.subMethod}({p.subExpression})
                </code>
              </p>
            )}
            <table className="mt-2 text-sm">
              <thead>
                <tr className="bg-grid-header text-left">
                  <th className="px-1">#</th>
                  <th className="px-1">{t('Partition')}</th>
                  {p.hasDescription && <th className="px-1">{t('Expression')}</th>}
                  <th className="px-1">{t('Rows')}</th>
                  <th className="px-1">{t('Data length')}</th>
                  <th className="px-1">{t('Index length')}</th>
                  <th className="px-1">{t('Comment')}</th>
                  <th className="px-1" colSpan={ops.length}>
                    {t('Action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.partitions.map((part) => (
                  <tr key={part.name} data-testid={`partition-${part.name}`}>
                    <td className="px-1">{part.ordinal}</td>
                    <th className="px-1 text-left">{part.name}</th>
                    {p.hasDescription && (
                      <td className="px-1">
                        <code>
                          {part.expression}
                          {part.method === 'LIST' ? ` IN (${part.description})` : ` < ${part.description}`}
                        </code>
                      </td>
                    )}
                    <td className="px-1 text-right">{part.rows}</td>
                    <td className="px-1 text-right">{part.dataLength.join(' ')}</td>
                    <td className="px-1 text-right">{part.indexLength.join(' ')}</td>
                    <td className="px-1">{part.comment}</td>
                    {ops.map((op) => (
                      <td key={op} className="px-1">
                        <Button
                          variant="link"
                          id={`partition_action_${op}`}
                          onClick={() => run(op, part.name)}
                        >
                          {labels[op]}
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </PanelBody>
    </Panel>
  )
  if (p.partitions.length === 0 || sliders === 'disabled') return card
  return (
    <div className="mb-3">
      <Button className="mb-2" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('Partitions')}
      </Button>
      {open && card}
    </div>
  )
}
