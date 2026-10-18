import { type Browser, type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * The results grid's micro-behaviours (docs/features/02-browse-results-grid.md) in the browser,
 * next to the reference phpMyAdmin (BMA_PARITY_PMA_URL, default :8081) where its page can be
 * compared: header hover / marking and sort icons, sticky headers, the cell editor (type, size,
 * NULL box, GridEditing), SaveCellsAtOnce, column reorder / resize / restore, row action and
 * navigation captions, the options panel, the full/partial toggle, the page settings gear, the
 * Edit / Copy links, With selected and Print. Objects carry the run's port.
 */
const RUN = process.env.BMA_E2E_PORT ?? '8099'
const DB = `f02c_e2e${RUN}`
const USER = `f02c_u${RUN}`
const PUSER = `f02c_p${RUN}`
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'

async function sql(q: string): Promise<unknown[][]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query({ sql: q, rowsAsArray: true }))[0] as unknown[][]
  } finally {
    await c.end()
  }
}

let pmaUp = false

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE e (id INT PRIMARY KEY, name VARCHAR(20), txt TEXT, j JSON, n INT NULL,
      nn VARCHAR(5) NOT NULL DEFAULT '', d DATETIME(3) NULL) ENGINE=InnoDB;
    INSERT INTO e VALUES (1, 'one', 't1', '{"a":1}', 5, 'x', '2024-01-02 03:04:05.678'),
      (2, 'two', 't2', '[1,2]', NULL, 'y', NULL), (3, 'three', 't3', NULL, 7, 'z', NULL);
    CREATE TABLE child (id INT PRIMARY KEY, e_id INT, FOREIGN KEY (e_id) REFERENCES e (id)) ENGINE=InnoDB;
    INSERT INTO child VALUES (1, 1), (2, 2);
    CREATE TABLE many (id INT PRIMARY KEY, v INT) ENGINE=InnoDB;
    INSERT INTO many VALUES ${Array.from({ length: 60 }, (_, i) => `(${i + 1}, ${i % 5})`).join(', ')};`)
  for (const u of [USER, PUSER]) {
    await sql(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';
      GRANT ALL ON \`${DB.replaceAll('_', '\\_')}\`.* TO '${u}'@'%';`)
  }
  // a routine and an event of the user (its editor reads their definitions)
  await sql(`USE ${DB}; CREATE DEFINER = '${USER}'@'%' PROCEDURE f02c_proc (IN a INT) SELECT a;
    CREATE DEFINER = '${USER}'@'%' EVENT f02c_ev ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1;`)
  await forgetPmaUiPrefs()
  pmaUp = await fetch(`${PMA_URL}/index.php`)
    .then((r) => r.ok)
    .catch(() => false)
})

/** The reference's remembered sorts / column orders of this run's user (its `phpmyadmin` storage). */
const forgetPmaUiPrefs = () =>
  sql(`DELETE FROM phpmyadmin.pma__table_uiprefs WHERE username = '${PUSER}'`).catch(() => [])

test.afterAll(async () => {
  await forgetPmaUiPrefs()
  await sql(
    `DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'; DROP USER IF EXISTS '${PUSER}'@'%'`,
  )
})

/** The user's stored preferences (the e2e server keeps them per user): replaced by `data`. */
async function setPrefs(page: Page, data: Record<string, unknown>) {
  await page.evaluate(async (configData) => {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('bma_token='))
      ?.slice('bma_token='.length)
    const r = await fetch('/api/servers/1/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BMA-Token': decodeURIComponent(token ?? '') },
      body: JSON.stringify({ configData }),
    })
    if (!r.ok) throw new Error(`prefs: ${r.status}`)
  }, data)
}

test.beforeEach(async ({ page }) => {
  await login(page, USER, USER)
  await setPrefs(page, {})
})

/** A logged-in page of the reference phpMyAdmin (its own browser context). */
async function pmaPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' })
  const page = await ctx.newPage()
  await page.goto(`${PMA_URL}/index.php?route=/`)
  await page.fill('#input_username', PUSER)
  await page.fill('#input_password', PUSER)
  await page.click('#input_go')
  await expect(page.locator('#pma_navigation')).toBeVisible()
  return page
}

async function pmaBrowse(page: Page, table: string) {
  await page.goto(`${PMA_URL}/index.php?route=/sql&db=${DB}&table=${table}&pos=0`)
  await expect(page.locator('table.table_results tbody tr').first()).toBeVisible()
  // makegrid has run (the column copy / pointer elements exist)
  await expect(page.locator('.cPointer')).toHaveCount(1)
}

async function browse(page: Page, table: string) {
  await page.goto(`/s/1/db/${DB}/t/${table}/browse`)
  await expect(page.locator('table.table_results tbody tr').first()).toBeVisible()
}

const dataRows = (page: Page) => page.locator('table.table_results tbody tr:not(.repeating_header_row)')
const columnIndex = (page: Page, name: string) =>
  page
    .locator('table.table_results thead th.draggable')
    .evaluateAll((a, n) => a.findIndex((x) => x.getAttribute('data-column') === n), name)
async function cell(page: Page, r: number, name: string) {
  return dataRows(page)
    .nth(r)
    .locator('td[data-type]')
    .nth(await columnIndex(page, name))
}
/** An icon's label: phpMyAdmin's <img alt>, our SVG's aria-label. */
const iconLabel = (icon: ReturnType<Page['locator']>) =>
  icon.evaluate((e) => e.getAttribute('alt') ?? e.getAttribute('aria-label'))
const headerOrder = (page: Page) =>
  page
    .locator('table.table_results thead th.draggable')
    .evaluateAll((a) => a.map((x) => x.getAttribute('data-column')))

test('a header hovered or clicked marks its whole column (Q73); hovering a sort link shows the other direction [p02-2ad7ce] [p02-315ef0]', async ({
  page,
  browser,
}) => {
  await browse(page, 'e')
  const th = page.locator('thead th[data-column="name"]')
  await th.hover({ position: { x: 3, y: 3 } })
  await expect(page.locator('tbody td.hover')).toHaveCount(3)
  await page.mouse.move(2, 2)
  await expect(page.locator('tbody td.hover')).toHaveCount(0)
  await th.click({ position: { x: 3, y: 3 } })
  await expect(page.locator('tbody td.marked')).toHaveCount(3)
  await expect(th).toHaveClass(/\bmarked\b/)
  await th.click({ position: { x: 3, y: 3 } })
  await expect(page.locator('tbody td.marked')).toHaveCount(0)
  // without BrowsePointerEnable / BrowseMarkerEnable nothing happens
  await setPrefs(page, { BrowsePointerEnable: false, BrowseMarkerEnable: false })
  await browse(page, 'e')
  await th.hover({ position: { x: 3, y: 3 } })
  await th.click({ position: { x: 3, y: 3 } })
  await expect(page.locator('tbody td.hover, tbody td.marked')).toHaveCount(0)
  await setPrefs(page, {})

  // sort by name: the icon shows the direction, hovering the link previews the other one
  await browse(page, 'e')
  await th.locator('.sortlink').click()
  await expect(th.locator('.soimg')).toHaveCount(2)
  await page.mouse.move(2, 2)
  await expect(th.locator('.soimg:visible')).toHaveCount(1)
  expect(await iconLabel(th.locator('.soimg:visible'))).toBe('Ascending')
  await th.locator('.sortlink').hover()
  await expect.poll(() => iconLabel(th.locator('.soimg:visible'))).toBe('Descending')
  await page.mouse.move(2, 2)
  await expect.poll(() => iconLabel(th.locator('.soimg:visible'))).toBe('Ascending')
  // Ctrl+click takes the column out of the ORDER BY (and forgets the remembered sort)
  await th.locator('.sortlink').click({ modifiers: ['Control'] })
  await expect(th.locator('.soimg')).toHaveCount(0)

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  const pth = pma.locator('thead th[data-column="name"]')
  await pth.hover({ position: { x: 3, y: 3 } })
  // Q73: phpMyAdmin marks one cell (the first row's) instead of the column
  await expect(pma.locator('tbody td.hover')).toHaveCount(1)
  await pth.locator('a.sortlink').click()
  const psort = pma.locator('thead th[data-column="name"] .soimg:visible')
  await expect(pma.locator('thead th[data-column="name"] .soimg')).toHaveCount(2)
  await pma.mouse.move(2, 2)
  await expect(psort).toHaveCount(1)
  expect(await iconLabel(psort)).toBe('Ascending')
  await pma.locator('thead th[data-column="name"] a.sortlink').hover()
  await expect.poll(() => iconLabel(psort)).toBe('Descending')
  await pma.mouse.move(2, 2)
  await pma.locator('thead th[data-column="name"] a.sortlink').click({ modifiers: ['Control'] })
  await expect(pma.locator('thead th[data-column="name"] .soimg')).toHaveCount(0)
  await pma.context().close()
})

test('headers are sticky, numeric columns right-aligned, hidden columns carry hide [p02-cf9ddf]', async ({
  page,
  browser,
}) => {
  await browse(page, 'e')
  const id = page.locator('thead th[data-column="id"]')
  expect(await id.evaluate((e) => getComputedStyle(e).position)).toBe('sticky')
  await expect(id).toHaveClass(/\btext-end\b/)
  await expect(page.locator('thead th[data-column="name"]')).not.toHaveClass(/\btext-end\b/)
  await expect(await cell(page, 0, 'id')).toHaveClass(/\btext-end\b/)
  await expect(await cell(page, 0, 'n')).toHaveClass(/\btext-end\b/)
  // hide "txt" from the column visibility list
  await page.locator('.coldrop').click()
  await page.locator('.cList label', { hasText: /^txt$/ }).locator('input').uncheck()
  await page.keyboard.press('Escape')
  await expect(page.locator('thead th[data-column="txt"]')).toHaveClass(/\bhide\b/)
  await expect(page.locator('tbody td.hide')).toHaveCount(3)
  await page.locator('.coldrop').click()
  await page.locator('.cList label', { hasText: /^txt$/ }).locator('input').check()
  await page.keyboard.press('Escape')
  await expect(page.locator('tbody td.hide')).toHaveCount(0)

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  await expect(pma.locator('thead th[data-column="id"]')).toHaveClass(/\bposition-sticky\b.*\btext-end\b/)
  expect(await pma.locator('thead th[data-column="id"]').evaluate((e) => getComputedStyle(e).position)).toBe(
    'sticky',
  )
  await pma.context().close()
})

test('the cell editor: a textarea for strings, BLOBs and JSON, an input otherwise; the cell’s size, the cursor at the end, JSON pretty-printed [p02-2128ec]', async ({
  page,
}) => {
  await browse(page, 'e')
  const expected: Array<[string, 'TEXTAREA' | 'INPUT', string]> = [
    ['id', 'INPUT', '1'],
    ['name', 'TEXTAREA', 'one'],
    ['txt', 'TEXTAREA', 't1'],
    ['j', 'TEXTAREA', '{\n    "a": 1\n}'],
    ['n', 'INPUT', '5'],
    ['d', 'INPUT', '2024-01-02 03:04:05.678'],
  ]
  for (const [col, tag, value] of expected) {
    const td = await cell(page, 0, col)
    await td.dblclick()
    const box = td.locator('.cEdit .edit_box')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue(value)
    expect(await box.evaluate((b) => b.tagName), col).toBe(tag)
    const caret = await box.evaluate((b) => [
      (b as HTMLInputElement).selectionStart,
      (b as HTMLInputElement).value.length,
    ])
    expect(caret[0], col).toBe(caret[1])
    const [bw, tw] = await Promise.all([
      box.evaluate((b) => (b as HTMLElement).offsetWidth),
      td.evaluate((t) => (t as HTMLElement).offsetWidth),
    ])
    expect(bw, col).toBe(tw)
    await page.keyboard.press('Escape')
    await expect(page.locator('.cEdit')).toHaveCount(0)
  }
})

test('the NULL box: none for NOT NULL, typing unchecks it, emptying checks it, checking clears the value [p02-f09ac6]', async ({
  page,
}) => {
  await browse(page, 'e')
  const nn = await cell(page, 0, 'nn')
  await nn.dblclick()
  await expect(nn.locator('.cEdit .edit_box')).toBeVisible()
  await expect(nn.locator('.cEdit .null_div')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // a NULL value: the box is checked, typing unchecks it
  const n = await cell(page, 1, 'n')
  await n.dblclick()
  const box = n.locator('.cEdit .edit_box')
  const nul = n.locator('.cEdit .null_div input[type=checkbox]')
  await expect(n.locator('.cEdit .null_div label')).toHaveText('NULL:')
  await expect(nul).toBeChecked()
  await box.pressSequentially('42')
  await expect(nul).not.toBeChecked()
  // emptying checks it again
  await box.fill('')
  await expect(nul).toBeChecked()
  // checking clears the editor
  await box.fill('17')
  await nul.check()
  await expect(box).toHaveValue('')
  await page.keyboard.press('Escape')
})

test('GridEditing: double-click (default), click, disabled; a relational link follows after one click and edits on two [p02-307a88]', async ({
  page,
}) => {
  await browse(page, 'e')
  const name = await cell(page, 0, 'name')
  await name.click()
  await expect(page.locator('.cEdit')).toHaveCount(0)
  await name.dblclick()
  await expect(page.locator('.cEdit .edit_box')).toBeVisible()
  await page.keyboard.press('Escape')

  await setPrefs(page, { GridEditing: 'click' })
  await browse(page, 'e')
  await (await cell(page, 0, 'name')).click()
  await expect(page.locator('.cEdit .edit_box')).toBeVisible()
  await page.keyboard.press('Escape')

  await setPrefs(page, { GridEditing: 'disabled' })
  await browse(page, 'e')
  await (await cell(page, 0, 'name')).dblclick()
  await expect(page.locator('.cEdit')).toHaveCount(0)
  await expect(page.locator('td.grid_edit')).toHaveCount(0)

  // double-click mode on the FK column of child: a double-click edits, one click follows the link
  await setPrefs(page, {})
  await browse(page, 'child')
  const fk = await cell(page, 0, 'e_id')
  await expect(fk).toHaveClass(/\brelation\b/)
  await fk.locator('a').dblclick()
  await expect(fk.locator('.cEdit')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/t\/child\/browse/)
  const t0 = Date.now()
  await fk.locator('a').click()
  await expect(page.locator('table.table_results thead th[data-column="name"]')).toBeVisible()
  expect(Date.now() - t0).toBeGreaterThanOrEqual(650)
  await expect(page.locator('.cEdit')).toHaveCount(0)
})

test('SaveCellsAtOnce: edits wait for "Save edited data", only changed values are posted, leaving warns [p02-87f86d] [p02-6c5375]', async ({
  page,
}) => {
  await setPrefs(page, { SaveCellsAtOnce: true })
  await browse(page, 'e')
  // the buttons of the navigation bar are hidden until needed
  await expect(page.locator('.save_edited')).toHaveCount(0)
  await expect(page.locator('.restore_column')).toHaveCount(0)
  for (const [r, v] of [
    [0, 'uno'],
    [1, 'dos'],
  ] as const) {
    const td = await cell(page, r, 'name')
    await td.dblclick()
    await td.locator('.cEdit .edit_box').fill(v)
    await td.locator('.cEdit .edit_box').press('Enter')
    await expect(td).toHaveClass(/\bto_be_saved\b/)
  }
  // an unchanged cell opened and closed is not posted
  const same = await cell(page, 2, 'name')
  await same.dblclick()
  await page.keyboard.press('Escape')
  await expect(page.locator('td.to_be_saved')).toHaveCount(2)
  await expect(page.locator('.save_edited').first()).toBeVisible()

  // leaving the page with unsaved edits asks first
  const dialog = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const d = await dialog
  expect(d.type()).toBe('beforeunload')
  await d.dismiss()
  await expect(page.locator('td.to_be_saved')).toHaveCount(2)

  const posted = page.waitForRequest((r) => r.url().endsWith('/browse/save'))
  await page.locator('.save_edited button').first().click()
  const body = (await posted).postDataJSON() as {
    rows: Array<{ where: string; fields: Array<{ name: string; value: string }> }>
  }
  expect(body.rows).toEqual([
    { where: '`e`.`id` = 1', fields: [{ name: 'name', value: 'uno', isNull: false, type: '' }] },
    { where: '`e`.`id` = 2', fields: [{ name: 'name', value: 'dos', isNull: false, type: '' }] },
  ])
  await expect(page.locator('td.to_be_saved')).toHaveCount(0)
  await expect(page.locator('.save_edited')).toHaveCount(0)
  expect(await sql(`SELECT name FROM ${DB}.e ORDER BY id`)).toEqual([['uno'], ['dos'], ['three']])
  await sql(`UPDATE ${DB}.e SET name = ELT(id, 'one', 'two', 'three')`)
})

/** Drags header `from` over header `to` with the mouse (makegrid dragStartReorder). */
async function dragHeader(page: Page, from: string, to: string, during?: () => Promise<void>) {
  const a = await page.locator(`thead th[data-column="${from}"]`).boundingBox()
  const b = await page.locator(`thead th[data-column="${to}"]`).boundingBox()
  if (a === null || b === null) throw new Error('no header box')
  await page.mouse.move(a.x + 4, a.y + 4)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 4, b.y + 4, { steps: 8 })
  await during?.()
  await page.mouse.up()
}

test('drag a header to reorder: the copy follows, the pointer marks the place, every row and repeated header follow; Restore column order [p02-8bb26b] [p02-abcc4f] [p02-6c5375]', async ({
  page,
}) => {
  await setPrefs(page, { RepeatCells: 2 })
  await browse(page, 'e')
  await expect(page.locator('tr.repeating_header_row')).toHaveCount(1)
  await dragHeader(page, 'id', 'txt', async () => {
    await expect(page.locator('.cCpy')).toBeVisible()
    await expect(page.locator('.cCpy')).toHaveText(/id/)
    await expect(page.locator('.cPointer')).toBeVisible()
  })
  await expect(page.locator('.cCpy, .cPointer')).toHaveCount(0)
  expect(await headerOrder(page)).toEqual(['name', 'txt', 'id', 'j', 'n', 'nn', 'd'])
  // every row follows, the repeated header row too
  expect(
    await page
      .locator('tr.repeating_header_row th.draggable')
      .evaluateAll((a) => a.map((x) => x.getAttribute('data-column'))),
  ).toEqual(['name', 'txt', 'id', 'j', 'n', 'nn', 'd'])
  expect(await dataRows(page).nth(0).locator('td[data-type]').nth(2).innerText()).toBe('1')
  expect(await dataRows(page).nth(2).locator('td[data-type]').nth(2).innerText()).toBe('3')
  // the order is kept (pma__table_uiprefs / the local store) and Restore column order shows
  await expect(page.locator('.restore_column').first()).toBeVisible()
  await browse(page, 'e')
  await expect.poll(() => headerOrder(page)).toEqual(['name', 'txt', 'id', 'j', 'n', 'nn', 'd'])
  await page.locator('.restore_column button').first().click()
  expect(await headerOrder(page)).toEqual(['id', 'name', 'txt', 'j', 'n', 'nn', 'd'])
  await expect(page.locator('.restore_column')).toHaveCount(0)
  // restoring is stored too
  await browse(page, 'e')
  await expect.poll(() => headerOrder(page)).toEqual(['id', 'name', 'txt', 'j', 'n', 'nn', 'd'])
  // a single visible column offers no reorder and no restore
  await setPrefs(page, {})
})

test('SHOW / EXPLAIN results have no navigation bar and cannot be reordered [p02-6ec666]', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/sql`)
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('SHOW COLUMNS FROM e')
  await page.locator('#button_submit_query').click()
  await expect(page.locator('table.table_results thead th.draggable').first()).toBeVisible()
  await expect(page.locator('table.navigation')).toHaveCount(0)
  const before = await headerOrder(page)
  const cols = before.filter((x): x is string => x !== null)
  await dragHeader(page, cols[0]!, cols[2]!)
  await expect(page.locator('.cCpy')).toHaveCount(0)
  expect(await headerOrder(page)).toEqual(before)
  await expect(page.locator('thead th.draggable').first()).not.toHaveClass(/cursor-move/)
})

test('column widths: drag the border, at least 15 px, not kept after a reload [p02-296ea8]', async ({
  page,
}) => {
  await browse(page, 'e')
  const th = page.locator('th[data-column="txt"]')
  const content = th.locator('span.th-content')
  const before = (await content.boundingBox())!.width
  const handle = (await th.locator('.colborder').boundingBox())!
  await page.mouse.move(handle.x + 2, handle.y + 5)
  await page.mouse.down()
  await page.mouse.move(handle.x - 300, handle.y + 5, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await content.boundingBox())?.width).toBe(15)
  await browse(page, 'e')
  await expect.poll(async () => (await content.boundingBox())?.width).toBeCloseTo(before, 0)
})

test('cell selection: Ctrl+drag adds, Shift+arrows extend, a click outside clears [p02-75250b]', async ({
  page,
}) => {
  await browse(page, 'e')
  const box = async (r: number, col: string) => (await (await cell(page, r, col)).boundingBox())!
  const a = await box(0, 'id')
  await page.mouse.move(a.x + 5, a.y + 5)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('td.cell-selected')).toHaveCount(1)
  // Ctrl+drag over another column adds to the selection
  const b = await box(0, 'txt')
  await page.keyboard.down('Control')
  await page.mouse.move(b.x + 5, b.y + 5)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect(page.locator('td.cell-selected')).toHaveCount(2)
  // Shift+ArrowDown adds the next row (rows × columns: 2 × 2); keys within 100 ms are dropped
  await page.keyboard.down('Shift')
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Shift')
  await expect(page.locator('td.cell-selected')).toHaveCount(4)
  // a click outside the grid clears it
  await page
    .locator('h2, .result_query')
    .first()
    .click({ position: { x: 1, y: 1 } })
  await expect(page.locator('td.cell-selected')).toHaveCount(0)
})

test('Edit / Copy / Delete: RowActionType both (the default) follows ActionLinksMode, like phpMyAdmin [p02-71812e]', async ({
  page,
  browser,
}) => {
  const captions = async (p: Page) => {
    const td = p.locator('table.table_results tbody tr').first().locator('td.edit_row_anchor')
    return {
      img: await td.locator('.icon').count(),
      // the text next to the icon (an icon's own title / alt is not text)
      text: await td.evaluate((e) => {
        const c = e.cloneNode(true) as HTMLElement
        for (const x of c.querySelectorAll('svg, img, input')) x.remove()
        return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
      }),
    }
  }
  await browse(page, 'e')
  expect(await captions(page)).toEqual({ img: 1, text: 'Edit' })
  await setPrefs(page, { ActionLinksMode: 'icons' })
  await browse(page, 'e')
  expect(await captions(page)).toEqual({ img: 1, text: '' })
  await setPrefs(page, { ActionLinksMode: 'text' })
  await browse(page, 'e')
  expect(await captions(page)).toEqual({ img: 0, text: 'Edit' })

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  // the default (both): the icon and the text
  expect(await captions(pma)).toEqual({ img: 1, text: 'Edit' })
  await pma.context().close()
})

test('navigation captions per TableNavigationLinksMode (icons / text / both) [p02-b14167]', async ({
  page,
  browser,
}) => {
  const captions = async (p: Page) =>
    (
      await p
        .locator('table.navigation')
        .first()
        .locator('[name="navig"][title]')
        .evaluateAll((a) =>
          a.map((x) => `${x.getAttribute('title')}=${(x as HTMLInputElement).value || x.textContent}`),
        )
    ).map((s) => s.replace(/\s+$/, ''))
  // the second page (rows 26-50 of 60) has every button
  const secondPage = async (p: Page) => {
    await expect(p.locator('table.navigation select.pageselector').first()).toBeVisible()
    await p.locator('table.navigation select.pageselector').first().selectOption('25')
    await expect(p.locator('table.navigation').first().locator('[title="Begin"]')).toBeVisible()
    await expect(p.locator('table.navigation').first().locator('[title="End"]')).toBeVisible()
  }
  await page.goto(`/s/1/db/${DB}/t/many/browse`)
  await secondPage(page)
  const icons = ['Begin=<<', 'Previous=<', 'Next=>', 'End=>>']
  expect(await captions(page)).toEqual(icons)
  for (const [mode, want] of [
    ['text', ['Begin=\u00a0Begin', 'Previous=\u00a0Previous', 'Next=Next\u00a0', 'End=End\u00a0']],
    ['both', ['Begin=<<\u00a0Begin', 'Previous=<\u00a0Previous', 'Next=Next\u00a0>', 'End=End\u00a0>>']],
  ] as const) {
    await setPrefs(page, { TableNavigationLinksMode: mode })
    await page.goto(`/s/1/db/${DB}/t/many/browse`)
    await secondPage(page)
    expect(
      (await captions(page)).map((s) => s.replace(/ /g, '\u00a0')),
      mode,
    ).toEqual(want.map((s) => s.replace(/\u00a0$/, '')))
  }

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'many')
  await secondPage(pma)
  expect(await captions(pma)).toEqual(icons)
  await pma.context().close()
})

test('Extra options: a closed collapse on every page, whatever InitialSlidersState says [p02-bda6fe]', async ({
  page,
  browser,
}) => {
  for (const state of ['closed', 'open', 'disabled']) {
    await setPrefs(page, { InitialSlidersState: state })
    await browse(page, 'e')
    const button = page.getByRole('button', { name: 'Extra options' })
    await expect(button, state).toBeVisible()
    await expect(page.locator('#extraOptions input[name="pftext"]').first(), state).toBeHidden()
    await button.click()
    await expect(page.locator('#extraOptions input[name="pftext"]').first(), state).toBeVisible()
  }
  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  await expect(pma.locator('#extraOptions input[name="pftext"]').first()).toBeHidden()
  await pma.getByRole('button', { name: 'Extra options' }).click()
  await expect(pma.locator('#extraOptions input[name="pftext"]').first()).toBeVisible()
  await pma.context().close()
})

test('the full / partial text toggle sits in the action header (left or right per RowActionLinks) and flips pftext [p02-d6ac99]', async ({
  page,
  browser,
}) => {
  const toggle = (p: Page, side: 'first' | 'last') =>
    p
      .locator('table.table_results thead tr')
      .first()
      .locator('th.column_action')
      [side]()
      .locator('.icon, img')
  await browse(page, 'e')
  expect(await iconLabel(toggle(page, 'first'))).toBe('Full texts')
  await toggle(page, 'first').click()
  await expect.poll(() => iconLabel(toggle(page, 'first'))).toBe('Partial texts')
  await page.getByRole('button', { name: 'Extra options' }).click()
  await expect(page.locator('input[name="pftext"][value="F"]')).toBeChecked()
  await toggle(page, 'first').click()
  await expect.poll(() => iconLabel(toggle(page, 'first'))).toBe('Full texts')
  await setPrefs(page, { RowActionLinks: 'right' })
  await browse(page, 'e')
  const ths = page.locator('table.table_results thead tr').first().locator('th')
  await expect(ths.first()).not.toHaveClass(/column_action/)
  expect(await iconLabel(ths.last().locator('.icon'))).toBe('Full texts')

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  expect(await iconLabel(toggle(pma, 'first'))).toBe('Full texts')
  await toggle(pma, 'first').click()
  await expect.poll(() => iconLabel(toggle(pma, 'first'))).toBe('Partial texts')
  await toggle(pma, 'first').click()
  await expect.poll(() => iconLabel(toggle(pma, 'first'))).toBe('Full texts')
  await pma.context().close()
})

test('the page settings gear: the Browse directives, and Edit + Text fields on Insert / Edit [p02-f433e3] [p03-4b85ec]', async ({
  page,
  browser,
}) => {
  const ignore = new Set(['tab_hash', 'check_page_refresh', 'token', 'submit_save'])
  const names = async (p: Page) =>
    (
      await p
        .locator('#pageSettingsModal [name]')
        .evaluateAll((a) => a.map((x) => (x as HTMLInputElement).name.replace(/\[\]$/, '')))
    ).filter((n, i, all) => n !== '' && !ignore.has(n) && all.indexOf(n) === i)
  const open = async (p: Page, ours: boolean) => {
    if (ours) await p.locator('#page_settings_icon button').click()
    else await p.locator('#page_settings_icon').click()
    await expect(p.locator('#pageSettingsModal [name]').first()).toBeAttached()
  }
  const browseDirectives = [
    'TableNavigationLinksMode',
    'ActionLinksMode',
    'ShowAll',
    'MaxRows',
    'Order',
    'BrowsePointerEnable',
    'BrowseMarkerEnable',
    'GridEditing',
    'SaveCellsAtOnce',
    'RepeatCells',
    'LimitChars',
    'RowActionLinks',
    'RowActionLinksWithoutUnique',
    'TablePrimaryKeyOrder',
    'RememberSorting',
    'RelationalDisplay',
  ]
  const editDirectives = [
    'ProtectBinary',
    'ShowFunctionFields',
    'ShowFieldTypesInDataEditView',
    'InsertRows',
    'ForeignKeyDropdownOrder',
    'ForeignKeyMaxLimit',
    'CharEditing',
    'MinSizeForInputField',
    'MaxSizeForInputField',
    'CharTextareaCols',
    'CharTextareaRows',
    'TextareaCols',
    'TextareaRows',
    'LongtextDoubleTextarea',
  ]
  await browse(page, 'e')
  await open(page, true)
  expect(await names(page)).toEqual(browseDirectives)
  await page.keyboard.press('Escape')
  await page.goto(`/s/1/db/${DB}/t/e/insert`)
  await expect(page.locator('#page_settings_icon button')).toBeVisible()
  await open(page, true)
  expect(await names(page)).toEqual(editDirectives)
  await expect(page.locator('#pageSettingsModal')).toContainText('Edit mode')
  await expect(page.locator('#pageSettingsModal')).toContainText('Text fields')

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'e')
  await open(pma, false)
  expect(await names(pma)).toEqual(browseDirectives)
  await pma.goto(`${PMA_URL}/index.php?route=/table/change&db=${DB}&table=e`)
  await open(pma, false)
  expect(await names(pma)).toEqual(editDirectives)
  await pma.context().close()
})

test('Edit / Copy links: where clause and signature, clause_is_unique, the query (SELECT list + FROM from 200 characters), update / insert [p02-ae7486]', async ({
  page,
  browser,
}) => {
  const long = `SELECT id, name, txt, j, n, nn, d FROM e WHERE id > 0 AND name <> '${'x'.repeat(120)}' ORDER BY id`
  expect(long.length).toBeGreaterThanOrEqual(200)
  const ourLinks = async () => {
    const tr = page.locator('table.table_results tbody tr').first()
    return Promise.all(
      [tr.locator('td.edit_row_anchor a'), tr.locator('td.edit_row_anchor + td a')].map(async (a) => {
        const u = new URL((await a.getAttribute('href'))!, 'http://x')
        return {
          where: u.searchParams.get('where'),
          unique: u.searchParams.get('unique'),
          sql: u.searchParams.get('sql'),
          action: u.searchParams.get('action'),
          signed: (u.searchParams.get('sig') ?? '') !== '' && (u.searchParams.get('sql_sig') ?? '') !== '',
        }
      }),
    )
  }
  const runOurs = async (q: string) => {
    await page.goto(`/s/1/db/${DB}/sql`)
    await page.locator('.cm-content').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(q)
    await page.locator('#button_submit_query').click()
    await expect(page.locator('table.table_results tbody td.edit_row_anchor').first()).toBeVisible()
  }
  await browse(page, 'e')
  const short = await ourLinks()
  expect(short).toEqual([
    { where: '`e`.`id` = 1', unique: '1', sql: 'SELECT * FROM `e`', action: 'update', signed: true },
    { where: '`e`.`id` = 1', unique: '1', sql: 'SELECT * FROM `e`', action: 'insert', signed: true },
  ])
  await runOurs(long)
  const shortened = await ourLinks()
  expect(shortened.map((l) => l.sql)).toEqual([
    'SELECT id, name, txt, j, n, nn, d FROM e',
    'SELECT id, name, txt, j, n, nn, d FROM e',
  ])
  // the Edit link opens the edit form of the row
  await page.locator('table.table_results tbody tr').first().locator('td.edit_row_anchor a').click()
  await expect(page.locator('form#insertForm, form[name="insertForm"]').first()).toBeVisible()

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  const pmaLinks = async () => {
    const tr = pma.locator('table.table_results tbody tr').first()
    return Promise.all(
      [tr.locator('td.edit_row_anchor a'), tr.locator('td.edit_row_anchor + td a')].map(async (a) => {
        const u = new URL((await a.getAttribute('href'))!, PMA_URL)
        return {
          where: u.searchParams.get('where_clause'),
          unique: u.searchParams.get('clause_is_unique'),
          sql: u.searchParams.get('sql_query'),
          action: u.searchParams.get('default_action'),
          signed:
            (u.searchParams.get('where_clause_signature') ?? '') !== '' &&
            (u.searchParams.get('sql_signature') ?? '') !== '',
        }
      }),
    )
  }
  await pmaBrowse(pma, 'e')
  expect(await pmaLinks()).toEqual(short)
  // the SQL box's form, posted (the token of the page)
  await pma.evaluate(
    ({ db, q }) => {
      const f = document.createElement('form')
      f.method = 'post'
      f.action = 'index.php?route=/sql'
      const token = (document.querySelector('input[name="token"]') as HTMLInputElement).value
      for (const [k, v] of Object.entries({ db, sql_query: q, token, server: '1' })) {
        const i = document.createElement('input')
        i.type = 'hidden'
        i.name = k
        i.value = v
        f.append(i)
      }
      document.body.append(f)
      f.submit()
    },
    { db: DB, q: long },
  )
  await expect(pma.locator('table.table_results tbody td.edit_row_anchor').first()).toBeVisible()
  expect((await pmaLinks()).map((l) => l.sql)).toEqual(shortened.map((l) => l.sql))
  await pma.context().close()
})

test('With selected: Edit and Copy open the multi-row forms, Export only the selected rows [p02-a2e7f4]', async ({
  page,
}) => {
  const pick = async () => {
    await browse(page, 'e')
    await page.locator('#id_rows_to_delete0_left').check()
    await page.locator('#id_rows_to_delete2_left').check()
  }
  await pick()
  await page.locator('button.mult_submit[value="edit"]').click()
  await expect(page).toHaveURL(/\/t\/e\/edit\?/)
  // where / where[] / where[0]: the router's list form
  const list = (u: URL, key: string) =>
    [...u.searchParams.entries()]
      .filter(([k]) => new RegExp(`^${key}(\\[\\d*\\])?$`).test(k))
      .map(([, v]) => v)
  const u = new URL(page.url())
  expect(list(u, 'where')).toEqual(['`e`.`id` = 1', '`e`.`id` = 3'])
  expect(u.searchParams.get('action')).toBe('update')
  await expect(page.locator('input[value="one"], textarea:text-is("one")').first()).toBeAttached()
  await expect(page.locator('input[value="three"], textarea:text-is("three")').first()).toBeAttached()

  await pick()
  await page.locator('button.mult_submit[value="copy"]').click()
  await expect(page).toHaveURL(/\/t\/e\/edit\?/)
  expect(new URL(page.url()).searchParams.get('action')).toBe('insert')
  await expect(page.getByRole('button', { name: 'Go' }).first()).toBeVisible()

  await pick()
  await page.locator('button.mult_submit[value="export"]').click()
  await expect(page).toHaveURL(/\/t\/e\/export\?/)
  const x = new URL(page.url())
  expect(x.searchParams.get('single_table')).toBe('true')
  expect(list(x, 'where')).toEqual(['`e`.`id` = 1', '`e`.`id` = 3'])
})

test('Print prints the grid as shown: FK cells as their value, no row actions (printview is unreachable, Q71) [p02-a117d5]', async ({
  page,
  browser,
}) => {
  const printed = async (p: Page) => {
    await p.emulateMedia({ media: 'print' })
    const rows = await p
      .locator('table.table_results tbody tr')
      .evaluateAll((trs) =>
        trs.map((tr) =>
          [...tr.querySelectorAll('td')]
            .filter((td) => getComputedStyle(td).display !== 'none')
            .map((td) => (td as HTMLElement).innerText.trim()),
        ),
      )
    const actions = await p.locator('table.table_results .edit_row_anchor:visible').count()
    await p.emulateMedia({ media: 'screen' })
    return { rows, actions }
  }
  await browse(page, 'child')
  // the Print button prints this page (window.print)
  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed++
    }
  })
  await page.getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  const ours = await printed(page)
  expect(ours).toEqual({
    rows: [
      ['1', '1'],
      ['2', '2'],
    ],
    actions: 0,
  })
  expect(JSON.stringify(ours)).not.toContain('[->')

  if (!pmaUp) return
  const pma = await pmaPage(browser)
  await pmaBrowse(pma, 'child')
  expect(await pma.locator('.jsPrintButton').count()).toBe(1)
  expect(await printed(pma)).toEqual(ours)
  await pma.context().close()
})

test('a DATETIME(3) cell gets the picker with milliseconds (data-decimals) [p02-de5ec9]', async ({
  page,
}) => {
  await browse(page, 'e')
  const d = await cell(page, 0, 'd')
  await expect(d).toHaveAttribute('data-decimals', '3')
  await d.dblclick()
  await expect(d.locator('.cEdit .edit_box')).toHaveValue('2024-01-02 03:04:05.678')
  // the picker opens with the editor
  await expect(d.locator('.cEdit .ui_tpicker_time_input')).toHaveValue('03:04:05.678')
  await expect(d.locator('.cEdit dt', { hasText: 'Millisecond' })).toBeVisible()
  // the addon marks the units it does not use (phpMyAdmin has no CSS for the class)
  await expect(d.locator('.cEdit dt.ui_tpicker_millisec_label')).not.toHaveClass(/ui_tpicker_unit_hide/)
  await expect(d.locator('.cEdit dt.ui_tpicker_microsec_label')).toHaveClass(/ui_tpicker_unit_hide/)
  await page.keyboard.press('Escape')
})

test('special schema links: information_schema names open the table (a new tab), edit_item opens a routine or event editor [p02-cc52ab]', async ({
  page,
}) => {
  await page.goto('/s/1/db/information_schema/sql')
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(
    `SELECT TABLE_SCHEMA, TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA = '${DB}' ORDER BY TABLE_NAME`,
  )
  await page.locator('#button_submit_query').click()
  const link = page.locator('table.table_results tbody td.transformed a', { hasText: /^child$/ })
  await expect(link).toHaveAttribute('href', `/s/1/db/${DB}/t/child/browse`)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link.locator('xpath=ancestor::td')).toHaveClass(/\bText_Plain transformed\b/)
  const popup = page.waitForEvent('popup')
  await link.click()
  const tab = await popup
  await expect(tab.locator('table.table_results thead th[data-column="e_id"]')).toBeVisible()
  await tab.close()
  // SCHEMATA.SCHEMA_NAME links to the database (DefaultTabDatabase)
  await page.goto('/s/1/db/information_schema/sql')
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(`SELECT SCHEMA_NAME FROM SCHEMATA WHERE SCHEMA_NAME = '${DB}'`)
  await page.locator('#button_submit_query').click()
  await expect(
    page.locator('table.table_results tbody td.transformed a', { hasText: new RegExp(`^${DB}$`) }).first(),
  ).toHaveAttribute('href', `/s/1/db/${DB}/structure`)

  // mysql.proc / mysql.event links (MariaDB) open the item's editor
  await page.goto(`/s/1/db/${DB}/routines?edit_item=1&item_name=f02c_proc&item_type=PROCEDURE`)
  await expect(page.locator('input[name="item_name"]')).toHaveValue('f02c_proc')
  await page.goto(`/s/1/db/${DB}/events?edit_item=1&item_name=f02c_ev`)
  await expect(page.locator('input[name="item_name"]')).toHaveValue('f02c_ev')
})
