import type { Cell, Field, GridCell, GridData, GridRow } from '@bettermyadmin/contracts'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconText,
  NativeSelect,
  PmaIcon,
  Textarea,
  showMessage,
} from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { HighlightedSql } from '../sql/HighlightedSql'
import { renderTransformation } from '../transformations/registry'
import {
  type HeaderLayout,
  clauseOf,
  headerLayout,
  isValidHex,
  prettyJson,
  rewriteCondition,
  rowMatchesFilter,
  truncateForDisplay,
} from './logic'

export interface GridActions {
  /** a sort / FK / text toggle link of the grid (POST /browse) */
  sort: (sql: string, sig: string, discard: boolean) => void
  toggleText: (pftext: 'P' | 'F') => void
  deleteRow: (row: GridRow) => Promise<boolean>
  followFk: (fk: NonNullable<GridCell['fk']>) => void
}

interface Props {
  server: number
  grid: GridData
  fields: Field[]
  raw: Cell[][]
  filter: string
  checked: ReadonlySet<number>
  onChecked: (next: Set<number>) => void
  actions: GridActions
  /** rows changed by grid editing / deletion (for Copy to clipboard and the bulk bar) */
  onRows: (rows: GridRow[]) => void
  /** "Save edited data" / "Restore column order" live in the navigation bar */
  onPendingChange: (n: number, save: () => void) => void
  onRestoreChange: (visible: boolean, restore: () => void) => void
  versionInt: number
}

const MSG = {
  editClick: 'You can also edit most values by clicking directly on them.',
  editDblClick: 'You can also edit most values by double-clicking directly on them.',
  nonUnique:
    'This table does not contain a unique column. Features related to the grid edit, checkbox, Edit, Copy and Delete links may not work after saving.',
  sortHint: 'Click to sort results by this column.',
  multiSortHint:
    'Shift+Click to add this column to ORDER BY clause or to toggle ASC/DESC.<br>- Ctrl+Click or Alt+Click (Mac: Shift+Option+Click) to remove column from ORDER BY clause',
  cellEditHint: 'Press escape to cancel editing.<br>- Shift+Enter for a newline.',
}

const hasClass = (cls: string, c: string) => cls.split(/\s+/).includes(c)

/** Core::mimeDefaultFunction as React: newlines → <br>, double spaces → space + nbsp. */
function MimeText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines
        <Fragment key={i}>
          {i > 0 && <br />}
          {l.replaceAll('  ', '  ')}
        </Fragment>
      ))}
    </>
  )
}

/** The raw text of a cell for the editor (getCellValue). */
function rawText(c: Cell | undefined, field: Field | undefined): string {
  if (c === null || c === undefined) return ''
  if (typeof c === 'string') return c
  const bin = atob(c.b64)
  let hex = ''
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
  if (field?.mappedType === 'bit') {
    return [...hex]
      .map((h) => Number.parseInt(h, 16).toString(2).padStart(4, '0'))
      .join('')
      .replace(/^0+(?=.)/, '')
  }
  return hex
}

function ActionLink(props: {
  mode: string
  icon: 'b_edit' | 'b_insrow' | 'b_drop'
  text: string
}) {
  const m = props.mode === 'icons' || props.mode === 'text' ? props.mode : 'both'
  return <IconText icon={props.icon} text={props.text} modeValue={m} />
}

interface EditState {
  r: number
  /** position in the server's column order */
  p: number
}

/**
 * The results table: headers with sort links and comments, row actions, cells, grid editing,
 * column reorder / visibility, row and column marking.
 * pma: resources/templates/display/results/table.twig, resources/js/makegrid.ts, resources/js/sql.ts
 */
export function GridTable(props: Props) {
  const { grid, server, actions } = props
  const s = grid.settings
  const layout: HeaderLayout = headerLayout(grid.displayParts, s.RowActionLinks)
  const [rows, setRows] = useState<GridRow[]>(grid.rows)
  const [raw, setRaw] = useState<Cell[][]>(props.raw)
  const n = grid.columns.length
  const [order, setOrder] = useState<number[]>(() => grid.columns.map((_, i) => i))
  const [visib, setVisib] = useState<boolean[]>(() => grid.columns.map((c) => !c.hidden))
  const [markedCols, setMarkedCols] = useState<ReadonlySet<number>>(new Set())
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [pending, setPending] = useState<Map<string, { value: string | null; type: string }>>(new Map())
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const lastChecked = useRef<number | null>(null)
  const canReorder = grid.navigation !== null && n > 1
  const visibleCount = visib.filter(Boolean).length

  useEffect(() => {
    setRows(grid.rows)
    setRaw(props.raw)
    setOrder(grid.columns.map((_, i) => i))
    setVisib(grid.columns.map((c) => !c.hidden))
    setPending(new Map())
    setEditing(null)
  }, [grid, props.raw])

  // makegrid sendColPrefs
  const sendColPrefs = (nextOrder: number[], nextVisib: boolean[]) => {
    const co = grid.columnOrder
    if (co === null || grid.table === '') return
    void api
      .columnPrefs(
        { server, db: grid.db, table: grid.table },
        {
          col_order: nextOrder.map((p) => grid.columns[p]!.index).join(','),
          col_visib: nextOrder.map((p) => (nextVisib[p] ? 1 : 0)).join(','),
          ...(co.isView ? {} : { table_create_time: co.createTime }),
        },
      )
      .catch((e: Error) => showMessage(e.message, false, 'error'))
  }

  const isNatural = order.every((p, i) => grid.columns[p]!.index === i)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on order/visibility changes
  useEffect(() => {
    props.onRestoreChange(!isNatural && visibleCount > 1, () => {
      const natural = grid.columns
        .map((_, i) => i)
        .sort((a, b) => grid.columns[a]!.index - grid.columns[b]!.index)
      setOrder(natural)
      sendColPrefs(natural, visib)
    })
  }, [isNatural, visibleCount, order, visib])

  const moveColumn = (from: number, to: number) => {
    if (from === to) return
    const next = [...order]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m!)
    setOrder(next)
    sendColPrefs(next, visib)
  }
  const toggleColumn = (p: number) => {
    if (visib[p] && visibleCount === 1) return
    const next = visib.map((v, i) => (i === p ? !v : v))
    setVisib(next)
    sendColPrefs(order, next)
  }
  const showAllColumns = () => {
    const next = visib.map(() => true)
    setVisib(next)
    sendColPrefs(order, next)
  }

  const fieldOf = (p: number) => props.fields[grid.columns[p]!.index]

  // grid editing ------------------------------------------------------------------------------
  const postEdits = async (edits: Map<string, { value: string | null; type: string }>) => {
    if (edits.size === 0) return
    const byRow = new Map<number, Array<{ p: number; value: string | null; type: string }>>()
    for (const [k, v] of edits) {
      const [r, p] = k.split(':').map(Number) as [number, number]
      if (!byRow.has(r)) byRow.set(r, [])
      byRow.get(r)!.push({ p, ...v })
    }
    const isUnique = rows.every((row) => row.unique)
    if (!isUnique) window.alert(t(MSG.nonUnique))
    try {
      const res = await api.gridSave(server, {
        db: grid.db,
        table: grid.table,
        clauseIsUnique: isUnique,
        relationalDisplay: grid.view.relationalDisplay,
        rows: [...byRow].map(([r, cells]) => ({
          where: rows[r]!.where,
          fields: cells.map((c) => ({
            name: grid.columns[c.p]!.name,
            value: c.value ?? '',
            isNull: c.value === null,
            type: c.type,
          })),
        })),
      })
      if (!res.success) {
        showMessage(res.message, false, 'error')
        if (!s.SaveCellsAtOnce) setPending(new Map())
        return
      }
      showMessage(res.message)
      const nextRows = [...rows]
      const nextRaw = raw.map((r) => [...r])
      for (const [r, cells] of byRow) {
        let row = { ...nextRows[r]!, cells: [...nextRows[r]!.cells] }
        let cond = row.cond
        for (const c of cells) {
          const shown =
            c.value === null ? null : cells.length === 1 && res.recheck !== undefined ? res.recheck : c.value
          const old = row.cells[c.p]!
          const cls = old.cls
            .replace(/\bnull\b/, '')
            .replace(/\btruncated\b/, '')
            .trim()
          row.cells[c.p] =
            shown === null
              ? { k: 'null', cls: `${cls} null` }
              : {
                  ...old,
                  k: shown === '' ? 'empty' : 'v',
                  cls,
                  t: hasClass(old.cls, 'hex')
                    ? shown
                    : truncateForDisplay(shown, grid.view.pftext, s.LimitChars),
                }
          nextRaw[r]![grid.columns[c.p]!.index] = shown
          if (row.where.includes(grid.columns[c.p]!.name)) {
            cond = rewriteCondition(cond, grid.table, grid.columns[c.p]!.name, shown)
          }
        }
        if (cond !== row.cond) row = { ...row, cond, where: clauseOf(cond) }
        nextRows[r] = row
      }
      setRows(nextRows)
      setRaw(nextRaw)
      props.onRows(nextRows)
      setPending(new Map())
    } catch (e) {
      showMessage((e as Error).message, false, 'error')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the save closure follows the pending edits
  useEffect(() => {
    props.onPendingChange(pending.size, () => void postEdits(pending))
  }, [pending, rows])

  // leaving the page with unsaved edits (makegrid isCellEdited)
  useEffect(() => {
    if (pending.size === 0) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [pending])

  const commitEdit = (e: EditState, value: string | null, type: string, changed: boolean) => {
    setEditing(null)
    if (!changed) return
    const next = new Map(pending)
    next.set(`${e.r}:${e.p}`, { value, type })
    if (s.SaveCellsAtOnce) setPending(next)
    else void postEdits(next)
  }

  const startEdit = (r: number, p: number) => {
    const cell = rows[r]?.cells[p]
    if (cell === undefined || !hasClass(cell.cls, 'grid_edit')) return
    setEditing({ r, p })
  }

  // row marking ---------------------------------------------------------------------------------
  const toggleRow = (r: number, shift: boolean) => {
    const next = new Set(props.checked)
    const on = !next.has(r)
    if (shift && lastChecked.current !== null) {
      const [a, b] = [Math.min(lastChecked.current, r), Math.max(lastChecked.current, r)]
      for (let i = a; i <= b; i++) {
        if (on) next.add(i)
        else next.delete(i)
      }
    } else if (on) next.add(r)
    else next.delete(r)
    lastChecked.current = r
    props.onChecked(next)
  }

  const visibleRows = useMemo(
    () =>
      rows.map((row) =>
        props.filter === ''
          ? true
          : rowMatchesFilter(
              row.cells.map((c) => (c.k === 'null' ? 'NULL' : (c.t ?? ''))).join(' '),
              props.filter,
            ),
      ),
    [rows, props.filter],
  )

  const actionCells = (row: GridRow, r: number, side: 'left' | 'right'): ReactNode[] => {
    const out: ReactNode[] = []
    const checkbox = grid.displayParts.deleteLink === 'delete' && (
      <td key="cb" className="text-center d-print-none">
        <input
          type="checkbox"
          className="multi_checkbox checkall"
          id={`id_rows_to_delete${r}_${side === 'right' ? 'right' : 'left'}`}
          name={`rows_to_delete[${r}]`}
          value={row.where}
          checked={props.checked.has(r)}
          onChange={() => {}}
          onClick={(e) => toggleRow(r, e.shiftKey)}
        />
      </td>
    )
    const editSearch = (action: 'update' | 'insert') => ({
      where: row.where,
      sig: row.whereSig,
      unique: row.unique ? '1' : '0',
      action,
      sql: grid.sql,
    })
    const edit = grid.displayParts.editLink && (
      <td
        key="edit"
        className={`text-center d-print-none edit_row_anchor${row.unique ? '' : ' nonunique'}`}
        data-grid-edit-config={grid.gridEdit}
      >
        <Link
          to="/s/$server/db/$db/t/$table/$"
          params={{ server, db: grid.db, table: grid.table, _splat: 'edit' }}
          search={editSearch('update') as never}
          {...(grid.gridEdit !== 'disabled'
            ? { title: t(grid.gridEdit === 'click' ? MSG.editClick : MSG.editDblClick) }
            : {})}
        >
          <ActionLink mode={s.RowActionType} icon="b_edit" text={t('Edit')} />
        </Link>
      </td>
    )
    const copy = grid.displayParts.editLink && (
      <td key="copy" className="text-center d-print-none">
        <Link
          to="/s/$server/db/$db/t/$table/$"
          params={{ server, db: grid.db, table: grid.table, _splat: 'edit' }}
          search={editSearch('insert') as never}
        >
          <ActionLink mode={s.RowActionType} icon="b_insrow" text={t('Copy')} />
        </Link>
      </td>
    )
    const del = (row.del !== undefined || row.kill !== undefined) && (
      <td key="del" className="text-center d-print-none ajax">
        <Button
          variant="link"
          size="sm"
          className="delete_row requireConfirm ajax"
          onClick={() => {
            void actions.deleteRow(row).then((ok) => {
              if (!ok) return
              const next = rows.filter((x) => x !== row)
              setRows(next)
              props.onRows(next)
            })
          }}
        >
          {row.kill !== undefined ? (
            <IconText icon="b_drop" text={t('Kill')} />
          ) : (
            <ActionLink mode={s.RowActionType} icon="b_drop" text={t('Delete')} />
          )}
        </Button>
      </td>
    )
    if (layout.checkboxOnly) {
      if (checkbox) out.push(checkbox)
      return out
    }
    const list = side === 'left' ? [checkbox, edit, copy, del] : [del, copy, edit, checkbox]
    for (const x of list) if (x) out.push(x)
    return out
  }

  const toggleLink = grid.textToggle !== null && (
    <Button variant="link" size="sm" onClick={() => actions.toggleText(grid.textToggle!.pftext)}>
      <PmaIcon
        name={grid.textToggle.pftext === 'F' ? 's_fulltext' : 's_partialtext'}
        alt={t(grid.textToggle.title)}
      />
    </Button>
  )
  const colDrop = n > 1 && (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="coldrop ms-1"
        aria-label={t("Click the drop-down arrow to toggle column's visibility.")}
      >
        <ChevronDown className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="cList">
        {n > 10 && (
          <Button size="sm" variant="link" onClick={showAllColumns}>
            {t('Show all')}
          </Button>
        )}
        {order.map((p) => (
          <label key={p} className="flex items-center gap-1 px-1 text-[13px]">
            <input
              type="checkbox"
              checked={visib[p]}
              disabled={visib[p] && visibleCount === 1}
              onChange={() => toggleColumn(p)}
            />
            {grid.columns[p]!.name}
          </label>
        ))}
        <Button size="sm" variant="link" onClick={showAllColumns}>
          {t('Show all')}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const header = (repeat: boolean) => (
    <tr className={repeat ? 'repeating_header_row' : undefined}>
      {repeat ? (
        layout.emptyBefore > 0 ? (
          <th colSpan={layout.emptyBefore}>&nbsp;</th>
        ) : s.RowActionLinks === 'none' ? (
          <th />
        ) : null
      ) : layout.before === 'toggle' ? (
        <th className="column_action d-print-none" colSpan={layout.colspan}>
          {toggleLink}
          {colDrop}
        </th>
      ) : layout.before === 'empty-td' ? (
        <td colSpan={layout.colspan} />
      ) : layout.before === 'empty-th' ? (
        <th className="column_action">{colDrop}</th>
      ) : null}
      {order.map((p, j) => {
        const c = grid.columns[p]!
        const sortable = c.sort !== null
        const cls = [
          'draggable',
          c.numeric ? 'text-end' : '',
          visib[p] ? '' : 'hide',
          sortable ? 'column_heading' : '',
          sortable && s.BrowseMarkerEnable ? 'marker' : '',
          sortable && s.BrowsePointerEnable ? 'pointer' : '',
          !sortable && c.condition ? 'condition' : '',
          markedCols.has(p) ? 'marked' : '',
        ]
          .filter((x) => x !== '')
          .join(' ')
        const comment =
          c.comment === null ? null : (
            <>
              <br />
              <small className="text-fg-subtle" title={c.comment}>
                {Array.from(c.comment).length > s.LimitChars
                  ? `${Array.from(c.comment).slice(0, s.LimitChars).join('')}…`
                  : c.comment}
              </small>
            </>
          )
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: column marking is a pointer feature (sql.ts)
          <th
            key={p}
            className={cls}
            data-column={c.name}
            draggable={!repeat && canReorder && visibleCount > 1}
            onDragStart={() => setDragFrom(j)}
            onDragOver={(e) => dragFrom !== null && e.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null) moveColumn(dragFrom, j)
              setDragFrom(null)
            }}
            onMouseEnter={() => sortable && s.BrowsePointerEnable && setHoverCol(p)}
            onMouseLeave={() => setHoverCol(null)}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button') !== null) return
              if (sortable && s.BrowseMarkerEnable) {
                const next = new Set(markedCols)
                if (next.has(p)) next.delete(p)
                else next.add(p)
                setMarkedCols(next)
              }
            }}
            onDoubleClick={() => {
              void navigator.clipboard?.writeText(c.name).then(
                () => showMessage(t('Column name successfully copied to clipboard!')),
                () => showMessage(t('Copying failed!'), false, 'error'),
              )
            }}
            title={canReorder && !sortable ? t('Drag to reorder.') : undefined}
          >
            {sortable ? (
              <Button
                variant="link"
                size="sm"
                className="sortlink h-auto"
                title={`${t(MSG.sortHint)}\n${t(MSG.multiSortHint).replace('<br>', '\n')}`}
                onClick={(e) => {
                  const sort = c.sort!
                  if (e.ctrlKey || e.altKey)
                    actions.sort(sort.remove.sql, sort.remove.sig, sort.remove.discard)
                  else if (e.shiftKey) actions.sort(sort.add.sql, sort.add.sig, false)
                  else actions.sort(sort.single.sql, sort.single.sig, false)
                }}
              >
                {c.name}
                {c.sort!.dir !== null && (
                  <>
                    {' '}
                    <PmaIcon
                      name={c.sort!.dir === 'DESC' ? 's_desc' : 's_asc'}
                      alt={t(c.sort!.dir === 'DESC' ? 'Descending' : 'Ascending')}
                      className="soimg"
                    />{' '}
                    <small>{c.sort!.position}</small>
                  </>
                )}
              </Button>
            ) : (
              c.name
            )}
            {comment}
          </th>
        )
      })}
      {repeat ? (
        layout.emptyAfter > 0 ? (
          <th colSpan={layout.emptyAfter}>&nbsp;</th>
        ) : null
      ) : layout.after === 'toggle' ? (
        <th className="column_action d-print-none" colSpan={layout.colspan}>
          {toggleLink}
        </th>
      ) : layout.after === 'empty-td' ? (
        <td className="d-print-none" colSpan={layout.colspan} />
      ) : null}
    </tr>
  )

  const trClass = [s.BrowsePointerEnable ? '' : 'nopointer', s.BrowseMarkerEnable ? '' : 'nomarker']
    .filter((x) => x !== '')
    .join(' ')

  return (
    <div className="table-responsive-md relative overflow-x-auto">
      <table className="table_results data ajax w-auto" data-uniqueid="grid">
        <thead>{header(false)}</thead>
        <tbody>
          {rows.map((row, r) => {
            const rc = [trClass, props.checked.has(r) ? 'marked table-active' : '']
              .filter((x) => x !== '')
              .join(' ')
            return (
              <Fragment key={`${r}-${row.whereSig}`}>
                {r !== 0 && grid.view.repeatCells > 0 && r % grid.view.repeatCells === 0 && header(true)}
                <tr className={rc || undefined} style={visibleRows[r] ? undefined : { display: 'none' }}>
                  {(layout.left || layout.checkboxOnly) && actionCells(row, r, 'left')}
                  {order.map((p) => {
                    const cell = row.cells[p]!
                    const col = grid.columns[p]!
                    const key = `${r}:${p}`
                    const edited = pending.get(key)
                    const cls = [
                      cell.cls,
                      visib[p] ? '' : 'hide',
                      hoverCol === p ? 'hover' : '',
                      markedCols.has(p) ? 'marked' : '',
                      edited !== undefined ? 'to_be_saved' : '',
                    ]
                      .filter((x) => x !== '')
                      .join(' ')
                    const isEditing = editing?.r === r && editing.p === p
                    return (
                      <td
                        key={p}
                        className={`${cls} relative`}
                        data-decimals={col.decimals}
                        data-type={col.dataType}
                        {...(cell.ol !== undefined ? { 'data-originallength': cell.ol } : {})}
                        onClick={() => grid.gridEdit === 'click' && startEdit(r, p)}
                        onDoubleClick={() => grid.gridEdit === 'double-click' && startEdit(r, p)}
                      >
                        <span {...(cell.ol !== undefined ? { title: `Original length ${cell.ol}` } : {})}>
                          {edited !== undefined ? (
                            edited.value === null ? (
                              <em>NULL</em>
                            ) : (
                              <MimeText
                                text={truncateForDisplay(edited.value, grid.view.pftext, s.LimitChars)}
                              />
                            )
                          ) : (
                            <CellContent
                              cell={cell}
                              server={server}
                              grid={grid}
                              versionInt={props.versionInt}
                              onFk={(fk) => {
                                if (grid.gridEdit === 'click' && hasClass(cell.cls, 'grid_edit'))
                                  startEdit(r, p)
                                else actions.followFk(fk)
                              }}
                            />
                          )}
                        </span>
                        {isEditing && (
                          <CellEditor
                            server={server}
                            grid={grid}
                            row={row}
                            cell={cell}
                            column={col}
                            raw={edited !== undefined ? edited.value : (raw[r]?.[col.index] ?? null)}
                            field={fieldOf(p)}
                            onDone={(v, type, changed) => commitEdit({ r, p }, v, type, changed)}
                            onCancel={() => setEditing(null)}
                          />
                        )}
                      </td>
                    )
                  })}
                  {layout.right && actionCells(row, r, 'right')}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A cell of a column with a browser display transformation (Results::applyTransformation). */
function GridTransformed({
  tf,
  server,
  versionInt,
}: { tf: NonNullable<GridCell['tf']>; server: number; versionInt: number }) {
  const bytes = Uint8Array.from(atob(tf.b64), (c) => c.charCodeAt(0))
  return renderTransformation(
    {
      mimetype: tf.mimetype,
      transformation: tf.file,
      transformationOptions: tf.options,
      inputTransformation: '',
      inputTransformationOptions: [],
    },
    tf.isBinary ? bytes : new TextDecoder().decode(bytes),
    { server, db: tf.db, table: tf.table, column: tf.column, where: { clause: tf.where, sig: tf.sig } },
    { isInt: tf.isInt, isBinary: tf.isBinary },
    versionInt,
  )
}

function CellContent({
  cell,
  server,
  grid,
  versionInt,
  onFk,
}: {
  cell: GridCell
  server: number
  grid: GridData
  versionInt: number
  onFk: (fk: NonNullable<GridCell['fk']>) => void
}) {
  if (cell.k === 'null') return <em>NULL</em>
  if (cell.k === 'empty') return null
  if (cell.tf !== undefined) return <GridTransformed tf={cell.tf} server={server} versionInt={versionInt} />
  const text = cell.t ?? ''
  if (cell.fk !== undefined) {
    const fk = cell.fk
    return (
      <Link
        to="/s/$server/db/$db/t/$table/browse"
        params={{ server, db: fk.db, table: fk.table }}
        search={{ sql: fk.sql, sig: fk.sig, pos: 0 } as never}
        title={fk.title}
        className={`text-accent hover:underline${hasClass(cell.cls, 'grid_edit') ? ' ajax' : ''}`}
        onClick={(e) => {
          e.preventDefault()
          onFk(fk)
        }}
      >
        {fk.nullDisplay === true ? <em>NULL</em> : <MimeText text={text} />}
      </Link>
    )
  }
  if (cell.dl !== undefined) {
    return (
      <a
        className="disableAjax"
        href={api.gridFieldUrl(server, {
          db: grid.db,
          table: cell.dl.table,
          where: cell.dl.where,
          sig: cell.dl.sig,
          key: cell.dl.key,
        })}
      >
        {text}
      </a>
    )
  }
  if (cell.code === 'sql') return <HighlightedSql sql={text} versionInt={versionInt} />
  if (cell.code === 'json') {
    return (
      <pre>
        <code className="json">{text}</code>
      </pre>
    )
  }
  return <MimeText text={text} />
}

/**
 * The cell editor (makegrid showEditCell / showEditArea / saveEditedCell): text box, NULL checkbox,
 * ENUM / SET / relational value lists, full value of truncated cells.
 */
function CellEditor(props: {
  server: number
  grid: GridData
  row: GridRow
  cell: GridCell
  column: GridData['columns'][number]
  raw: Cell
  field: Field | undefined
  onDone: (value: string | null, type: string, changed: boolean) => void
  onCancel: () => void
}) {
  const { grid, cell, column, server } = props
  const isNull = cell.k === 'null'
  const initial = isNull ? '' : rawText(props.raw, props.field)
  const [value, setValue] = useState(column.dataType === 'json' ? prettyJson(initial) : initial)
  const [nullChecked, setNullChecked] = useState(isNull)
  const [original, setOriginal] = useState<string>(initial)
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [browseForeign, setBrowseForeign] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // the cursor goes to the end of the value (showEditCell)
  useEffect(() => {
    const b = boxRef.current
    if (b === null) return
    b.focus()
    b.setSelectionRange(b.value.length, b.value.length)
  }, [])
  const isSet = hasClass(cell.cls, 'set')
  const isEnum = hasClass(cell.cls, 'enum')
  const isRelation = hasClass(cell.cls, 'relation')
  const isHex = hasClass(cell.cls, 'hex')
  const isBit = hasClass(cell.cls, 'bit')
  const textarea = ['string', 'blob', 'json'].includes(column.dataType)
  const notNull = hasClass(cell.cls, 'not_null')

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once per opened editor
  useEffect(() => {
    const base = { db: grid.db, table: grid.table, column: column.name }
    if (isRelation || isEnum || isSet) {
      setLoading(true)
      void api
        .gridValues(server, {
          ...base,
          kind: isRelation ? 'relational' : isEnum ? 'enum' : 'set',
          currValue: isNull ? '' : (cell.t ?? ''),
          ...(isSet && hasClass(cell.cls, 'truncated') ? { where: props.row.where } : {}),
          ...(isRelation
            ? { keyOrDisplay: cell.fk?.title ?? '', relationalDisplay: grid.view.relationalDisplay }
            : {}),
        })
        .then((r) => {
          setOptions(r.options)
          setSelected(r.selected)
          setBrowseForeign(r.browseForeign === true)
          if (isSet) setOriginal(r.selected.join(','))
        })
        .catch((e: Error) => showMessage(e.message, false, 'error'))
        .finally(() => setLoading(false))
    } else if (hasClass(cell.cls, 'truncated') || hasClass(cell.cls, 'transformed')) {
      setLoading(true)
      void api
        .gridValue(server, { ...base, where: props.row.where })
        .then((r) => {
          const v = r.value ?? ''
          setOriginal(v)
          setValue(column.dataType === 'json' ? prettyJson(v) : v)
        })
        .catch((e: Error) => showMessage(e.message, false, 'error'))
        .finally(() => setLoading(false))
    }
  }, [])

  const save = () => {
    if (loading) return
    if (nullChecked) {
      props.onDone(null, '', !isNull)
      return
    }
    let v = value
    if (isSet) v = selected.join(',')
    if (isHex && !isValidHex(v)) {
      showMessage(
        t('Please enter a valid hexadecimal string. Valid characters are 0-9, A-F.'),
        false,
        'error',
      )
      props.onCancel()
      return
    }
    const changed =
      isNull || (column.dataType === 'json' ? prettyJson(v) !== prettyJson(original) : v !== original)
    props.onDone(v, isBit ? 'bit' : isHex ? 'hex' : '', changed)
  }

  // click outside saves (hideEditCell)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) save()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onCancel()
    } else if (e.key === 'Enter' && !(textarea && e.shiftKey)) {
      e.preventDefault()
      save()
    }
  }
  const box = textarea ? (
    <Textarea
      className="edit_box"
      ref={boxRef as never}
      value={value}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        setValue(e.target.value)
        if (e.target.value !== '') setNullChecked(false)
        else if (!notNull) setNullChecked(true)
      }}
    />
  ) : (
    <input
      className="edit_box input"
      ref={boxRef as never}
      value={value}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        setValue(e.target.value)
        if (e.target.value !== '') setNullChecked(false)
        else if (!notNull) setNullChecked(true)
      }}
    />
  )
  return (
    <div
      ref={ref}
      className="cEdit start-0 top-0"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {box}
      <div className="edit_area">
        {cell.fk !== undefined && (
          <div className="goto_link">
            {t('Go to link:')} <span>{cell.t}</span>
          </div>
        )}
        {!notNull && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              className="null_div"
              checked={nullChecked}
              onChange={(e) => {
                setNullChecked(e.target.checked)
                if (e.target.checked) {
                  setValue('')
                  setSelected([])
                }
              }}
            />
            NULL
          </label>
        )}
        {loading && <span className="text-fg-subtle">{t('Loading…')}</span>}
        {options !== null && !browseForeign && (
          <NativeSelect
            multiple={isSet}
            size={isSet ? Math.min(options.length, 10) : undefined}
            className={isSet ? 'resize-vertical' : undefined}
            value={isSet ? selected : (selected[0] ?? '')}
            onChange={(e) => {
              if (isSet) {
                const vals = [...e.target.selectedOptions].map((o) => o.value)
                setSelected(vals)
                setValue(vals.join(','))
              } else {
                setSelected([e.target.value])
                setValue(e.target.value)
              }
              setNullChecked(false)
            }}
          >
            {options.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: separators share the empty value
              <option key={i} value={o.value}>
                {o.label === '' ? ' ' : o.label}
              </option>
            ))}
          </NativeSelect>
        )}
        {browseForeign && <span className="browse_foreign">{t('Browse foreign values')}</span>}
        <div className="cell_edit_hint">{t(MSG.cellEditHint).replace('<br>', ' ')}</div>
      </div>
    </div>
  )
}
