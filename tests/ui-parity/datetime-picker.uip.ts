import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { FIX as SHARED } from './lib/env.ts'
import { pageParity } from './lib/parity.ts'

/**
 * The date and time picker of the Insert/Edit form (jQuery UI datepicker + timepicker addon,
 * addDateTimePicker) against ours (packages/ui DateTimeCalendar): a DATE, a DATETIME and a TIME(6)
 * field, each opened on a fixed value so the drawn month and the sliders are the same in both.
 */
const T = 'uip_dtp'
const FIX = { db: SHARED.insertDb }
const SQL = `CREATE DATABASE IF NOT EXISTS ${FIX.db}; DROP TABLE IF EXISTS ${FIX.db}.${T};
  CREATE TABLE ${FIX.db}.${T} (id INT PRIMARY KEY, d DATE, dt DATETIME, t6 TIME(6));`
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

/** fills the field of `col` in the first row, then opens its picker */
const open = (col: string, value: string) => async (pages: { pma: Page; ours: Page }) => {
  for (const page of [pages.pma, pages.ours]) {
    const field = page.locator(`input[name="fields[multi_edit][0][${md5(col)}]"]`)
    await field.fill(value)
    await field.locator('xpath=ancestor::td[1]').locator('.ui-datepicker-trigger').click()
    await page.locator('#ui-datepicker-div').filter({ visible: true }).waitFor()
  }
}

const base = {
  sql: SQL,
  pma: { route: '/table/change', params: { db: FIX.db, table: T } },
  ours: { path: `/s/1/db/${FIX.db}/t/${T}/insert` },
  ready: { pma: '#insertForm', ours: '#insertForm' },
  scope: { pma: '#ui-datepicker-div', ours: '#ui-datepicker-div' },
}

pageParity('table-insert-datepicker', {
  ...base,
  setup: open('d', '2024-02-10'),
  // jQuery UI's prev / next are <a> without href (no link role): clicked by class
  interactions: [
    {
      name: 'next month',
      do: async (page: Page) => page.locator('#ui-datepicker-div a.ui-datepicker-next').click(),
    },
    {
      name: 'previous month',
      do: async (page: Page) => {
        await page.locator('#ui-datepicker-div a.ui-datepicker-prev').click()
        await page.locator('#ui-datepicker-div a.ui-datepicker-prev').click()
      },
    },
  ],
})

pageParity('table-insert-datetimepicker', { ...base, setup: open('dt', '2024-02-10 11:22:33') })

pageParity('table-insert-timepicker', { ...base, setup: open('t6', '12:34:56.000000') })
