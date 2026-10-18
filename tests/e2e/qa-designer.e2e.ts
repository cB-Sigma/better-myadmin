import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL } from './fixtures.ts'

/**
 * The Designer's relation flows driven like a user, compared side by side with the reference:
 * "Create relationship" (the key check, a FOREIGN KEY, a foreign column without an index (Q76)),
 * deleting a relation from its line, and the visual query builder's column options. Objects
 * prefixed m1qad_.
 */
const USER = 'm1qad_user'
const DB = 'm1qad_db'

async function sql(q: string): Promise<unknown[]> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    return (await c.query(q))[0] as unknown[]
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`m1qad\\_db\`.* TO '${USER}'@'%';`)
})
test.beforeEach(async ({ page }) => {
  // an unsaved page places its tables at random (showNewPageTables): a fixed sequence keeps them
  // apart from each other and from the side menu
  await page.addInitScript(() => {
    const seq = [0.15, 0.5, 0.6, 0.9]
    let i = 0
    Math.random = () => seq[i++ % seq.length] as number
  })
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE parent (id INT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
    CREATE TABLE child (id INT PRIMARY KEY, parent_id INT, note VARCHAR(20), KEY k_parent (parent_id)) ENGINE=InnoDB;`)
  await page.goto('/')
  await page.locator('#input_username').fill(USER)
  await page.locator('#input_password').fill(USER)
  await page.locator('#input_go').click()
  await expect(page.locator('#pma_navigation')).toBeVisible()
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
})

// the tables land at random places (an unsaved page): a row may sit under the side menu
const row = (page: Page, t: string, c: string) => page.locator(`[id="id_tr_${t}.${c}"]`)
/** a click event at the row (the new-relation layer opens where the click was) */
async function clickRow(page: Page, t: string, c: string) {
  const b = await row(page, t, c).boundingBox()
  await row(page, t, c).dispatchEvent('click', {
    clientX: (b?.x ?? 0) + (b?.width ?? 0) / 2,
    clientY: (b?.y ?? 0) + (b?.height ?? 0) / 2,
  })
}
const relationMode = (page: Page) => page.locator('#side_menu [title="Create relationship"]').first().click()
const fks = async () =>
  (await sql(
    `SELECT CONSTRAINT_NAME AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = '${DB}'`,
  )) as Array<{ n: string }>

async function open(page: Page, query = false) {
  await page.goto(`/s/1/db/${DB}/designer${query ? '?query=1' : ''}`)
  await expect(row(page, 'parent', 'id')).toBeVisible()
}

test('Create relationship: the referenced column must be a key; a FOREIGN KEY on an indexed column', async ({
  page,
}) => {
  const alerts: string[] = []
  page.on('dialog', (d) => {
    alerts.push(d.message())
    void d.accept()
  })
  await open(page)
  await relationMode(page)
  await expect(page.locator('#designer_hint')).toHaveText('Select referenced key')
  await clickRow(page, 'child', 'note')
  await expect.poll(() => alerts.at(-1)).toBe('Please select the primary key or a unique key!')
  await clickRow(page, 'parent', 'id')
  await expect(page.locator('#designer_hint')).toHaveText('Select Foreign Key')
  await clickRow(page, 'child', 'parent_id')
  const layer = page.locator('#layer_new_relation')
  await expect(layer).toContainText('FOREIGN KEY')
  await layer.locator('#on_delete').selectOption('CASCADE')
  await page.locator('#ok_new_rel_panel').dispatchEvent('click')
  await expect(
    page.locator('.ajax_notification', { hasText: 'FOREIGN KEY relationship has been added.' }),
  ).toBeVisible()
  expect(await fks()).toHaveLength(1)
})

test('Create relationship to a column without an index: the database is sent, the FK refused (Q76)', async ({
  page,
}) => {
  await open(page)
  await relationMode(page)
  await clickRow(page, 'parent', 'id')
  await clickRow(page, 'child', 'note')
  // no index: the FOREIGN KEY options are hidden (clickField with pk = 0)
  await expect(page.locator('#layer_new_relation')).toBeVisible()
  await expect(page.locator('#foreign_relation')).toBeHidden()
  await page.locator('#ok_new_rel_panel').dispatchEvent('click')
  // phpMyAdmin's click_field_param has no index flag here, so its DB2 is `undefined`; ours is the
  // database, and the InnoDB pair answers as addNewRelation does for a missing index
  await expect(
    page.locator('.ajax_notification', { hasText: 'Error: Missing index on column(s).' }),
  ).toBeVisible()
  expect(await fks()).toHaveLength(0)
})

test('a relation is deleted from its line (canvasClick → #layer_upd_relation)', async ({ page }) => {
  await sql(
    `ALTER TABLE ${DB}.child ADD CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)`,
  )
  await open(page)
  // canvasClick: a click near the start of the line, at the foreign column's row on the child's side
  const layer = page.locator('#layer_upd_relation')
  await expect(page.locator('#canvas line').first()).toBeAttached()
  const pts = await page.evaluate((db) => {
    const r = document.getElementById('id_tr_child.parent_id')?.getBoundingClientRect()
    const t = document.getElementById(`${db}.child`)?.getBoundingClientRect()
    if (r === undefined || t === undefined) return []
    const y = r.top + r.height / 2
    return [t.left + 2, t.right - 1, t.left - 5, t.right + 5].map((x) => ({ x, y }))
  }, DB)
  for (const p of pts) {
    await page.mouse.click(p.x, p.y)
    if (await layer.isVisible({ timeout: 1000 }).catch(() => false)) break
    await page.waitForTimeout(500)
    if (await layer.isVisible()) break
  }
  await expect(layer).toContainText('Delete relationship')
  await layer.locator('#del_button').dispatchEvent('click')
  await expect(
    page.locator('.ajax_notification', { hasText: 'FOREIGN KEY relationship has been removed.' }),
  ).toBeVisible()
  expect(await fks()).toHaveLength(0)
})

test('the query builder: column options (where, aggregate, rename, group by, order by)', async ({ page }) => {
  await sql(
    `ALTER TABLE ${DB}.child ADD CONSTRAINT fk_p FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)`,
  )
  await open(page, true)
  await page.locator(`[id="select_${DB}.parent._name"]`).check()
  await page.locator(`[id="select_${DB}.child._note"]`).check()
  const option = async (col: string, set: (p: Page) => Promise<void>) => {
    await page.locator(`[id="id_tr_${col}"] .small_tab_pref_click_opt`).click()
    await set(page)
    await page.locator('#ok_add_object').click()
  }
  await option('parent.name', async (p) => {
    await p.locator('#rel_opt').selectOption('=')
    await p.locator('#Query').fill("'x'")
    await p.locator('#orderby').selectOption('ASC')
  })
  await option('child.note', async (p) => {
    await p.locator('#operator').selectOption('COUNT')
    await p.locator('#groupby').check()
    await p.locator('#new_name').fill('n')
  })
  await page.locator('#build_query_button').click({ force: true })
  // the reference builds the same text for the same choices
  const modal = page.locator('#buildQueryModal')
  for (const line of [
    'SELECT `parent`.`name`, count(`child`.`note`) AS `n`',
    'FROM `parent`',
    'LEFT JOIN `child` ON `parent`.`id` = `child`.`parent_id`',
    "WHERE (( `name` = 'x'))",
    'GROUP BY `note`',
    'ORDER BY `name` ASC',
  ])
    await expect(modal).toContainText(line)
})
