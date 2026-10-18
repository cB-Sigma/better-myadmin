import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The "configuration storage has been deactivated" notice of the home page and Database ›
 * Operations: an error when `pmadb` is configured, a notice otherwise, none with
 * PmaNoRelation_DisableWarning; the home page adds the ZeroConf hint line.
 * pma: src/Controllers/HomeController.php, src/Controllers/Database/OperationsController.php
 *
 * The discovery probes `phpmyadmin` even without a configured pmadb (Relation::initRelationParamsCache),
 * and the shared server has it: the account here sees only its own database.
 */
const USER = 'f08_notice'
const DB = 'f08_notice_db'
beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT ALL ON \`${DB}\`.* TO '${USER}'@'%'`)
  await c.end()
})
afterAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS '${USER}'@'%'`)
  await c.end()
})
async function notices(cfg: Parameters<typeof testConfig>[0], server: Parameters<typeof testConfig>[1]) {
  const t = testApp(testConfig(cfg, server))
  try {
    await t.login(USER, USER)
    const home = await t.req('GET', '/api/servers/1/home')
    const ops = await t.req('GET', `/api/servers/1/databases/${DB}/operations`)
    expect(ops.status, JSON.stringify(ops.json)).toBe(200)
    return {
      home: home.json.configStorageMessage as { type: string; zeroConf: boolean } | null,
      ops: (ops.json.storageNotice as { type: string } | null)?.type ?? null,
    }
  } finally {
    await t.close()
  }
}

describe('configuration storage notice severity [p08-9f5c8d]', () => {
  it('a configured but missing pmadb is an error', async () => {
    expect(await notices({ ZeroConf: true }, { pmadb: 'f08_missing_storage' })).toEqual({
      home: { type: 'error', zeroConf: true },
      ops: 'error',
    })
  })
  it('no pmadb (and no zero configuration) is a notice, without the ZeroConf hint', async () => {
    expect(await notices({ ZeroConf: false }, { pmadb: '' })).toEqual({
      home: { type: 'notice', zeroConf: false },
      ops: 'notice',
    })
  })
  it('PmaNoRelation_DisableWarning suppresses both', async () => {
    expect(
      await notices(
        { ZeroConf: false, PmaNoRelation_DisableWarning: true },
        { pmadb: 'f08_missing_storage' },
      ),
    ).toEqual({ home: null, ops: null })
  })
})
