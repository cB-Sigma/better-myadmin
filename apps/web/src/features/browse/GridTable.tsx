import type { Cell, Field, GridCell, GridData, GridRow } from '@bettermyadmin/contracts'
import {
  Button,
  DateTimeCalendar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconText,
  NativeSelect,
  type PickerKind,
  PmaIcon,
  Textarea,
  pickerCanShow,
  pickerOptionsFor,
  showMessage,
  useUiSettings,
} from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useConfig } from '../../lib/config'
import { t } from '../../lib/i18n'
import { ForeignBrowser } from '../insert-edit/ForeignBrowser'
import { pickerTip } from '../insert-edit/ValueWidget'
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
import {
  type CellSelection,
  dragSelection,
  emptySelection,
  extendSelection,
  selectAll,
  selectionClass,
  selectionText,
  startSelection,
} from './selection'
import { specialLinkHref } from './special-link'

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
  reorderHint: 'Drag to reorder.',
  markHint: 'Click to mark/unmark.',
  copyHint: 'Double-click to copy column name.',
}

/** makegrid minColWidth */
const MIN_COL_WIDTH = 15

type MoveDir = 'up' | 'down' | 'left' | 'right'

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

/**
 * Results::getActionLinkContent: RowActionType `icons` / `text`, else Generator::getIcon (which
 * follows ActionLinksMode).
 */
export function ActionLink(props: {
  mode: string
  icon: 'b_edit' | 'b_insrow' | 'b_drop'
  text: string
}) {
  if (props.mode === 'icons' || props.mode === 'text') {
    return <IconText icon={props.icon} text={props.text} modeValue={props.mode} />
  }
  return <IconText icon={props.icon} text={props.text} />
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
  // dragStartReorder: the column copy (.cCpy) follows the pointer, .cPointer marks the drop place
  const reorder = useRef<{ x0: number; n: number; newn: number; left: number; moved: boolean } | null>(null)
  const [ghost, setGhost] = useState<{
    text: string
    top: number
    left: number
    w: number
    h: number
  } | null>(null)
  const [colPointer, setColPointer] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const lastChecked = useRef<number | null>(null)
  // initColResize: widths set by dragging the .colborder handles (by server position)
  const [widths, setWidths] = useState<ReadonlyMap<number, number>>(new Map())
  const rsz = useRef<{ p: number; x0: number; w0: number } | null>(null)
  const [rszActive, setRszActive] = useState<number | null>(null)
  // initCellSelection
  const [sel, setSel] = useState<CellSelection>(emptySelection)
  const [colList, setColList] = useState(false)
  const selecting = useRef<{ multi: boolean } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  /** relational links in double-click mode: a single click follows after 700 ms, a double one edits */
  const fkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canReorder = grid.navigation !== null && n > 1
  const visibleCount = visib.filter(Boolean).length

  useEffect(() => {
    setRows(grid.rows)
    setRaw(props.raw)
    setOrder(grid.columns.map((_, i) => i))
    setVisib(grid.columns.map((c) => !c.hidden))
    setPending(new Map())
    setEditing(null)
    setWidths(new Map())
    setSel(emptySelection)
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
    // pma: return g.saveCellWarning (browsers show their own text, the value only asks)
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = t(
        'You have edited some data and they have not been saved. Are you sure you want to leave this page before saving the data?',
      )
    }
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

  /** moveUp / moveDown / moveLeft / moveRight: the same column of the row above / below, or the
   * previous / next grid-editable cell of the row (hideEditCell with { move: true }) */
  const moveEdit = (from: EditState, dir: MoveDir) => {
    let to: EditState | null = null
    if (dir === 'up' || dir === 'down') {
      const r = from.r + (dir === 'up' ? -1 : 1)
      if (rows[r] !== undefined) to = { r, p: from.p }
    } else {
      const editable = order.filter(
        (p) => visib[p] && hasClass(rows[from.r]?.cells[p]?.cls ?? '', 'grid_edit'),
      )
      const i = editable.indexOf(from.p)
      const p = editable[dir === 'left' ? i - 1 : i + 1]
      if (i >= 0 && p !== undefined) to = { r: from.r, p }
    }
    if (to !== null) startEdit(to.r, to.p)
  }

  // column resizing: the document follows the drag (dragMove / dragEnd)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = rsz.current
      if (d === null) return
      e.preventDefault()
    }
    const up = (e: MouseEvent) => {
      const d = rsz.current
      if (d === null) return
      rsz.current = null
      setRszActive(null)
      document.body.style.cursor = ''
      document.body.classList.remove('user-select-none')
      const nw = Math.max(MIN_COL_WIDTH, d.w0 + e.pageX - d.x0)
      setWidths((w) => new Map(w).set(d.p, nw))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [])

  // column reordering: dragMove / dragEnd of the reorder drag (makegrid getHoveredCol, shiftCol)
  const moveRef = useRef(moveColumn)
  moveRef.current = moveColumn
  useEffect(() => {
    const pos = (el: Element) => {
      const w = wrapRef.current!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return {
        left: r.left - w.left + wrapRef.current!.scrollLeft,
        top: r.top - w.top,
        w: r.width,
        h: r.height,
      }
    }
    const move = (e: MouseEvent) => {
      const d = reorder.current
      if (d === null || wrapRef.current === null) return
      const dx = e.pageX - d.x0
      if (dx !== 0) d.moved = true
      setGhost((g) => (g === null ? g : { ...g, left: d.left + dx }))
      const headers = [...(tableRef.current?.querySelectorAll('thead th.draggable:not(.hide)') ?? [])]
      const hovered = headers.find((h) => {
        const r = h.getBoundingClientRect()
        return e.clientX >= r.left && e.clientX <= r.right
      })
      if (hovered === undefined) return
      const newn = Number((hovered as HTMLElement).dataset.orderIndex)
      d.newn = newn
      if (newn !== d.n) {
        const c = pos(hovered)
        setColPointer({ top: c.top, left: newn < d.n ? c.left : c.left + c.w })
      } else setColPointer(null)
    }
    const up = () => {
      const d = reorder.current
      if (d === null) return
      reorder.current = null
      setGhost(null)
      setColPointer(null)
      document.body.style.cursor = ''
      document.body.classList.remove('user-select-none')
      if (d.newn !== d.n) moveRef.current(d.n, d.newn)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [])

  // cell selection: mouseup ends a drag, a mousedown outside the table, Escape reset it; Ctrl+A,
  // Shift+arrows and copy work when no field has the focus
  const keyAt = useRef(0)
  const selRef = useRef(sel)
  selRef.current = sel
  const copyRef = useRef<(e: ClipboardEvent) => void>(() => {})
  copyRef.current = (e: ClipboardEvent) => {
    const t0 = tableRef.current
    const ns = window.getSelection()
    if (t0 === null || !document.body.contains(t0) || editing !== null) return
    if (ns !== null && ns.rangeCount > 0 && !ns.isCollapsed) return
    const cur = selRef.current
    if (cur.cols.size === 0 || cur.rows.size === 0) return
    const shownCols = order.filter((p) => visib[p])
    const text = selectionText(
      cur,
      shownCols.map((p) => grid.columns[p]!.name),
      (r, c) => {
        const cell = rows[r]?.cells[shownCols[c] ?? -1]
        return cell === undefined ? '' : cell.k === 'null' ? 'NULL' : (cell.t ?? '')
      },
      rows.length,
    )
    if (e.clipboardData !== null) {
      e.clipboardData.setData('text/plain', text)
      e.preventDefault()
    }
  }
  const dimsRef = useRef({ rows: 0, cols: 0 })
  dimsRef.current = { rows: rows.length, cols: order.filter((p) => visib[p]).length }
  useEffect(() => {
    const up = () => {
      selecting.current = null
    }
    const down = (e: MouseEvent) => {
      if (tableRef.current !== null && !tableRef.current.contains(e.target as Node)) setSel(emptySelection)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(emptySelection)
      const a = document.activeElement
      // (phpMyAdmin's CodeMirror 5 types into a hidden textarea; CodeMirror 6 is contenteditable)
      if (a?.matches('input, textarea, select') || (a instanceof HTMLElement && a.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault()
        window.getSelection()?.removeAllRanges()
        setSel(selectAll(dimsRef.current.rows, dimsRef.current.cols))
      }
      // throttle (100 ms)
      if (keyAt.current !== 0 && Date.now() - keyAt.current < 100) return
      keyAt.current = Date.now()
      if (e.shiftKey && selRef.current.end !== null) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          setSel((cur) =>
            extendSelection(cur, e.key as 'ArrowUp', dimsRef.current.rows, dimsRef.current.cols),
          )
        }
      }
    }
    const copy = (e: ClipboardEvent) => copyRef.current(e)
    document.addEventListener('mouseup', up)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('copy', copy)
    return () => {
      document.removeEventListener('mouseup', up)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      document.removeEventListener('copy', copy)
    }
  }, [])

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
          aria-label={t('Check')}
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
      sql: grid.urlSql?.sql ?? grid.sql,
      sql_sig: grid.urlSql?.sig ?? grid.sig,
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
          // sized like the Edit / Copy links beside it
          className="delete_row requireConfirm ajax h-auto p-0 align-baseline text-[length:inherit]"
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
    <Button
      variant="link"
      size="sm"
      // Generator::getImage: the title is the hover text (Full texts / Partial texts)
      title={t(grid.textToggle.title)}
      onClick={() => actions.toggleText(grid.textToggle!.pftext)}
    >
      <PmaIcon
        name={grid.textToggle.pftext === 'F' ? 's_fulltext' : 's_partialtext'}
        alt={t(grid.textToggle.title)}
      />
    </Button>
  )
  const colDrop = n > 1 && (
    // not modal: entering a cell or a header hides the list (initColVisib mouseenter)
    <DropdownMenu open={colList} onOpenChange={setColList} modal={false}>
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
        <td className="results-pad" colSpan={layout.colspan} />
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
        const hint =
          // updateHint: reorder + mark + copy hints when the table has markers and several columns
          visibleCount > 1 && grid.columns.some((x) => x.sort !== null) && s.BrowseMarkerEnable
            ? `- ${t(MSG.reorderHint)}\n- ${t(MSG.markHint)}\n- ${t(MSG.copyHint)}`
            : undefined
        const width = widths.get(p)
        const sc = repeat ? '' : selectionClass(sel, -1, order.filter((x) => visib[x]).indexOf(p))
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: column marking is a pointer feature (sql.ts)
          <th
            key={p}
            className={`${cls}${sc === '' ? '' : ` ${sc}`} relative${canReorder ? (visibleCount > 1 ? ' cursor-move' : ' cursor-[inherit]') : ''}`}
            data-column={c.name}
            data-order-index={j}
            // th a dragstart → false: no native drag (of the sort link) competes with the reorder drag
            onDragStart={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              // th.draggable mousedown: dragStartReorder (when more than one column is visible)
              if (repeat || !canReorder || visibleCount <= 1 || e.button !== 0) return
              if ((e.target as HTMLElement).closest('.colborder') !== null) return
              const th = e.currentTarget
              const w = wrapRef.current!.getBoundingClientRect()
              const r = th.getBoundingClientRect()
              const left = r.left - w.left + wrapRef.current!.scrollLeft
              const top = r.top - w.top
              reorder.current = { x0: e.pageX, n: j, newn: j, left, moved: false }
              setGhost({ text: th.innerText, top: top + 20, left, w: th.clientWidth, h: th.clientHeight })
              document.body.style.cursor = 'move'
              document.body.classList.add('user-select-none')
              if (editing !== null) setEditing(null)
            }}
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
                () => showMessage(t('Column name copying to clipboard failed!'), false, 'error'),
              )
            }}
            // mouseover.cellSelect (enter: the header has no children to bubble from)
            onMouseEnter={() => {
              setColList(false)
              if (sortable && s.BrowsePointerEnable) setHoverCol(p)
              if (selecting.current === null || repeat) return
              const j2 = order.filter((x) => visib[x]).indexOf(p)
              setSel((cur) => dragSelection(cur, -1, j2, selecting.current?.multi === true))
            }}
            title={hint ?? (canReorder && !sortable ? t(MSG.reorderHint) : undefined)}
          >
            {!repeat && (
              // initColResize: the column border handle (mousedown starts dragStartRsz)
              <div
                aria-hidden
                className={`colborder absolute top-0 -right-0.5 h-full w-[5px] cursor-col-resize${rszActive === p ? ' colborder_active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const span = (e.currentTarget.parentElement as HTMLElement).querySelector('span.th-content')
                  rsz.current = { p, x0: e.pageX, w0: (span as HTMLElement | null)?.offsetWidth ?? 0 }
                  setRszActive(p)
                  document.body.style.cursor = 'col-resize'
                  document.body.classList.add('user-select-none')
                  if (editing !== null) setEditing(null)
                }}
              />
            )}
            <span className="th-content inline-block" style={width === undefined ? undefined : { width }}>
              {sortable ? (
                <Button
                  variant="link"
                  size="sm"
                  className="sortlink group h-auto"
                  title={`${t(MSG.sortHint)}\n${t(MSG.multiSortHint).replace('<br>', '\n')}`}
                  // th.draggable a: a double-click on the link does not copy the column name
                  onDoubleClick={(e) => e.stopPropagation()}
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
                      {/* .sortlink mouseover / mouseout toggle the .soimg pair: hovering shows the
                          other direction (Results::getSortingUrlParams) */}
                      <span className="inline-flex group-hover:hidden">
                        <PmaIcon
                          name={c.sort!.dir === 'DESC' ? 's_desc' : 's_asc'}
                          alt={t(c.sort!.dir === 'DESC' ? 'Descending' : 'Ascending')}
                          className="soimg"
                        />
                      </span>
                      <span className="hidden group-hover:inline-flex">
                        <PmaIcon
                          name={c.sort!.dir === 'DESC' ? 's_asc' : 's_desc'}
                          alt={t(c.sort!.dir === 'DESC' ? 'Ascending' : 'Descending')}
                          className="soimg"
                        />
                      </span>{' '}
                      <small>{c.sort!.position}</small>
                    </>
                  )}
                </Button>
              ) : (
                c.name
              )}
              {comment}
            </span>
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
        <td className="results-pad d-print-none" colSpan={layout.colspan} />
      ) : null}
    </tr>
  )

  const trClass = [s.BrowsePointerEnable ? '' : 'nopointer', s.BrowseMarkerEnable ? '' : 'nomarker']
    .filter((x) => x !== '')
    .join(' ')

  return (
    <div ref={wrapRef} className="table-responsive-md relative overflow-x-auto">
      {ghost !== null && reorder.current?.moved === true && (
        <div
          className="cCpy"
          style={{ top: ghost.top, left: ghost.left, width: ghost.w, height: ghost.h }}
          aria-hidden
        >
          {ghost.text}
        </div>
      )}
      {colPointer !== null && <div className="cPointer" style={colPointer} aria-hidden />}
      {/* min-w-max: the wrapper scrolls, so the columns keep their natural width instead of
          breaking short values ("LP-100") over lines; long text is already cut at LimitChars */}
      <table ref={tableRef} className="table_results data ajax w-auto min-w-max" data-uniqueid="grid">
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
                    const j = order.filter((x) => visib[x]).indexOf(p)
                    const sc = selectionClass(sel, r, j)
                    const width = widths.get(p)
                    return (
                      <td
                        key={p}
                        className={`${cls}${sc === '' ? '' : ` ${sc}`} relative`}
                        onMouseDown={(e) => {
                          const target = e.target as HTMLElement
                          if (
                            e.button !== 0 ||
                            target.closest('a, input, select, textarea, button, .edit_box, .cEdit')
                          )
                            return
                          const multi = e.ctrlKey || e.metaKey
                          selecting.current = { multi }
                          setSel((cur) => startSelection(cur, r, j, multi))
                        }}
                        // mouseover.cellSelect
                        onMouseEnter={() => {
                          setColList(false)
                          if (selecting.current === null) return
                          setSel((cur) => dragSelection(cur, r, j, selecting.current?.multi === true))
                        }}
                        onMouseLeave={() => {
                          if (selecting.current !== null) window.getSelection()?.removeAllRanges()
                        }}
                        data-decimals={col.decimals}
                        data-type={col.dataType}
                        {...(cell.ol !== undefined ? { 'data-originallength': cell.ol } : {})}
                        onClick={() => grid.gridEdit === 'click' && startEdit(r, p)}
                        onDoubleClick={(e) => {
                          if (grid.gridEdit !== 'double-click') return
                          if (fkTimer.current !== null) {
                            clearTimeout(fkTimer.current)
                            fkTimer.current = null
                          } else if ((e.target as HTMLElement).closest('a') !== null) return
                          startEdit(r, p)
                        }}
                      >
                        <span
                          {...(cell.ol !== undefined ? { title: `${t('Original length')} ${cell.ol}` } : {})}
                          style={width === undefined ? undefined : { width, display: 'inline-block' }}
                        >
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
                                else if (
                                  grid.gridEdit === 'double-click' &&
                                  hasClass(cell.cls, 'grid_edit')
                                ) {
                                  // td.data.click2 on .grid_edit.relation a: follow after 700 ms unless
                                  // a second click comes (then dblclick starts editing)
                                  if (fkTimer.current !== null) return
                                  fkTimer.current = setTimeout(() => {
                                    fkTimer.current = null
                                    actions.followFk(fk)
                                  }, 700)
                                } else actions.followFk(fk)
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
                            edited={edited !== undefined}
                            field={fieldOf(p)}
                            onDone={(v, type, changed) => commitEdit({ r, p }, v, type, changed)}
                            onMove={(dir, v, type, changed) => {
                              commitEdit({ r, p }, v, type, changed)
                              moveEdit({ r, p }, dir)
                            }}
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
  const cfg = useConfig()
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
    cfg,
    tf.external,
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
  if (cell.sl !== undefined) {
    // SpecialSchemaLinks: the Text_Plain_Link transformation (a new tab, like phpMyAdmin)
    const href = specialLinkHref(server, cell.sl)
    if (href === null) return <>{text}</>
    return (
      <a href={href} title="" target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    )
  }
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
  /** the cell holds an unsaved edit (td.to_be_saved): its value is not fetched again */
  edited: boolean
  onDone: (value: string | null, type: string, changed: boolean) => void
  /** Ctrl/Alt + arrow: save and edit the neighbouring cell */
  onMove: (dir: MoveDir, value: string | null, type: string, changed: boolean) => void
  onCancel: () => void
}) {
  const { grid, cell, column, server } = props
  const isNull = props.edited ? props.raw === null : cell.k === 'null'
  const isDate = ['timefield', 'datefield', 'datetimefield', 'timestampfield'].some((c) =>
    hasClass(cell.cls, c),
  )
  // the td's data-type (makegrid: addDatepicker($inputField, $td.attr('data-type'), …))
  const pickerKind: PickerKind | null = hasClass(cell.cls, 'datefield')
    ? 'date'
    : hasClass(cell.cls, 'timefield')
      ? 'time'
      : hasClass(cell.cls, 'timestampfield')
        ? 'timestamp'
        : hasClass(cell.cls, 'datetimefield')
          ? 'datetime'
          : null
  const { FirstDayOfCalendar } = useUiSettings()
  const [typed, setTyped] = useState(0)
  // datepicker('show') right away (makegrid showEditArea)
  const [pickerShown, setPickerShown] = useState(true)
  // showEditArea: time values get the fractional digits of the column (.000 / .000000)
  const initial = (() => {
    const v = isNull ? '' : rawText(props.raw, props.field)
    if (!isDate || column.decimals <= 0 || !column.dataType.includes('time') || v === '') return v
    const dotted = v.includes('.') ? v : `${v}.`
    const n = column.decimals > 3 ? 6 : 3
    return `${dotted}${'0'.repeat(n)}`.slice(0, dotted.indexOf('.') + 1 + n)
  })()
  const [value, setValue] = useState(column.dataType === 'json' ? prettyJson(initial) : initial)
  const [nullChecked, setNullChecked] = useState(isNull)
  const [original, setOriginal] = useState<string>(initial)
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [browseForeign, setBrowseForeign] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // showEditCell: the edit box takes the cell's outer size; the cursor goes to the end of the value
  useEffect(() => {
    const b = boxRef.current
    if (b === null) return
    const td = b.closest('td')
    if (td !== null) {
      b.style.width = `${td.offsetWidth}px`
      b.style.height = `${td.offsetHeight}px`
    }
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
    } else if ((hasClass(cell.cls, 'truncated') || hasClass(cell.cls, 'transformed')) && !props.edited) {
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

  /** saveEditedCell: the value, its type and whether it changed (null: refused) */
  const result = (): [string | null, string, boolean] | null => {
    if (nullChecked) return [null, '', !isNull]
    let v = value
    if (isSet) v = selected.join(',')
    if (isHex && !isValidHex(v)) {
      showMessage(
        t('Please enter a valid hexadecimal string. Valid characters are 0-9, A-F.'),
        false,
        'error',
      )
      props.onCancel()
      return null
    }
    const changed =
      isNull || (column.dataType === 'json' ? prettyJson(v) !== prettyJson(original) : v !== original)
    return [v, isBit ? 'bit' : isHex ? 'hex' : '', changed]
  }
  const save = () => {
    if (loading) return
    const r = result()
    if (r !== null) props.onDone(...r)
  }
  const [foreign, setForeign] = useState(false)

  // click outside saves (hideEditCell) — not in the datepicker or the Browse foreign values dialog
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as Element
      if (ref.current === null || ref.current.contains(target)) return
      if (target.closest('[data-radix-popper-content-wrapper], .dismissable') !== null) return
      if (document.getElementById('browseForeignModal') !== null) return
      save()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  })
  // $('html').on('keydown'): Esc cancels wherever the focus is
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.getElementById('browseForeignModal') === null) props.onCancel()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  })

  /** ENUM / SET values come from the list: the text box is not editable (isEditCellTextEditable) */
  const textEditable = !(isEnum || isSet)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const arrows: Record<string, MoveDir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const dir = arrows[e.key]
    if (dir !== undefined && (e.ctrlKey || e.altKey)) {
      // handleCtrlNavigation
      e.preventDefault()
      if (loading) return
      const r = result()
      if (r !== null) props.onMove(dir, ...r)
    } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      // Capture ctrl+v: the value is not NULL any more
      setNullChecked(false)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.nativeEvent.stopImmediatePropagation()
      props.onCancel()
    } else if (e.key === 'Enter' && !(textarea && e.shiftKey)) {
      e.preventDefault()
      save()
    } else if (!textEditable && e.key !== 'Tab') {
      e.preventDefault()
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
        setTyped((n) => n + 1)
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
        {props.edited && (hasClass(cell.cls, 'truncated') || hasClass(cell.cls, 'transformed')) && (
          // a re-opened unsaved truncated value: a textarea in the edit area mirrors the text box
          <Textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setNullChecked(false)
            }}
          />
        )}
        {pickerKind !== null && (
          // showOn 'button': the trigger after the edit box shows and hides the picker
          <button
            type="button"
            className="ui-datepicker-trigger inline-flex cursor-pointer items-center p-0.5"
            title="..."
            aria-label="..."
            onClick={() => setPickerShown((v) => !v)}
          >
            <PmaIcon name="b_calendar" alt="" />
          </button>
        )}
        {pickerKind !== null && pickerShown && pickerCanShow(pickerKind, value) && (
          // the picker shown in the edit area (#ui-datepicker-div moved into cEdit, position: relative);
          // a typed value is read again (datepicker('show') on keyup), an invalid one hides it
          <DateTimeCalendar
            key={typed}
            inline
            kind={pickerKind}
            value={value}
            options={{ ...pickerOptionsFor(pickerKind, column.decimals, FirstDayOfCalendar), hourMax: 23 }}
            {...(pickerTip(pickerKind) !== undefined ? { note: pickerTip(pickerKind) as string } : {})}
            onChange={(v) => {
              setValue(v)
              setNullChecked(false)
            }}
          />
        )}
        {!notNull && (
          // makegrid: <div class="null_div"><label>NULL:<input type="checkbox"></label></div>
          <div className="null_div">
            <label className="flex items-center gap-1">
              NULL:
              <input
                type="checkbox"
                checked={nullChecked}
                onChange={(e) => {
                  setNullChecked(e.target.checked)
                  if (e.target.checked) {
                    setValue('')
                    setSelected([])
                  }
                }}
              />
            </label>
          </div>
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
        {browseForeign && (
          <>
            <Button
              variant="link"
              size="sm"
              className="browse_foreign h-auto p-0"
              onClick={() => {
                setNullChecked(false)
                setForeign(true)
              }}
            >
              {t('Browse foreign values')}
            </Button>
            {foreign && (
              <ForeignBrowser
                server={server}
                db={grid.db}
                table={grid.table}
                field={column.name}
                data={value}
                onClose={() => setForeign(false)}
                // span.curr_value change: the picked key goes to the text box
                onPick={(key) => {
                  setValue(key)
                  setNullChecked(false)
                  setForeign(false)
                }}
              />
            )}
          </>
        )}
        <div className="cell_edit_hint">{t(MSG.cellEditHint).replace('<br>', ' ')}</div>
      </div>
    </div>
  )
}
