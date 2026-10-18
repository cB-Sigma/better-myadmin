import { createHash } from 'node:crypto'
import { type Page, expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { MYSQL, login } from './fixtures.ts'

/**
 * phpMyAdmin's date and time picker (jQuery UI datepicker + timepicker addon, addDatepicker):
 * the calendar with its month and day names, Prev / Next and the year list, the time sliders and
 * their units, the formats written back, on Insert/Edit, in the grid's cell editor and on the
 * table search (packages/ui DateTimeCalendar).
 */
const DB = 'f05_dtp'
const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

async function sql(q: string): Promise<void> {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  try {
    await c.query(q)
  } finally {
    await c.end()
  }
}

test.beforeAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY, d DATE NULL, dt DATETIME NULL, dt3 DATETIME(3) NULL,
      t6 TIME(6) NULL, v VARCHAR(5) NULL);
    INSERT INTO t VALUES (1, '2024-02-10', '2024-02-10 11:22:33', NULL, NULL, 'x')`)
})
test.afterAll(async () => {
  await sql(`DROP DATABASE IF EXISTS ${DB}`)
})

const field = (page: Page, col: string) => page.locator(`input[name="fields[multi_edit][0][${md5(col)}]"]`)
const trigger = (page: Page, col: string) =>
  field(page, col).locator('xpath=ancestor::td[1]').locator('.ui-datepicker-trigger')
const picker = (page: Page) => page.locator('#ui-datepicker-div')

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('insert: a DATE column picks a day in yy-mm-dd and closes; Prev / Next and the year list move the month', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/t/insert`)
  await expect(field(page, 'd')).toHaveAttribute('title', /not selectable by the datepicker/)
  await trigger(page, 'd').click()
  const now = new Date()
  await expect(picker(page).locator('.ui-datepicker-month')).toHaveText(MONTHS[now.getMonth()] as string)
  await expect(picker(page).locator('select.ui-datepicker-year')).toHaveValue(String(now.getFullYear()))
  // the week days from $cfg['FirstDayOfCalendar'] (0: Sunday), minimal names, full names as titles
  await expect(picker(page).locator('thead th span')).toHaveText(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
  await expect(picker(page).locator('thead th span').first()).toHaveAttribute('title', 'Sunday')
  await expect(picker(page).locator('td.ui-datepicker-today a')).toHaveClass(/ui-state-highlight/)
  // a date-only picker has no time sliders, and the field's tip as a note
  await expect(picker(page).locator('.ui-timepicker-div')).toHaveCount(0)
  await expect(picker(page).locator('p.note')).toContainText('not selectable by the datepicker')
  await picker(page).locator('a.ui-datepicker-next').click()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  await expect(picker(page).locator('.ui-datepicker-month')).toHaveText(MONTHS[next.getMonth()] as string)
  await picker(page).locator('select.ui-datepicker-year').selectOption('2020')
  await picker(page).locator('a.ui-datepicker-prev').click()
  await picker(page).locator('td[data-handler="selectDay"] a', { hasText: /^15$/ }).click()
  const m = String(next.getMonth() === 0 ? 12 : next.getMonth()).padStart(2, '0')
  await expect(field(page, 'd')).toHaveValue(`${next.getMonth() === 0 ? 2019 : 2020}-${m}-15`)
  await expect(picker(page)).toHaveCount(0)
})

test('insert: DATETIME writes the day and the time and stays open; the sliders set each unit', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/t/insert`)
  await field(page, 'dt').fill('2023-07-04 05:06:07')
  await trigger(page, 'dt').click()
  // the field's value is read: July 2023, the 4th selected, its time in the sliders
  await expect(picker(page).locator('.ui-datepicker-month')).toHaveText('July')
  await expect(picker(page).locator('td.ui-datepicker-current-day a')).toHaveText('4')
  await expect(picker(page).locator('.ui_tpicker_time_label')).toHaveText('Time')
  // every unit shows, as in phpMyAdmin (the addon's hide class has no CSS there); the format is HH:mm:ss
  await expect(picker(page).locator('dt')).toHaveText([
    'Time',
    'Hour',
    'Minute',
    'Second',
    'Millisecond',
    'Microsecond',
    'Time zone',
  ])
  await expect(picker(page).locator('.ui_tpicker_time_input')).toHaveValue('05:06:07')
  await picker(page).locator('td[data-handler="selectDay"] a', { hasText: /^20$/ }).click()
  await expect(field(page, 'dt')).toHaveValue('2023-07-20 05:06:07')
  await expect(picker(page)).toBeVisible()
  const hour = picker(page).getByRole('slider', { name: 'Hour' })
  await hour.focus()
  await page.keyboard.press('End')
  await expect(field(page, 'dt')).toHaveValue('2023-07-20 23:06:07')
  await page.keyboard.press('ArrowLeft')
  await expect(field(page, 'dt')).toHaveValue('2023-07-20 22:06:07')
  await picker(page).locator('.ui_tpicker_time_input').fill('01:02:03')
  await expect(field(page, 'dt')).toHaveValue('2023-07-20 01:02:03')
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)
})

test('insert: DATETIME(3) writes milliseconds; TIME(6) is a time-only picker up to 99 hours', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/t/insert`)
  await field(page, 'dt3').fill('2023-01-02 03:04:05.678')
  await trigger(page, 'dt3').click()
  // DATETIME(3): HH:mm:ss.l
  await expect(picker(page).locator('.ui_tpicker_time_input')).toHaveValue('03:04:05.678')
  await page.keyboard.press('Escape')

  await field(page, 't6').fill('12:00:00')
  await trigger(page, 't6').click()
  // the addon's timeOnly header, no calendar
  await expect(picker(page).locator('.ui-datepicker-title')).toHaveText('Choose Time')
  await expect(picker(page).locator('table.ui-datepicker-calendar')).toHaveCount(0)
  await expect(picker(page).locator('dt')).toHaveText([
    'Time',
    'Hour',
    'Minute',
    'Second',
    'Millisecond',
    'Microsecond',
    'Time zone',
  ])
  const hour = picker(page).getByRole('slider', { name: 'Hour' })
  await hour.focus()
  await page.keyboard.press('End')
  await expect(field(page, 't6')).toHaveValue('99:00:00.000000')
})

test('grid: the cell editor shows the picker inline; an invalid typed date hides it', async ({ page }) => {
  await page.goto(`/s/1/db/${DB}/t/t/browse`)
  const cell = page.locator('table.table_results tbody tr').first().locator('td[data-type]').nth(1)
  await cell.dblclick()
  const edit = cell.locator('.cEdit')
  await expect(edit.locator('.ui-datepicker')).toBeVisible()
  await expect(edit.locator('.ui-datepicker-month')).toHaveText('February')
  await edit.locator('.edit_box').fill('2024-02-3x')
  await expect(edit.locator('.ui-datepicker')).toHaveCount(0)
  await edit.locator('.edit_box').fill('2024-03-05')
  await expect(edit.locator('.ui-datepicker-month')).toHaveText('March')
  await edit.locator('td[data-handler="selectDay"] a', { hasText: /^9$/ }).click()
  await expect(edit.locator('.edit_box')).toHaveValue('2024-03-09')
  await page.keyboard.press('Escape')
})

test('table search: date and datetime criteria get the picker, DATETIME(3) and TIME do not', async ({
  page,
}) => {
  await page.goto(`/s/1/db/${DB}/t/t/search`)
  const row = (name: string) =>
    page.locator('#tbl_search_form tr', { has: page.locator(`th:text-is("${name}")`) })
  await expect(row('d').locator('.ui-datepicker-trigger')).toHaveCount(1)
  await expect(row('dt').locator('.ui-datepicker-trigger')).toHaveCount(1)
  await expect(row('dt3').locator('.ui-datepicker-trigger')).toHaveCount(0)
  await expect(row('t6').locator('.ui-datepicker-trigger')).toHaveCount(0)
  await row('dt').locator('.ui-datepicker-trigger').click()
  // no data-decimals on the search cell: HH:mm:ss
  await expect(picker(page).locator('.ui_tpicker_time_input')).toHaveValue(/^\d\d:\d\d:\d\d$/)
})
