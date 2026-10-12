import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'

/**
 * Server › Replication on the dev replica (mysql84-replica, BMA_PARITY_REPLICA_PORT, default 3308),
 * served by the second e2e server (playwright.config.ts, BMA_E2E_REPLICA_PORT): the toggles of
 * replication.ts and the Reset replica confirmation. Skipped when the replica is not running.
 * Holds the `bma_parity:server` lock of the parity suites (tests/parity/lib/suite-lock.ts) on the
 * primary, as tests/parity/server-replication.parity.test.ts uses the same replica; the replica is
 * pointed back at the primary afterwards.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const REPLICA = {
  ...ROOT,
  host: process.env.BMA_PARITY_REPLICA_HOST ?? ROOT.host,
  port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308),
}
/** how the replica reaches the primary (host networking: our address of it) */
const SOURCE = {
  host: process.env.BMA_PARITY_REPLICA_SOURCE_HOST ?? ROOT.host,
  port: Number(process.env.BMA_PARITY_REPLICA_SOURCE_PORT ?? ROOT.port),
  user: 'bma_repl',
  password: 'bma_repl',
}
const port = Number(process.env.BMA_E2E_PORT ?? 8099)
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.BMA_E2E_REPLICA_PORT ?? port + 1)}` })

const isReplica = await mysql
  .createConnection(REPLICA)
  .then(async (c) => {
    const [rows] = (await c.query('SHOW REPLICA STATUS')) as unknown as [unknown[]]
    await c.end()
    return rows.length > 0
  })
  .catch(() => false)

let lock: mysql.Connection | null = null
test.beforeAll(async () => {
  if (!isReplica) return
  lock = await mysql.createConnection(ROOT)
  await lock.query("SELECT GET_LOCK('bma_parity:server', 1800)")
})
test.afterAll(async () => {
  await lock?.end()
})

/** Points the replica back at the primary from its current position and starts it. */
async function restoreReplica() {
  const root = await mysql.createConnection(REPLICA)
  const primary = await mysql.createConnection({ ...SOURCE, host: ROOT.host, port: ROOT.port })
  try {
    const [[v]] = (await root.query('SELECT VERSION() AS v')) as unknown as [[{ v: string }]]
    const mariadb = /mariadb/i.test(v.v)
    const [[pos]] = (await primary.query(
      mariadb ? 'SHOW BINLOG STATUS' : 'SHOW BINARY LOG STATUS',
    )) as unknown as [[Record<string, string>]]
    const p = mariadb ? 'MASTER' : 'SOURCE'
    await root.query('STOP REPLICA')
    await root.query(
      `${mariadb ? 'CHANGE MASTER TO' : 'CHANGE REPLICATION SOURCE TO'} ${p}_HOST=?, ${p}_PORT=?, ${p}_USER=?, ${p}_PASSWORD=?, ${p}_LOG_FILE=?, ${p}_LOG_POS=${Number(pos.Position)}${mariadb ? ', MASTER_USE_GTID=no' : ', GET_SOURCE_PUBLIC_KEY=1'}`,
      [SOURCE.host, SOURCE.port, SOURCE.user, SOURCE.password, pos.File],
    )
    await root.query('START REPLICA')
  } finally {
    await primary.end()
    await root.end()
  }
}

test.skip(!isReplica, 'the dev replica is not running')

test('replica: status, control and error management toggles; Reset replica asks first', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input_username').fill(REPLICA.user)
  await page.locator('#input_password').fill(REPLICA.password)
  await page.locator('#input_go').click()
  await expect(page.locator('#maincontainer')).toBeVisible()
  await page.goto('/s/1/replication')
  await expect(page.locator('#replica_configuration_gui')).toBeVisible()

  await page.locator('#replica_status_href').click()
  await expect(page.locator('#serverreplicareplicationsummary')).toBeVisible()
  await page.locator('#replica_status_href').click()
  await expect(page.locator('#serverreplicareplicationsummary')).toHaveCount(0)
  await page.locator('#replica_control_href').click()
  await expect(page.locator('#replica_control_gui')).toBeVisible()
  await page.locator('#replica_errormanagement_href').click()
  await expect(page.locator('#replica_errormanagement_gui')).toBeVisible()
  await page.locator('#replica_errormanagement_href').click()
  await expect(page.locator('#replica_errormanagement_gui')).toHaveCount(0)

  // confirm(strResetReplicaWarning): dismissed, nothing is posted
  let posted = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/replication\/control/.test(r.url())) posted++
  })
  const confirm = page.locator('#functionConfirmModal')
  await page.locator('#reset_replica').click()
  await expect(confirm).toContainText('Do you really want to reset the replica (RESET REPLICA)?')
  await confirm.getByRole('button', { name: 'Close' }).click()
  await expect(confirm).toHaveCount(0)
  expect(posted).toBe(0)

  // accepted: STOP / RESET / START REPLICA (the POST), then the replica is restored
  try {
    await page.locator('#reset_replica').click()
    const reset = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/replication\/control/.test(r.url()),
    )
    await page.locator('#functionConfirmOkButton').click()
    expect((await reset).ok()).toBe(true)
    await expect(page.getByText('Replication resetting successfully.')).toBeVisible()
  } finally {
    await restoreReplica()
  }
})
