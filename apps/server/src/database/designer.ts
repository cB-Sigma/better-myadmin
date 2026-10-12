import type {
  DesignerActionResponse,
  DesignerAddRelationRequest,
  DesignerColumn,
  DesignerPagesResponse,
  DesignerQuery,
  DesignerRelation,
  DesignerRemoveRelationRequest,
  DesignerResponse,
  DesignerSavePageRequest,
  DesignerSavePageResponse,
  DesignerSideMenu,
  DesignerTable,
} from '@bettermyadmin/contracts'
import { htmlspecialchars, sprintf } from '@bettermyadmin/i18n'
import {
  designerAddInternalRelation,
  designerCreatePage,
  designerDefaultPage,
  designerDeletePage,
  designerLoadingPage,
  designerPageExists,
  designerPageName,
  designerPages,
  designerRemoveInternalRelation,
  designerSavePositions,
  designerSaveSetting,
  designerSettings,
  designerTablePositions,
  getColumnFromForeignKeysData,
  getDisplayField,
  getForeignKeysData,
  getForeignersInternal,
  updateDisplayField,
} from '@bettermyadmin/metadata'
import { backquote } from '@bettermyadmin/sql-gen'
import { type DbCtx, msg, successText, tryQuery } from './context.ts'
import { getTablesFull } from './tables.ts'

/**
 * The Designer: the canvas data, its pages, relations and display fields.
 * pma: src/Controllers/Database/DesignerController.php, src/Database/Designer.php,
 *      src/Database/Designer/Common.php, resources/templates/database/designer/*.twig
 */

/** a DesignerTable of Common::getTablesInfo, before its columns are read */
interface InfoTable {
  db: string
  table: string
  engine: string
  displayField: string | null
}

/** pma: src/Utils/ForeignKey.php::isSupported */
export async function fkSupported(ctx: DbCtx, engine: string): Promise<boolean> {
  const e = engine.toUpperCase()
  if (e === 'INNODB' || e === 'PBXT') return true
  if (e === 'NDBCLUSTER' || e === 'NDB') {
    let v = String((await ctx.dbi.fetchValue('SELECT @@ndb_version_string')) || '').toLowerCase()
    if (v.startsWith('ndb-')) v = v.slice(4)
    const [a = 0, b = 0] = v.split('.').map(Number)
    return a > 7 || (a === 7 && b >= 3)
  }
  return false
}

/** Common::getTablesInfo: every table of `db` (or the one `table`) with its display field */
async function getTablesInfo(ctx: DbCtx, db = ctx.db, table = ''): Promise<InfoTable[]> {
  await ctx.reader.selectDb(db)
  const rows = await getTablesFull(ctx, db, table !== '' ? { table: [table] } : {})
  const out: InfoTable[] = []
  for (const row of rows) {
    const name = row.TABLE_NAME ?? ''
    const df = await getDisplayField(ctx.control, ctx.rp, db, name, async () =>
      (await ctx.reader.getColumns(db, name)).map((c) => ({ field: c.Field, type: c.Type })),
    )
    out.push({ db, table: name, engine: row.ENGINE ?? '', displayField: df !== '' ? df : null })
  }
  return out
}

/** DatabaseInterface::query (ends the request on error): the rows as strings */
async function queryRows(
  ctx: DbCtx,
  sql: string,
  label: string,
): Promise<{ fields: string[]; rows: string[][] }> {
  const set = (await ctx.conn.query(sql, label)).resultSets[0]
  return {
    fields: set?.fields.map((f) => f.name) ?? [],
    rows: set?.rows.map((row) => row.map((v) => (v === null ? '' : v.toString('utf8')))) ?? [],
  }
}

/** Designer::getColumnTypes for one column */
function columnIcon(type: string, key: boolean | null): string {
  if (key === true) return 'designer/FieldKey_small'
  let icon = 'designer/Field_small'
  if (type.includes('char') || type.includes('text')) icon += '_char'
  else if (['int', 'float', 'double', 'decimal'].some((x) => type.includes(x))) icon += '_int'
  else if (['date', 'time', 'year'].some((x) => type.includes(x))) icon += '_date'
  return icon
}

/** Common::getColumnsInfo + Common::getAllKeys + Designer::getColumnTypes for one table */
async function columnsOf(ctx: DbCtx, t: InfoTable): Promise<DesignerColumn[]> {
  const collate = await ctx.dbi.collateForIS()
  const q = (s: string) => ctx.dbi.quoteString(s)
  const r = await queryRows(
    ctx,
    `SELECT \`COLUMN_NAME\`, \`COLUMN_TYPE\` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${q(t.db)} AND \`TABLE_NAME\` ${collate} = ${q(t.table)} ORDER BY \`ORDINAL_POSITION\``,
    'designer.columns',
  )
  // getAllKeys: a later index of the same column overwrites an earlier one
  const keys = new Map<string, boolean>()
  for (const index of await ctx.reader.getIndexes(t.db, t.table)) {
    for (const c of index.columns) keys.set(c.name, !index.nonUnique)
  }
  return r.rows.map((row) => {
    const name = row[0] ?? ''
    const type = row[1] ?? ''
    const key = keys.get(name) ?? null
    return { name, type, icon: columnIcon(type, key), key }
  })
}

/**
 * Common::getScriptContr: the relations (internal ones, then FOREIGN KEY columns) of the current
 * database's tables whose both ends are on the canvas.
 */
async function getScriptContr(ctx: DbCtx, tables: readonly InfoTable[]): Promise<DesignerRelation[]> {
  const { db } = ctx
  await ctx.reader.selectDb(db)
  const all = await queryRows(ctx, `SHOW TABLES FROM ${backquote(db)}`, 'designer.tables')
  const names = new Set(tables.map((t) => `${t.db}.${t.table}`))
  const out: DesignerRelation[] = []
  const add = (r: DesignerRelation) => {
    if (names.has(r.masterTable) && names.has(r.foreignTable)) out.push(r)
  }
  for (const row of all.rows) {
    const val = row[0] ?? ''
    for (const [field, v] of Object.entries(await getForeignersInternal(ctx.control, ctx.rp, db, val))) {
      add({
        constraint: '',
        masterTable: `${db}.${val}`,
        masterField: field,
        foreignTable: `${v.foreign_db}.${v.foreign_table}`,
        foreignField: v.foreign_field,
      })
    }
    for (const k of getForeignKeysData(await ctx.reader.showCreate(db, val))) {
      k.indexList.forEach((field, i) => {
        add({
          constraint: k.constraint ?? '',
          masterTable: `${db}.${val}`,
          masterField: field,
          foreignTable: `${k.refDbName ?? db}.${k.refTableName ?? ''}`,
          foreignField: k.refIndexList[i] ?? '',
        })
      })
    }
  }
  return out
}

/** DesignerController::getDefaultTablePositions: Randomizer::getInt(20, 700) / (20, 550) */
const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

async function designerTables(
  ctx: DbCtx,
  infos: readonly InfoTable[],
  positions: ReadonlyMap<string, { x: string; y: string }>,
): Promise<DesignerTable[]> {
  const out: DesignerTable[] = []
  for (const t of infos) {
    const pos = positions.get(`${t.db}.${t.table}`)
    out.push({
      db: t.db,
      table: t.table,
      supportsFk: await fkSupported(ctx, t.engine),
      displayField: t.displayField,
      columns: await columnsOf(ctx, t),
      x: pos !== undefined ? Number.parseInt(pos.x, 10) || 0 : randomInt(20, 700),
      y: pos !== undefined ? Number.parseInt(pos.y, 10) || 0 : randomInt(20, 550),
      onPage: pos !== undefined,
    })
  }
  return out
}

/** Designer::returnClassNamesFromMenuButtons */
async function sideMenu(ctx: DbCtx): Promise<DesignerSideMenu> {
  const p = await designerSettings(ctx.control, ctx.rp, ctx.user)
  const v = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'boolean' ? String(p[k]) : '')
  return {
    angular_direct: v('angular_direct') === 'angular',
    snap_to_grid: v('snap_to_grid') === 'on',
    pin_text: v('pin_text') === 'true',
    relation_lines: v('relation_lines') === 'false',
    small_big_all: v('small_big_all') === 'v',
    side_menu: v('side_menu') === 'true',
  }
}

/** GET /database/designer (the canvas) */
export async function designerPage(ctx: DbCtx, q: DesignerQuery): Promise<DesignerResponse> {
  const { db, rp } = ctx
  const infos = await getTablesInfo(ctx)
  const visualBuilder = q.query !== undefined
  let displayPage: number
  if (visualBuilder) displayPage = await designerDefaultPage(ctx.control, rp, db)
  else if (q.page !== undefined) displayPage = Number.parseInt(q.page, 10) || 0
  else displayPage = await designerLoadingPage(ctx.control, rp, db)
  const selectedPage = displayPage !== -1 ? await designerPageName(ctx.control, rp, displayPage) : null
  const positions = await designerTablePositions(ctx.control, rp, displayPage)
  const full = new Set(infos.map((t) => `${t.db}.${t.table}`))
  for (const p of positions.values()) {
    if (full.has(`${p.dbName}.${p.tableName}`)) continue
    infos.push(...(await getTablesInfo(ctx, p.dbName, p.tableName)))
  }
  const tables = await designerTables(ctx, infos, positions)
  const relations = await getScriptContr(ctx, infos)
  return {
    db,
    displayPage,
    selectedPage,
    visualBuilder,
    tablesEnabled: rp.pdfFeature !== null,
    sideMenu: await sideMenu(ctx),
    tables,
    relations,
    codemirror: ctx.cfg.CodemirrorEnable,
  }
}

/** dialog=add_table: one table of another database, at a random position */
export async function designerAddTable(ctx: DbCtx, db: string, table: string): Promise<DesignerTable[]> {
  return designerTables(ctx, await getTablesInfo(ctx, db, table), new Map())
}

/** dialog=edit|delete|save_as: Designer::getPageIdsAndNames */
export async function designerPageList(ctx: DbCtx): Promise<DesignerPagesResponse> {
  return {
    pdfwork: ctx.rp.pdfFeature !== null,
    pages: await designerPages(ctx.control, ctx.rp, ctx.db),
  }
}

/** operation=savePage */
export async function designerSavePage(
  ctx: DbCtx,
  req: DesignerSavePageRequest,
): Promise<DesignerSavePageResponse> {
  const { tr, rp } = ctx
  let page: number
  let id: number | undefined
  if (req.save_page === 'same') {
    page = Number.parseInt(req.selected_page, 10) || 0
  } else if (await designerPageExists(ctx.control, rp, req.selected_value)) {
    return {
      success: false,
      message: sprintf(
        tr.gettext('There already exists a page named "%s" please rename it to something else.'),
        htmlspecialchars(req.selected_value),
      ),
    }
  } else {
    // Relation::createPage
    const name = req.selected_value !== '' ? req.selected_value : tr.gettext('no description')
    const created = await designerCreatePage(ctx.control, rp, name, ctx.db)
    page = created ?? 0
    if (created !== null) id = created
  }
  const success = await designerSavePositions(
    ctx.control,
    rp,
    page,
    req.tables.map((t) => ({ db: t.db, table: t.table, x: t.x, y: t.y, visible: t.h })),
  )
  return id !== undefined ? { success, id } : { success }
}

/** operation=deletePage */
export async function designerDelete(ctx: DbCtx, selectedPage: string): Promise<{ success: boolean }> {
  return { success: await designerDeletePage(ctx.control, ctx.rp, Number.parseInt(selectedPage, 10) || 0) }
}

/** operation=setDisplayField: Common::saveDisplayField */
export async function designerSetDisplayField(
  ctx: DbCtx,
  db: string,
  table: string,
  field: string,
): Promise<DesignerActionResponse> {
  if (ctx.rp.displayFeature === null || ctx.control === null) {
    return {
      success: false,
      message: msg(
        'error',
        ctx.tr.pgettext(
          'phpMyAdmin configuration storage is not configured for "Display Features" on designer when user tries to set a display field.',
          'phpMyAdmin configuration storage is not configured for "Display Features".',
        ),
      ),
    }
  }
  await updateDisplayField(ctx.control, ctx.rp, db, table, field)
  return { success: true, message: msg('success', successText(ctx.tr)) }
}

const ok = (text: string): DesignerActionResponse => ({ success: true, message: msg('success', text) })
const fail = (text: string): DesignerActionResponse => ({ success: false, message: msg('error', text) })

/** Index column names of SHOW INDEX (fetchAllColumn('Column_name')); `query()` ends the request on error */
async function indexColumns(ctx: DbCtx, db: string, table: string): Promise<string[]> {
  const r = await queryRows(ctx, `SHOW INDEX FROM ${backquote(db)}.${backquote(table)};`, 'designer.index')
  const i = r.fields.indexOf('Column_name')
  return r.rows.map((row) => row[i] ?? '')
}

/** operation=addNewRelation: Common::addNewRelation (T1/F1 referenced, T2/F2 referencing) */
export async function designerAddRelation(
  ctx: DbCtx,
  r: DesignerAddRelationRequest,
): Promise<DesignerActionResponse> {
  const { tr } = ctx
  const typeT1 = await ctx.reader.getEngine(r.DB1, r.T1)
  const typeT2 = await ctx.reader.getEngine(r.DB2, r.T2)
  if ((await fkSupported(ctx, typeT1)) && typeT1 === typeT2) {
    const existing = getForeignKeysData(await ctx.reader.showCreate(r.DB2, r.T2))
    const foreigner = getColumnFromForeignKeysData(existing, r.F2, ctx.db)
    if (foreigner !== false && foreigner.constraint !== null) {
      return fail(tr.gettext('Error: relationship already exists.'))
    }
    const index1 = await indexColumns(ctx, r.DB1, r.T1)
    const index2 = await indexColumns(ctx, r.DB2, r.T2)
    if (index1.includes(r.F1) && index2.includes(r.F2)) {
      let sql = `ALTER TABLE ${backquote(r.DB2)}.${backquote(r.T2)} ADD FOREIGN KEY (${backquote(r.F2)}) REFERENCES ${backquote(r.DB1)}.${backquote(r.T1)}(${backquote(r.F1)})`
      if (r.on_delete !== 'nix') sql += ` ON DELETE ${r.on_delete}`
      if (r.on_update !== 'nix') sql += ` ON UPDATE ${r.on_update}`
      sql += ';'
      const error = await tryQuery(ctx, sql, 'designer.fk')
      if (error === null) return ok(tr.gettext('FOREIGN KEY relationship has been added.'))
      return fail(`${tr.gettext('Error: FOREIGN KEY relationship could not be added!')}<br>${error}`)
    }
    return fail(tr.gettext('Error: Missing index on column(s).'))
  }
  if (ctx.rp.relationFeature === null || ctx.control === null) {
    return fail(tr.gettext('Error: Relational features are disabled!'))
  }
  const error = await designerAddInternalRelation(ctx.control, ctx.rp, {
    masterDb: r.DB2,
    masterTable: r.T2,
    masterField: r.F2,
    foreignDb: r.DB1,
    foreignTable: r.T1,
    foreignField: r.F1,
  })
  if (error === null) return ok(tr.gettext('Internal relationship has been added.'))
  return fail(`${tr.gettext('Error: Internal relationship could not be added!')}<br>${error}`)
}

/** operation=removeRelation: Common::removeRelation */
export async function designerRemoveRelation(
  ctx: DbCtx,
  r: DesignerRemoveRelationRequest,
): Promise<DesignerActionResponse> {
  const { tr } = ctx
  // [$db1, $t1] = explode('.', $t1)
  const [db1 = '', t1 = ''] = r.T1.split('.')
  const [db2 = '', t2 = ''] = r.T2.split('.')
  const typeT1 = await ctx.reader.getEngine(db1, t1)
  const typeT2 = await ctx.reader.getEngine(db2, t2)
  if ((await fkSupported(ctx, typeT1)) && typeT1 === typeT2) {
    const existing = getForeignKeysData(await ctx.reader.showCreate(db2, t2))
    const foreigner = getColumnFromForeignKeysData(existing, r.F2, ctx.db)
    if (foreigner !== false && foreigner.constraint !== null) {
      await ctx.conn.query(
        `ALTER TABLE ${backquote(db2)}.${backquote(t2)} DROP FOREIGN KEY ${backquote(foreigner.constraint)};`,
        'designer.fk',
      )
      return ok(tr.gettext('FOREIGN KEY relationship has been removed.'))
    }
  }
  if (ctx.rp.relationFeature === null || ctx.control === null) {
    return fail(tr.gettext('Error: Relational features are disabled!'))
  }
  const error = await designerRemoveInternalRelation(ctx.control, ctx.rp, {
    masterDb: db2,
    masterTable: t2,
    masterField: r.F2,
    foreignDb: db1,
    foreignTable: t1,
    foreignField: r.F1,
  })
  if (error !== null) {
    return fail(`${tr.gettext('Error: Internal relationship could not be removed!')}<br>${error}`)
  }
  return ok(tr.gettext('Internal relationship has been removed.'))
}

/** operation=save_setting_value */
export async function designerSetting(
  ctx: DbCtx,
  index: string,
  value: string,
): Promise<{ success: boolean }> {
  return { success: await designerSaveSetting(ctx.control, ctx.rp, ctx.user, index, value) }
}
