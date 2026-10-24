import type {
  DesignerQuery,
  DesignerRelation,
  DesignerResponse,
  DesignerTable,
  DesignerTablePosition,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  Button,
  Loading,
  MessageBox,
  NativeCheckbox,
  NativeSelect,
  PROCESSING_REQUEST,
  PmaIcon,
  type PmaIconName,
  SafeHtml,
  buttonVariants,
  pmaDocUrl,
  removeMessage,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type DbRef, api, errorMessage } from '../../../lib/api'
import { pgettext, t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { path, dbBase, tableBase } from '../common'
import {
  AddTablesModal,
  EditDeletePagesModal,
  ExportSchemaModal,
  PromptModal,
  SaveAsModal,
  SavePageModal,
} from './DesignerDialogs'
import {
  BuildQueryModal,
  EditHistoryPane,
  type EditPane,
  type EditValues,
  HistoryPanel,
  OptionsPane,
} from './QueryBuilder'
import { type Line, colorByTarget, dragTo, hitsStart, line2, line3, relationLine, rgb } from './designer'
import {
  type ContrRelation,
  type OptionsForm,
  type QueryBuilderState,
  addObject,
  buildQuery,
  emptyOptions,
  emptyQueryBuilder,
  historyDelete,
  selectAll,
  storeColumn,
} from './history'
import {
  offlineDeletePage,
  offlineFirstPage,
  offlineLoadPage,
  offlineSaveToNewPage,
  offlineSaveToSelectedPage,
} from './offlineDb'
import './designer.css'

/**
 * The Designer: tables on a canvas with their relations, saved as pages of the configuration
 * storage; relations and display fields are edited on it; `?query` turns it into the visual query
 * builder.
 * pma: src/Controllers/Database/DesignerController.php, resources/templates/database/designer/main.twig,
 *      database_tables.twig, resources/js/designer/move.ts, init.ts, history.ts
 */
export function DesignerPage({
  server,
  db,
  page,
  query,
}: { server: number; db: string; page?: string; query?: string }) {
  const r = useMemo<DbRef>(() => ({ server, db }), [server, db])
  const q: DesignerQuery = {
    ...(page !== undefined ? { page } : {}),
    ...(query !== undefined ? { query } : {}),
  }
  const res = useQuery({
    queryKey: qk.dbPage(r, 'designer', q),
    queryFn: () => api.designer(r, q),
    gcTime: 0,
  })
  if (res.isError) {
    const m = errorMessage(res.error)
    return <MessageBox type="error" text={m.text} />
  }
  if (res.data === undefined) return <Loading />
  return <Designer key={res.dataUpdatedAt} r={r} data={res.data} />
}

interface TState {
  key: string
  db: string
  table: string
  info: DesignerTable
  x: number
  y: number
  /** data-left / data-top: the unsnapped drag position */
  raw: { x: number; y: number }
  /** check_vis_ (t_h) */
  visible: boolean
  /** tbody hidden (t_v = 0) */
  collapsed: boolean
}

const tKey = (t: { db: string; table: string }) => `${t.db}.${t.table}`

function initial(t: DesignerTable, displayPage: number): TState {
  return {
    key: tKey(t),
    db: t.db,
    table: t.table,
    info: t,
    x: t.x,
    y: t.y,
    raw: { x: t.x, y: t.y },
    visible: t.onPage || displayPage === -1,
    collapsed: false,
  }
}

type Dialog =
  | { kind: 'prompt'; then: () => void }
  | { kind: 'edit' | 'delete' | 'saveAs' | 'export' | 'addTable' }
  | { kind: 'savePage'; then?: () => void }
  | { kind: 'build'; sql: string }
  | null

interface DrawnLine {
  rel: DesignerRelation
  line: Line
  color: string
}

const SELECTED = rgb(255, 0, 0)

function Designer({ r, data }: { r: DbRef; data: DesignerResponse }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const builder = data.visualBuilder
  const [tables, setTables] = useState<TState[]>(() => data.tables.map((x) => initial(x, data.displayPage)))
  const [displayField, setDisplayField] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const x of data.tables) if (x.displayField !== null) out[x.table] = x.displayField
    return out
  })
  const [selectedPage, setSelectedPage] = useState(data.displayPage)
  const [pageName, setPageName] = useState(data.selectedPage ?? t('Untitled'))
  /** `change` (layout modified) and the `*` of #saved_state */
  const [changed, setChanged] = useState(false)
  const [star, setStar] = useState(data.selectedPage === null)
  const markUnsaved = () => {
    setChanged(true)
    setStar(true)
  }
  const markSaved = () => {
    setChanged(false)
    setStar(false)
  }

  // side menu state (setDefaultValuesFromSavedState)
  const [angular, setAngular] = useState(data.sideMenu.angular_direct)
  const [grid, setGrid] = useState(data.sideMenu.snap_to_grid)
  const [showLines, setShowLines] = useState(!data.sideMenu.relation_lines)
  const [pinned, setPinned] = useState(data.sideMenu.pin_text)
  const [right, setRight] = useState(false)
  const [sbAll, setSbAll] = useState<{ alt: 'v' | '>'; selected: boolean }>({ alt: 'v', selected: false })
  const [leftMenu, setLeftMenu] = useState(false)
  const [hover, setHover] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [hsAll, setHsAll] = useState<'v' | '>'>('v')
  const [hs, setHs] = useState<'v' | '>'>('v')

  // relation / display field modes
  const [onRelation, setOnRelation] = useState(false)
  const [onDisplay, setOnDisplay] = useState(false)
  const [hint, setHint] = useState('')
  const link = useRef<{ DB1: string; T1: string; F1: string }>({ DB1: '', T1: '', F1: '' })
  const clickField = useRef(false)
  /** #foreign_relation stays shown (both tables support FOREIGN KEYs, the second column is indexed) */
  const relForeign = useRef(true)
  const [newRel, setNewRel] = useState<{
    x: number
    y: number
    DB2: string
    T2: string
    F2: string
    foreign: boolean
  } | null>(null)
  const [onDelete, setOnDeleteAction] = useState('nix')
  const [onUpdate, setOnUpdateAction] = useState('nix')
  const [updRel, setUpdRel] = useState<{ x: number; y: number; rel: DesignerRelation } | null>(null)
  const mouse = useRef({ x: 0, y: 0, cx: 0, cy: 0 })
  const [hintPos, setHintPos] = useState({ x: 0, y: 0 })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  // query builder
  const [qb, setQb] = useState<QueryBuilderState>(emptyQueryBuilder)
  const [checkedCols, setCheckedCols] = useState<Set<string>>(new Set())
  const [allChecked, setAllChecked] = useState<Set<string>>(new Set())
  const [option, setOption] = useState<{ db: string; table: string; col: string; x: number } | null>(null)
  const [optionForm, setOptionForm] = useState<OptionsForm>(emptyOptions)
  const [editing, setEditing] = useState<{ index: number; pane: EditPane; values: EditValues } | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const contr: ContrRelation[] = data.relations
  const jTabs = useMemo(() => new Map(tables.map((x) => [x.key, x.info.supportsFk ? 1 : 0])), [tables])

  // phpMyAdmin's session lock runs the setting requests one after the other (each reads, then
  // updates or inserts the user's row): they are queued here
  const settingQueue = useRef<Promise<unknown>>(Promise.resolve())
  const saveValue = useCallback(
    (index: string, value: string) => {
      settingQueue.current = settingQueue.current
        .then(() => api.designerSetting(r, index, value))
        .catch((e: unknown) => showMessage(errorMessage(e).text, false))
    },
    [r],
  )

  // setDefaultValuesFromSavedState: the buttons are re-applied, which stores their values again
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    saveValue('angular_direct', data.sideMenu.angular_direct ? 'angular' : 'direct')
    saveValue('snap_to_grid', data.sideMenu.snap_to_grid ? 'on' : 'off')
    saveValue('relation_lines', String(!data.sideMenu.relation_lines))
    if (data.sideMenu.small_big_all) {
      setTables((ts) => ts.map((x) => ({ ...x, collapsed: true })))
      setSbAll({ alt: '>', selected: true })
      saveValue('small_big_all', 'v')
    }
    if (data.sideMenu.side_menu) {
      setRight(true)
      saveValue('side_menu', 'true')
    }
  }, [data.sideMenu, saveValue])

  // ---------------------------------------------------------------- pages kept in IndexedDB
  const indexedDbError = () =>
    showMessage(
      t(
        'You can not open, save or delete your page layout, as IndexedDB is not working in your browser and your phpMyAdmin configuration storage is not configured for this.',
      ),
      null,
      'error',
    )

  /** DesignerPage.showNewPageTables(true): every table shown at a random place on an unsaved page */
  const showNewPageTables = () => {
    // DesignerPage.getRandom(max, min)
    const random = (max: number, min: number) => Math.floor(Math.random() * (max - min) + min)
    setTables((ts) =>
      ts.map((x) => {
        const y = random(550, 20)
        const nx = random(700, 20)
        return { ...x, visible: true, x: nx, y, raw: { x: nx, y } }
      }),
    )
    setSelectedPage(-1)
    setPageName(t('Untitled'))
    markUnsaved()
  }

  /** DesignerPage.loadHtmlForPage */
  const loadOfflinePage = async (id: number) => {
    showNewPageTables()
    const loaded = await offlineLoadPage(id).catch(() => null)
    if (loaded === null) return
    setPageName(loaded.page.pageDescr)
    const at = new Map(loaded.coords.map((c) => [`${data.db}.${c.tableName}`, c]))
    const missing = [...at.keys()].some((k) => !tables.some((x) => x.key === k))
    setTables((ts) =>
      ts.map((x) => {
        const c = at.get(x.key)
        return c === undefined ? x : { ...x, x: c.x, y: c.y, raw: { x: c.x, y: c.y }, visible: true }
      }),
    )
    markSaved()
    if (missing) {
      markUnsaved()
      showMessage(t('Some tables saved in this page might have been renamed or deleted.'))
    }
    setSelectedPage(loaded.page.pgNr ?? -1)
  }

  /** DesignerPage.showTablesInLandingPage */
  const showTablesInLandingPage = async () => {
    const page = await offlineFirstPage(data.db).catch(() => {
      indexedDbError()
      return null
    })
    if (page !== null && page.pgNr !== undefined) await loadOfflinePage(page.pgNr)
    else showNewPageTables()
  }
  const landed = useRef(false)
  useEffect(() => {
    if (data.tablesEnabled || landed.current) return
    landed.current = true
    void showTablesInLandingPage()
  })

  /** getUrlPos(false): the shown tables' coordinates */
  const offlineCoords = () =>
    tables
      .filter((x) => x.visible)
      .map((x) => ({ dbName: x.db, tableName: x.table, x: Math.trunc(x.x), y: Math.trunc(x.y) }))

  const loadPage = (p: number | null) => {
    if (!data.tablesEnabled) {
      if (p === null) void showTablesInLandingPage()
      else if (p > -1) void loadOfflinePage(p)
      else showNewPageTables()
      markSaved()
      return
    }
    void navigate({
      to: path(`${dbBase(r.server, r.db)}/designer`),
      search: (p !== null ? { page: String(p) } : {}) as never,
    })
    void qc.invalidateQueries({ queryKey: qk.dbPage(r, 'designer') })
  }

  // ---------------------------------------------------------------- geometry
  const tableEls = useRef(new Map<string, HTMLTableElement>())
  const cellEls = useRef(new Map<string, HTMLElement>())
  const targets = useRef<Array<[string, string]>>([])
  const [lines, setLines] = useState<DrawnLine[]>([])
  const [size, setSize] = useState({ w: 100, h: 100 })
  const [dragging, setDragging] = useState<string | null>(null)

  // DesignerMove.reload / resizeOsnTab
  useLayoutEffect(() => {
    let maxX = 0
    let maxY = 0
    for (const x of tables) {
      const el = tableEls.current.get(x.key)
      if (el === undefined) continue
      maxX = Math.max(maxX, x.x + el.offsetWidth)
      maxY = Math.max(maxY, x.y + el.offsetHeight)
    }
    setSize({ w: maxX + 50, h: maxY + 50 })
    const byKey = new Map(tables.map((x) => [x.key, x]))
    const out: DrawnLine[] = []
    for (const rel of data.relations) {
      const m = byKey.get(rel.masterTable)
      const f = byKey.get(rel.foreignTable)
      if (m === undefined || f === undefined || !m.visible || !f.visible) continue
      const me = tableEls.current.get(m.key)
      const fe = tableEls.current.get(f.key)
      if (me === undefined || fe === undefined) continue
      let mTop = 0
      if (!m.collapsed) {
        const c = cellEls.current.get(`${m.key}\u0000${rel.masterField}`)
        if (c === undefined) continue
        mTop = c.offsetTop
      }
      let fTop = 0
      if (!f.collapsed) {
        const c = cellEls.current.get(`${f.key}\u0000${rel.foreignField}`)
        if (c === undefined) continue
        fTop = c.offsetTop
      }
      const line = relationLine(
        { left: me.offsetLeft, top: me.offsetTop, width: me.offsetWidth },
        mTop,
        { left: fe.offsetLeft, top: fe.offsetTop, width: fe.offsetWidth },
        fTop,
      )
      out.push({
        rel,
        line,
        color: colorByTarget(targets.current, `${rel.foreignTable}.${rel.foreignField}`),
      })
    }
    setLines(out)
  }, [tables, data.relations])

  // ---------------------------------------------------------------- drag (mouseDown / mouseMove / mouseUp)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const dx = e.pageX - mouse.current.x
      const dy = e.pageY - mouse.current.y
      mouse.current = { x: e.pageX, y: e.pageY, cx: e.clientX, cy: e.clientY }
      if (dragging !== null) {
        e.preventDefault()
        setChanged(true)
        setStar(true)
        setTables((ts) =>
          ts.map((x) => {
            if (x.key !== dragging) return x
            const n = dragTo(x.raw, dx, dy, grid)
            return { ...x, raw: n.raw, x: n.x, y: n.y }
          }),
        )
      }
      if (onRelation || onDisplay) setHintPos({ x: e.clientX + 20, y: e.clientY + 20 })
    }
    const up = () => setDragging(null)
    const down = (e: MouseEvent) => {
      mouse.current = { x: e.pageX, y: e.pageY, cx: e.clientX, cy: e.clientY }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('mousedown', down)
    }
  }, [dragging, grid, onRelation, onDisplay])

  // ---------------------------------------------------------------- positions and pages
  /** DesignerMove.getUrlPos(true): every table of the canvas */
  const positions = (): DesignerTablePosition[] =>
    tables.map((x) => ({
      x: String(Math.trunc(x.x)),
      y: String(Math.trunc(x.y)),
      v: !x.collapsed,
      h: x.visible,
      db: x.db,
      table: x.table,
    }))

  /** save2: the current page */
  const save2 = (then?: () => void) => {
    if (!data.tablesEnabled) {
      offlineSaveToSelectedPage(data.db, selectedPage, pageName.trim(), offlineCoords())
        .then((page) => {
          markSaved()
          setSelectedPage(page.pgNr ?? -1)
          then?.()
        })
        .catch(indexedDbError)
      return
    }
    const box = showMessage(PROCESSING_REQUEST)
    api
      .designerSavePage(r, {
        save_page: 'same',
        selected_page: String(selectedPage),
        selected_value: '',
        tables: positions(),
      })
      .then((d) => {
        if (!d.success) {
          showMessage(d.message ?? 'Error', false)
          return
        }
        removeMessage(box)
        showMessage(t('Modifications have been saved'))
        markSaved()
        then?.()
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  /** save3: the current page, or ask for a name */
  const save3 = (then?: () => void) => {
    if (selectedPage !== -1) save2(then)
    else setDialog(then !== undefined ? { kind: 'savePage', then } : { kind: 'savePage' })
  }

  const promptToSave = (then: () => void) => {
    if (changed || selectedPage === -1) setDialog({ kind: 'prompt', then })
    else then()
  }

  /** submitSaveDialogAndClose */
  const saveNew = (name: string, then?: () => void) => {
    setDialog(null)
    if (!data.tablesEnabled) {
      offlineSaveToNewPage(data.db, name, offlineCoords())
        .then((page) => {
          markSaved()
          if (page.pgNr !== undefined) setSelectedPage(page.pgNr)
          setPageName(page.pageDescr)
          then?.()
        })
        .catch(indexedDbError)
      return
    }
    const box = showMessage(PROCESSING_REQUEST)
    api
      .designerSavePage(r, {
        save_page: 'new',
        selected_page: '0',
        selected_value: name,
        tables: positions(),
      })
      .then((d) => {
        if (!d.success) {
          showMessage(d.message ?? 'Error', false)
          return
        }
        removeMessage(box)
        markSaved()
        if (d.id !== undefined && d.id !== 0) setSelectedPage(d.id)
        setPageName(name)
        then?.()
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  const saveAs = (v: { choice: 'same' | 'new'; page: string; name: string }) => {
    setDialog(null)
    const box = showMessage(PROCESSING_REQUEST)
    if (!data.tablesEnabled) {
      const save =
        v.choice === 'same'
          ? offlineSaveToSelectedPage(data.db, Number.parseInt(v.page, 10), v.name, offlineCoords())
          : offlineSaveToNewPage(data.db, v.name, offlineCoords())
      save
        .then((page) => {
          removeMessage(box)
          markSaved()
          loadPage(page.pgNr ?? selectedPage)
        })
        .catch(indexedDbError)
      return
    }
    api
      .designerSavePage(r, {
        save_page: v.choice,
        selected_page: v.page,
        selected_value: v.choice === 'new' ? v.name : '',
        tables: positions(),
      })
      .then((d) => {
        if (!d.success) {
          showMessage(d.message ?? 'Error', false)
          return
        }
        removeMessage(box)
        markSaved()
        // pma: DesignerConfig.selectedPage only changes for a new page
        loadPage(d.id !== undefined && d.id !== 0 ? d.id : selectedPage)
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  const deletePage = (p: string) => {
    setDialog(null)
    const box = showMessage(PROCESSING_REQUEST)
    const current = Number.parseInt(p, 10) === selectedPage
    if (!data.tablesEnabled) {
      offlineDeletePage(Number.parseInt(p, 10))
        .then((ok) => {
          if (!ok) {
            showMessage('Error', false)
            return
          }
          removeMessage(box)
          if (current) loadPage(null)
          else showMessage(t('Successfully deleted the page'))
        })
        .catch(indexedDbError)
      return
    }
    api
      .designerDeletePage(r, p)
      .then((d) => {
        if (!d.success) {
          showMessage('Error', false)
          return
        }
        removeMessage(box)
        if (current) loadPage(null)
        else showMessage(t('Successfully deleted the page'))
        void qc.invalidateQueries({ queryKey: qk.dbPage(r, 'designer-pages') })
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  const exportSchema = (exportType: string, options: Record<string, string>) => {
    setDialog(null)
    api
      .schemaExport(r, {
        page_number: String(selectedPage),
        export_type: exportType,
        offline_export: !data.tablesEnabled,
        options,
        tables: positions(),
      })
      .then((d) => {
        // Core::downloadHeader: the browser saves the file (a binary format comes base64-encoded)
        const body = d.encoding === 'base64' ? Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0)) : d.data
        const url = URL.createObjectURL(new Blob([body], { type: d.mediaType }))
        const a = document.createElement('a')
        a.href = url
        a.download = d.fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  const addTable = (adb: string, table: string) => {
    // Check if table already imported or not.
    if (tables.some((x) => x.key === `${adb}.${table}`)) {
      showMessage(
        sprintf(
          pgettext(
            'The table already exists in the designer and can not be added once more.',
            'Table %s already exists!',
          ),
          `${adb}.${table}`,
        ),
        null,
        'error',
      )
      return
    }
    setDialog(null)
    api
      .designerTable(r, adb, table)
      .then((list) => {
        const one = list[0]
        if (one === undefined) return
        setTables((ts) => [...ts, initial(one, -1)])
        markUnsaved()
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  // ---------------------------------------------------------------- relations and display field
  /** startRelation */
  const startRelation = () => {
    if (onDisplay) return
    if (!onRelation) {
      setOnRelation(true)
      setHint(t('Select referenced key'))
    } else {
      setHint('')
      clickField.current = false
      setOnRelation(false)
    }
  }

  /** startDisplayField */
  const startDisplayField = () => {
    if (onRelation) return
    if (!onDisplay) {
      setOnDisplay(true)
      setHint(t('Choose column to display'))
    } else {
      setHint('')
      setOnDisplay(false)
    }
  }

  /** DesignerMove.clickField(db, T, f, pk) */
  const clickTableField = (tb: TState, col: string, e: ReactMouseEvent) => {
    const key = tb.info.columns.find((c) => c.name === col)?.key ?? null
    // click_field_param: the index flag only for an indexed column
    const pk = key === null ? 0 : tb.info.supportsFk ? 1 : key ? 1 : 0
    if (onRelation) {
      if (!clickField.current) {
        if (!pk) {
          // pma: move.ts calls alert()
          window.alert(t('Please select the primary key or a unique key!'))
          return
        }
        clickField.current = true
        link.current = { DB1: tb.db, T1: tb.table, F1: col }
        setHint(t('Select Foreign Key'))
        relForeign.current = jTabs.get(tb.key) === 1
      } else {
        startRelation()
        const foreign = relForeign.current && jTabs.get(tb.key) === 1 && pk === 1
        setNewRel({ x: e.clientX, y: e.clientY, DB2: tb.db, T2: tb.table, F2: col, foreign })
      }
    }
    if (onDisplay) {
      let field = col
      const next = { ...displayField }
      if (displayField[tb.table] === col) {
        delete next[tb.table]
        field = ''
      } else {
        next[tb.table] = col
      }
      setDisplayField(next)
      setOnDisplay(false)
      setHint('')
      const box = showMessage(PROCESSING_REQUEST)
      api
        .designerDisplayField(r, { db: tb.db, table: tb.table, field })
        .then((d) => {
          if (!d.success) {
            showMessage(d.message.text, false)
            return
          }
          removeMessage(box)
          showMessage(t('Modifications have been saved'))
        })
        .catch((err: unknown) => showMessage(errorMessage(err).text, false))
    }
  }
  const relationMessage = (d: { success: boolean; message: { type: string; text: string } }) =>
    showMessage(<SafeHtml html={d.message.text} />, d.success ? null : false, d.success ? 'success' : 'error')

  /** newRelation */
  const newRelation = () => {
    if (newRel === null) return
    setNewRel(null)
    const box = showMessage(PROCESSING_REQUEST)
    api
      .designerAddRelation(r, {
        ...link.current,
        DB2: newRel.DB2,
        T2: newRel.T2,
        F2: newRel.F2,
        on_delete: onDelete,
        on_update: onUpdate,
      })
      .then((d) => {
        removeMessage(box)
        relationMessage(d)
        if (d.success) loadPage(selectedPage)
      })
      .catch((e: unknown) => showMessage(errorMessage(e).text, false))
  }

  /** canvasClick */
  const canvasClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    const hit = lines.find((l) => hitsStart(l.line, x, y))
    if (hit === undefined) {
      setUpdRel(null)
      return
    }
    setUpdRel({ x: e.clientX, y: e.clientY, rel: hit.rel })
  }

  /** updRelation */
  const removeRelation = () => {
    if (updRel === null) return
    const rel = updRel.rel
    setUpdRel(null)
    const box = showMessage(PROCESSING_REQUEST)
    api
      .designerRemoveRelation(r, {
        T1: rel.foreignTable,
        F1: rel.foreignField,
        T2: rel.masterTable,
        F2: rel.masterField,
      })
      .then((d) => {
        removeMessage(box)
        relationMessage(d)
        if (d.success) loadPage(selectedPage)
      })
      .catch((err: unknown) => showMessage(errorMessage(err).text, false))
  }

  // ---------------------------------------------------------------- show / hide
  const smallTab = (key: string) =>
    setTables((ts) => ts.map((x) => (x.key === key ? { ...x, collapsed: !x.collapsed } : x)))

  /** smallTabAll */
  const smallTabAll = () => {
    const collapse = sbAll.alt === 'v'
    setTables((ts) => ts.map((x) => ({ ...x, collapsed: collapse })))
    setSbAll((s) => ({ alt: collapse ? '>' : 'v', selected: !s.selected }))
    saveValue('small_big_all', collapse ? 'v' : '>')
  }

  const visibleTab = (key: string, visible: boolean) => {
    setTables((ts) => ts.map((x) => (x.key === key ? { ...x, visible } : x)))
    markUnsaved()
  }

  /** hideTabAll */
  const hideTabAll = () => {
    const next = hsAll === 'v' ? '>' : 'v'
    setHsAll(next)
    setTables((ts) => ts.map((x) => ({ ...x, visible: next === 'v' })))
  }

  /** noHaveConstr: tables without any relation */
  const noHaveConstr = () => {
    const related = new Set<string>()
    for (const rel of data.relations) {
      related.add(rel.masterTable)
      related.add(rel.foreignTable)
    }
    const next = hs === 'v' ? '>' : 'v'
    setHs(next)
    setTables((ts) => ts.map((x) => (related.has(x.key) ? x : { ...x, visible: next === 'v' })))
  }

  const openStructure = (x: TState) =>
    void navigate({ to: path(`${tableBase(r.server, x.db, x.table)}/structure`) })

  /** selectTab: flash the table's header and scroll to it */
  const selectTab = (key: string) => {
    setHighlight(key)
    const el = tableEls.current.get(key)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    window.setTimeout(() => setHighlight(null), 800)
  }

  const root = useRef<HTMLDivElement>(null)
  const toggleFullscreen = () => {
    if (!document.fullscreenEnabled) {
      showMessage(
        t(
          'The fullscreen request was denied because the Fullscreen API is disabled by user preference in the browser.',
        ),
        null,
        'error',
      )
      return
    }
    if (document.fullscreenElement === null) {
      void root.current?.requestFullscreen()
      setFullscreen(true)
      saveValue('full_screen', 'on')
    } else {
      void document.exitFullscreen()
      setFullscreen(false)
      saveValue('full_screen', 'off')
    }
  }
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement === null && fullscreen) {
        setFullscreen(false)
        saveValue('full_screen', 'off')
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [fullscreen, saveValue])

  // ---------------------------------------------------------------- query builder
  const optionAdd = () => {
    if (option === null) return
    const res = addObject(qb, option.table, option.col, 1, optionForm)
    if (res.result === 'error') {
      showMessage(t('value/subQuery is empty'))
      return
    }
    setQb(res.state)
    if (res.result === 'stop') return
    showMessage(t('%d object(s) created.', res.created))
    setOption(null)
    setOptionForm(emptyOptions())
  }

  const editHistory = (index: number) => {
    const h = qb.history[index]
    if (h === undefined || h.type === 'GroupBy' || h.type === 'OrderBy') return
    setEditing({
      index,
      pane: h.type,
      values: {
        relOpt: h.relationOperator ?? '--',
        query: h.query ?? '',
        operator: h.operator ?? '---',
        renameTo: h.renameTo ?? '',
      },
    })
  }

  /** DesignerHistory.edit */
  const editOk = () => {
    if (editing === null) return
    const { index, pane, values } = editing
    setQb((s) => {
      const history = [...s.history]
      const h = { ...(history[index] as (typeof history)[number]) }
      if (pane === 'Rename' && values.renameTo !== '') h.renameTo = values.renameTo
      if (pane === 'Aggregate' && values.operator !== '---') h.operator = values.operator
      if ((pane === 'Where' || pane === 'Having') && values.relOpt !== '--' && values.query !== '') {
        h.query = values.query
        h.relationOperator = values.relOpt
        if (pane === 'Having') h.operator = values.operator
      }
      history[index] = h
      return { ...s, history }
    })
    setEditing(null)
  }

  const runBuild = () => {
    const b = buildQuery(qb, contr)
    setQb((s) => ({ ...s, fromArray: b.fromArray }))
    setDialog({ kind: 'build', sql: b.sql })
  }

  const toggleColumn = (tb: TState, col: string, checked: boolean) => {
    const id = `${tb.key}\u0000${col}`
    setCheckedCols((s) => {
      const n = new Set(s)
      if (checked) n.add(id)
      else n.delete(id)
      return n
    })
    setQb((s) => storeColumn(s, tb.table, col, checked))
  }

  const toggleAll = (tb: TState, checked: boolean) => {
    const prefix = `${tb.key}\u0000`
    const already = tb.info.columns.filter((c) => checkedCols.has(prefix + c.name)).map((c) => c.name)
    setQb((s) => selectAll(s, tb.table, checked, checked ? already : []))
    setCheckedCols((s) => {
      const n = new Set(s)
      for (const c of tb.info.columns) {
        if (checked) n.add(prefix + c.name)
        else n.delete(prefix + c.name)
      }
      return n
    })
    setAllChecked((s) => {
      const n = new Set(s)
      if (checked) n.add(tb.key)
      else n.delete(tb.key)
      return n
    })
  }

  // ---------------------------------------------------------------- side menu
  const showText = pinned || hover
  const btn = (
    id: string,
    icon: PmaIconName,
    text: string,
    onClick: () => void,
    selected = false,
    extra: { href?: string } = {},
  ) => (
    <a
      key={id !== '' ? id : text}
      href={extra.href ?? '#'}
      {...(id !== '' ? { id } : {})}
      // the image's title in phpMyAdmin; the text shows on hover
      title={text}
      className={selected ? 'M_butt_Selected_down' : 'M_butt'}
      {...(extra.href !== undefined ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(e) => {
        if (extra.href !== undefined) return
        e.preventDefault()
        onClick()
      }}
    >
      <PmaIcon name={icon} />
      <span className={showText ? 'hidable' : 'hidable hidden'}>{text}</span>
    </a>
  )

  const visibleCount = tables.length
  const shownTables = tables

  return (
    <div ref={root} id="designer_body" className={fullscreen ? 'designer content_fullscreen' : 'designer'}>
      {!builder && (
        <div id="name-panel">
          <span id="page_name">{pageName}</span> <span id="saved_state">{star ? '*' : ''}</span>
        </div>
      )}
      <div
        className={right ? 'designer_header side-menu right' : 'designer_header side-menu'}
        id="side_menu"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {btn(
          'key_Show_left_menu',
          leftMenu ? 'designer/uparrow2_m' : 'designer/downarrow2_m',
          t('Show/Hide tables list'),
          () => setLeftMenu((v) => !v),
          leftMenu,
        )}
        {btn(
          'toggleFullscreen',
          fullscreen ? 'designer/exitFullscreen' : 'designer/viewInFullscreen',
          fullscreen ? t('Exit fullscreen') : t('View in fullscreen'),
          toggleFullscreen,
        )}
        {btn('addOtherDbTables', 'designer/other_table', t('Add tables from other databases'), () =>
          setDialog({ kind: 'addTable' }),
        )}
        {!builder && (
          <>
            {btn('newPage', 'designer/page_add', t('New page'), () => promptToSave(() => loadPage(-1)))}
            {btn('editPage', 'designer/page_edit', t('Open page'), () =>
              promptToSave(() => setDialog({ kind: 'edit' })),
            )}
            {btn('savePos', 'designer/save', t('Save page'), () => save3())}
            {btn('SaveAs', 'designer/save_as', t('Save page as'), () => setDialog({ kind: 'saveAs' }))}
            {btn('delPages', 'designer/page_delete', t('Delete pages'), () => setDialog({ kind: 'delete' }))}
            {btn('StartTableNew', 'designer/table', t('Create table'), () =>
              navigate({ to: path(`${dbBase(r.server, r.db)}/create-table`) }),
            )}
            {btn('rel_button', 'designer/relation', t('Create relationship'), startRelation, onRelation)}
            {btn(
              'display_field_button',
              'designer/display_field',
              t('Choose column to display'),
              startDisplayField,
              onDisplay,
            )}
            {btn('reloadPage', 'designer/reload', t('Reload'), () => loadPage(selectedPage))}
            {btn('', 'designer/help', t('Help'), () => undefined, false, {
              href: pmaDocUrl('faq', 'faq6-31'),
            })}
          </>
        )}
        {btn(
          'angular_direct_button',
          'designer/ang_direct',
          `${t('Angular links')} / ${t('Direct links')}`,
          () => {
            saveValue('angular_direct', angular ? 'direct' : 'angular')
            setAngular(!angular)
          },
          angular,
        )}
        {btn(
          'grid_button',
          'designer/grid',
          t('Snap to grid'),
          () => {
            saveValue('snap_to_grid', grid ? 'off' : 'on')
            setGrid(!grid)
          },
          grid,
        )}
        {btn(
          'key_SB_all',
          sbAll.alt === 'v' ? 'designer/downarrow1' : 'designer/rightarrow1',
          t('Small/Big All'),
          smallTabAll,
          sbAll.selected,
        )}
        {btn('SmallTabInvert', 'designer/bottom', t('Toggle small/big'), () =>
          setTables((ts) => ts.map((x) => ({ ...x, collapsed: !x.collapsed }))),
        )}
        {btn(
          'relLineInvert',
          'designer/toggle_lines',
          t('Toggle relationship lines'),
          () => {
            saveValue('relation_lines', String(!showLines))
            setShowLines(!showLines)
          },
          showLines,
        )}
        {!builder
          ? btn('exportPages', 'designer/export', t('Export schema'), () => setDialog({ kind: 'export' }))
          : btn('build_query_button', 'designer/query_builder', t('Build Query'), runBuild)}
        {btn(
          'key_Left_Right',
          right ? 'designer/2leftarrow_m' : 'designer/2rightarrow_m',
          t('Move Menu'),
          () => {
            saveValue('side_menu', String(!right))
            setRight(!right)
          },
        )}
        {btn(
          'pin_Text',
          'designer/anchor',
          t('Pin text'),
          () => {
            saveValue('pin_text', String(!pinned))
            setPinned(!pinned)
          },
          pinned,
        )}
      </div>

      <div id="canvas_outer">
        <form id="container-form" name="form1" onSubmit={(e) => e.preventDefault()}>
          {leftMenu && (
            <div id="layer_menu" className={right ? 'float-start' : ''}>
              <div className="text-center">
                <Button variant="ghost" size="icon" className="M_butt" onClick={hideTabAll}>
                  <PmaIcon
                    name={hsAll === 'v' ? 'designer/downarrow1' : 'designer/rightarrow1'}
                    alt={t('Hide/Show all')}
                  />
                </Button>
                <Button variant="ghost" size="icon" className="M_butt" onClick={noHaveConstr}>
                  <PmaIcon
                    name={hs === 'v' ? 'designer/downarrow2' : 'designer/rightarrow2'}
                    alt={t('Hide/Show tables with no relationship')}
                  />
                </Button>
              </div>
              <div id="id_scroll_tab" className="scroll_tab">
                <table className="w-full">
                  <tbody>
                    {shownTables.map((x) => (
                      <tr key={x.key}>
                        <td
                          title={t('Structure')}
                          className="L_butt2_1 scroll_tab_struct"
                          onClick={() => openStructure(x)}
                          onKeyDown={(e) => e.key === 'Enter' && openStructure(x)}
                        >
                          <PmaIcon name="designer/exec" />
                        </td>
                        <td>
                          <NativeCheckbox
                            className="scroll_tab_checkbox"
                            title={x.visible ? t('Hide') : t('Show')}
                            id={`check_vis_${x.key}`}
                            value={x.key}
                            checked={x.visible}
                            onChange={(e) => visibleTab(x.key, e.currentTarget.checked)}
                          />
                        </td>
                        <td
                          className="designer_Tabs"
                          onClick={() => selectTab(x.key)}
                          onKeyDown={(e) => e.key === 'Enter' && selectTab(x.key)}
                        >
                          {x.key}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-center">
                {t('Number of tables:')} <span id="tables_counter">{visibleCount}</span>
              </div>
            </div>
          )}
          <div id="osn_tab" style={{ width: size.w, height: size.h }}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: relation lines are picked with the mouse (phpMyAdmin's canvas) */}
            <svg
              id="canvas"
              className="designer"
              width={Math.max(0, size.w - 3)}
              height={Math.max(0, size.h - 3)}
              style={{ display: dragging !== null ? 'none' : undefined }}
              onClick={canvasClick}
              role="presentation"
            >
              {showLines &&
                lines.map((l, li) => {
                  const sel = updRel !== null && updRel.rel === l.rel
                  const color = sel ? SELECTED : l.color
                  const segs = angular ? line3(l.line) : line2(l.line)
                  return (
                    <g key={`${li}|${l.rel.masterTable}|${l.rel.masterField}`} stroke={color}>
                      <circle cx={l.line.x1} cy={l.line.y1} r={3} strokeWidth={3} fill="none" />
                      <rect
                        x={l.line.x2 - 1}
                        y={l.line.y2 - 2}
                        width={4}
                        height={4}
                        fill={color}
                        stroke="none"
                      />
                      {segs.map((s, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the three segments of a line
                        <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} strokeWidth={1} />
                      ))}
                    </g>
                  )
                })}
            </svg>
            {tables.map((x, i) => (
              <CanvasTable
                key={x.key}
                index={i}
                t={x}
                builder={builder}
                displayField={displayField[x.table] ?? null}
                highlight={highlight === x.key}
                tableRef={(el) => {
                  if (el === null) tableEls.current.delete(x.key)
                  else tableEls.current.set(x.key, el)
                }}
                cellRef={(col, el) => {
                  if (el === null) cellEls.current.delete(`${x.key}\u0000${col}`)
                  else cellEls.current.set(`${x.key}\u0000${col}`, el)
                }}
                onDragStart={() => setDragging(x.key)}
                onSmall={() => smallTab(x.key)}
                onStructure={() =>
                  void navigate({ to: path(`${tableBase(r.server, x.db, x.table)}/structure`) })
                }
                onField={(col, e) => clickTableField(x, col, e)}
                checked={(col) => checkedCols.has(`${x.key}\u0000${col}`)}
                allChecked={allChecked.has(x.key)}
                onCheck={(col, c) => toggleColumn(x, col, c)}
                onCheckAll={(c) => toggleAll(x, c)}
                onOption={(col, e) => setOption({ db: x.db, table: x.table, col, x: e.clientX })}
              />
            ))}
          </div>
        </form>
      </div>

      {hint !== '' && (
        <div
          id="designer_hint"
          style={{ display: 'block', position: 'fixed', left: hintPos.x, top: hintPos.y }}
        >
          {hint}
        </div>
      )}

      {newRel !== null && (
        <table
          id="layer_new_relation"
          className="designer-pane"
          style={{ position: 'fixed', left: newRel.x, top: newRel.y, transform: 'translate(-50%, -100%)' }}
        >
          <tbody>
            <tr>
              <td className="input_tab">
                <table className="w-full text-center">
                  <thead>
                    <tr>
                      <td colSpan={2} className="text-center whitespace-nowrap">
                        <strong>{t('Create relationship')}</strong>
                      </td>
                    </tr>
                  </thead>
                  {newRel.foreign && (
                    <tbody id="foreign_relation">
                      <tr>
                        <td colSpan={2} className="text-center whitespace-nowrap">
                          <strong>FOREIGN KEY</strong>
                        </td>
                      </tr>
                      <tr>
                        <td className="whitespace-nowrap px-1">
                          <label htmlFor="on_delete">on delete</label>
                        </td>
                        <td className="px-1">
                          <RefOption id="on_delete" value={onDelete} onChange={setOnDeleteAction} />
                        </td>
                      </tr>
                      <tr>
                        <td className="whitespace-nowrap px-1">
                          <label htmlFor="on_update">on update</label>
                        </td>
                        <td className="px-1">
                          <RefOption id="on_update" value={onUpdate} onChange={setOnUpdateAction} />
                        </td>
                      </tr>
                    </tbody>
                  )}
                  <tbody>
                    <tr>
                      <td colSpan={2} className="text-center whitespace-nowrap">
                        <input
                          type="button"
                          id="ok_new_rel_panel"
                          className={buttonVariants({ size: 'sm' })}
                          name="Button"
                          value={t('OK')}
                          onClick={newRelation}
                        />
                        <input
                          type="button"
                          id="cancel_new_rel_panel"
                          className={buttonVariants({ size: 'sm' })}
                          name="Button"
                          value={t('Cancel')}
                          onClick={() => setNewRel(null)}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {updRel !== null && (
        <table
          id="layer_upd_relation"
          className="designer-pane"
          style={{
            position: 'fixed',
            left: updRel.x,
            top: updRel.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <tbody>
            <tr>
              <td className="input_tab">
                <table className="w-full text-center">
                  <tbody>
                    <tr>
                      <td colSpan={3} className="text-center whitespace-nowrap">
                        <strong>{t('Delete relationship')}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-center whitespace-nowrap">
                        <input
                          id="del_button"
                          name="Button"
                          type="button"
                          className={buttonVariants({ size: 'sm' })}
                          value={t('Delete')}
                          onClick={removeRelation}
                        />
                        <input
                          id="cancel_button"
                          type="button"
                          className={buttonVariants({ size: 'sm' })}
                          name="Button"
                          value={t('Cancel')}
                          onClick={() => setUpdRel(null)}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {builder && option !== null && (
        <OptionsPane
          column={option.col}
          form={optionForm}
          setForm={setOptionForm}
          onOk={optionAdd}
          onCancel={() => {
            setOption(null)
            setOptionForm(emptyOptions())
          }}
          style={{
            position: 'fixed',
            left: option.x,
            top: window.screen.height / 4,
            transform: 'translateX(-50%)',
          }}
        />
      )}
      {builder && editing !== null && (
        <EditHistoryPane
          pane={editing.pane}
          values={editing.values}
          setValues={(values) => setEditing({ ...editing, values })}
          onOk={editOk}
          onCancel={() => setEditing(null)}
        />
      )}
      {builder && (
        <>
          {panelOpen && (
            <div className="panel" style={{ display: 'block' }}>
              <div className="clearfloat" />
              <HistoryPanel
                history={qb.history}
                onAndOr={(i) =>
                  setQb((s) => ({
                    ...s,
                    history: s.history.map((h, j) => (j === i ? { ...h, andOr: h.andOr ? 0 : 1 } : h)),
                  }))
                }
                onEdit={editHistory}
                onDelete={(i) => setQb((s) => historyDelete(s, i))}
              />
              <div className="clearfloat" />
            </div>
          )}
          <Button
            variant="link"
            className={panelOpen ? 'trigger active' : 'trigger'}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {t('Active options')}
          </Button>
        </>
      )}

      {dialog?.kind === 'prompt' && (
        <PromptModal
          onClose={() => setDialog(null)}
          onYes={() => {
            const then = dialog.then
            setDialog(null)
            save3(then)
          }}
          onNo={() => {
            const then = dialog.then
            setDialog(null)
            then()
          }}
        />
      )}
      {dialog?.kind === 'savePage' && (
        <SavePageModal onClose={() => setDialog(null)} onGo={(name) => saveNew(name, dialog.then)} />
      )}
      {(dialog?.kind === 'edit' || dialog?.kind === 'delete') && (
        <EditDeletePagesModal
          r={r}
          offline={!data.tablesEnabled}
          operation={dialog.kind === 'edit' ? 'editPage' : 'deletePage'}
          onClose={() => setDialog(null)}
          onGo={(p) => {
            if (dialog.kind === 'edit') {
              setDialog(null)
              loadPage(Number.parseInt(p, 10))
            } else {
              deletePage(p)
            }
          }}
        />
      )}
      {dialog?.kind === 'saveAs' && (
        <SaveAsModal
          r={r}
          offline={!data.tablesEnabled}
          selectedPage={selectedPage}
          onClose={() => setDialog(null)}
          onGo={saveAs}
        />
      )}
      {dialog?.kind === 'export' && (
        <ExportSchemaModal r={r} page={selectedPage} onClose={() => setDialog(null)} onGo={exportSchema} />
      )}
      {dialog?.kind === 'addTable' && (
        <AddTablesModal server={r.server} onClose={() => setDialog(null)} onGo={addTable} />
      )}
      {dialog?.kind === 'build' && (
        <BuildQueryModal
          sql={dialog.sql}
          codemirror={data.codemirror}
          onClose={() => setDialog(null)}
          onSubmit={(sql) => {
            setDialog(null)
            void navigate({ to: path(`${dbBase(r.server, r.db)}/sql`), search: { sql } as never })
          }}
        />
      )}
    </div>
  )
}

/** the on delete / on update lists of #layer_new_relation */
function RefOption({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect name={id} id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      <option value="nix">--</option>
      <option value="CASCADE">CASCADE</option>
      <option value="SET NULL">SET NULL</option>
      <option value="NO ACTION">NO ACTION</option>
      <option value="RESTRICT">RESTRICT</option>
    </NativeSelect>
  )
}

/** database_tables.twig: one table of the canvas */
function CanvasTable({
  index,
  t: x,
  builder,
  displayField,
  highlight,
  tableRef,
  cellRef,
  onDragStart,
  onSmall,
  onStructure,
  onField,
  checked,
  allChecked,
  onCheck,
  onCheckAll,
  onOption,
}: {
  index: number
  t: TState
  builder: boolean
  displayField: string | null
  highlight: boolean
  tableRef: (el: HTMLTableElement | null) => void
  cellRef: (col: string, el: HTMLElement | null) => void
  onDragStart: () => void
  onSmall: () => void
  onStructure: () => void
  onField: (col: string, e: ReactMouseEvent) => void
  checked: (col: string) => boolean
  allChecked: boolean
  onCheck: (col: string, checked: boolean) => void
  onCheckAll: (checked: boolean) => void
  onOption: (col: string, e: ReactMouseEvent) => void
}) {
  const [over, setOver] = useState(false)
  const zag = over || highlight ? 'tab_zag_2' : 'tab_zag'
  return (
    <table
      id={x.key}
      ref={tableRef}
      className="designer_tab"
      style={{ position: 'absolute', left: x.x, top: x.y, display: x.visible ? 'block' : 'none', zIndex: 1 }}
    >
      <thead>
        <tr className="header">
          {builder && (
            <td className="select_all">
              <NativeCheckbox
                className="select_all_1"
                value={`select_all_${x.key}`}
                id={`select_all_${index}`}
                title={t('Select all')}
                checked={allChecked}
                onChange={(e) => onCheckAll(e.currentTarget.checked)}
              />
            </td>
          )}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: phpMyAdmin's clickable cell */}
          <td
            className="small_tab"
            title={t('Show/hide columns')}
            id={`id_hide_tbody_${x.key}`}
            onClick={onSmall}
          >
            {x.collapsed ? '>' : 'v'}
          </td>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: phpMyAdmin's clickable cell */}
          <td className="small_tab_pref small_tab_pref_1" onClick={onStructure}>
            <PmaIcon name="designer/exec_small" alt={t('See table structure')} />
          </td>
          <td
            id={`id_zag_${x.key}`}
            className={`${zag} whitespace-nowrap tab_zag_noquery`}
            onMouseDown={(e) => {
              e.preventDefault()
              onDragStart()
            }}
            onMouseOver={() => setOver(true)}
            onMouseOut={() => setOver(false)}
            onFocus={() => undefined}
            onBlur={() => undefined}
          >
            <span className="owner">{x.db}</span> {x.table}
          </td>
          {builder && <td className={`${zag} tab_zag_query`} id={`id_zag_${x.key}_2`} />}
        </tr>
      </thead>
      <tbody id={`id_tbody_${x.key}`} style={x.collapsed ? { display: 'none' } : undefined}>
        {x.info.columns.map((c) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: phpMyAdmin's clickable row
          <tr
            key={c.name}
            id={`id_tr_${x.table}.${c.name}`}
            className={displayField === c.name ? 'tab_field_3' : 'tab_field'}
            onClick={(e) => onField(c.name, e)}
          >
            {builder && (
              <td className="select_all">
                <NativeCheckbox
                  className="select_all_store_col"
                  value={`${x.key}${c.name}`}
                  id={`select_${x.key}._${c.name}`}
                  title={t('Select "%s"', c.name)}
                  checked={checked(c.name)}
                  disabled={allChecked}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onCheck(c.name, e.currentTarget.checked)}
                />
              </td>
            )}
            <td colSpan={3} id={`${x.key}.${c.name}`} ref={(el) => cellRef(c.name, el)}>
              <div className="whitespace-nowrap">
                <PmaIcon name={c.icon as PmaIconName} alt="*" /> {c.name} : {c.type}
              </div>
            </td>
            {builder && (
              // biome-ignore lint/a11y/useKeyWithClickEvents: phpMyAdmin's clickable cell
              <td
                className="small_tab_pref small_tab_pref_click_opt"
                onClick={(e) => {
                  e.stopPropagation()
                  onOption(c.name, e)
                }}
              >
                <PmaIcon name="designer/exec_small" alt={t('Options')} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
