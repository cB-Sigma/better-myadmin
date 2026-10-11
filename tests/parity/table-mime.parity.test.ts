import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { compareWrites } from './lib/compare.ts'
import { type Pairs, findForm, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog } from './lib/general-log.ts'
import { PmaClient } from './lib/pma.ts'
import { pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of the column form's MIME columns (docs/features/04-table-level.md#column-form):
 * Transformations::setMime after a change / add (INSERT, UPDATE, DELETE of pma__column_info) and
 * Relation::renameField for a renamed column — the control user's writes (`pma`, shared with the
 * reference) on this suite's databases, plus the user's own.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMA_USER = 'f04mime_pma'
const BMA_USER = 'f04mime_bma'
const DB_PMA = 'f04mime_pdb'
const DB_BMA = 'f04mime_bdb'
const dbMap = { [DB_PMA]: 'DB', [DB_BMA]: 'DB', [PMA_USER]: 'USER', [BMA_USER]: 'USER' }

const SEED = 'CREATE TABLE t (id INT NOT NULL PRIMARY KEY, created INT, note VARCHAR(20), ip BIGINT) ENGINE=InnoDB;'

let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const ours = (s: string) =>
  s.includes('f04mime_') && !s.startsWith('/*NOTRACK*/ SELECT') && !s.includes('`pma__recent`')

interface Mime {
  mimetype?: string
  transformation?: string
  transformationOptions?: string
  inputTransformation?: string
  inputTransformationOptions?: string
}
const PMA_MIME: Record<keyof Mime, string> = {
  mimetype: 'field_mimetype',
  transformation: 'field_transformation',
  transformationOptions: 'field_transformation_options',
  inputTransformation: 'field_input_transformation',
  inputTransformationOptions: 'field_input_transformation_options',
}

/** phpMyAdmin: the change form of one column (row link), modified, saved */
async function pmaChange(field: string, mime: Mime, rename?: string): Promise<unknown> {
  const json = await pma.getJson('/table/structure/change', {
    db: DB_PMA,
    table: 't',
    field,
    change_column: '1',
  })
  let pairs: Pairs = serializeForm(findForm(String(json.message), { cls: 'append_fields_form' }))
  for (const [k, v] of Object.entries(mime)) pairs = setPair(pairs, `${PMA_MIME[k as keyof Mime]}[0]`, v)
  if (rename !== undefined) pairs = setPair(pairs, 'field_name[0]', rename)
  return pma.postJson('/table/structure/save', [...pairs, ['do_save_data', '1']])
}

const bmaBase = `/api/servers/1/databases/${DB_BMA}/tables/t`
async function bmaChange(field: string, mime: Mime, rename?: string): Promise<unknown> {
  const form = (await bma.req('GET', `${bmaBase}/columns/form?fields=${field}`)).json as {
    options: { mime: boolean; privsAvailable: boolean }
    columns: Array<{ values: Record<string, unknown>; orig: unknown; mime: Mime | null }>
  }
  expect(form.options.mime).toBe(true)
  const c = form.columns[0]
  const r = await bma.req('POST', `${bmaBase}/columns/change`, {
    columns: [
      {
        ...c?.values,
        ...(rename !== undefined ? { name: rename } : {}),
        orig: c?.orig,
        adjustPrivileges: form.options.privsAvailable,
        mime: { ...c?.mime, ...mime },
      },
    ],
  })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json
}

async function seed(storage: (db: string) => string) {
  for (const db of [DB_PMA, DB_BMA]) {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`)
    await root.query(
      `DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${db}'; DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${db}'; DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${db}' OR foreign_db = '${db}'; ${storage(db)}`,
    )
  }
  await root.query('USE mysql')
}

async function runCase(
  storage: (db: string) => string,
  pmaFn: () => Promise<unknown>,
  bmaFn: () => Promise<unknown>,
) {
  await seed(storage)
  const m1 = await log.marker()
  await pmaFn()
  const pmaLog = await log.since(PMA_USER, m1)
  const pmaCtl = (await log.since('pma', m1)).filter((e) => ours(e.sql))
  const m2 = await log.marker()
  await bmaFn()
  const bmaLog = await log.since(BMA_USER, m2)
  const bmaCtl = (await log.since('pma', m2)).filter((e) => ours(e.sql))
  const cmp = compareWrites(pmaLog, bmaLog, dbMap)
  expect(cmp.bma, 'user writes').toEqual(cmp.pma)
  const ctl = compareWrites(pmaCtl, bmaCtl, dbMap)
  expect(ctl.pma.length, 'the reference wrote the configuration storage').toBeGreaterThan(0)
  expect(ctl.bma, 'control-user writes').toEqual(ctl.pma)
  const rows = async (db: string) => {
    const [r] = await root.query(
      'SELECT column_name, mimetype, transformation, transformation_options, input_transformation, input_transformation_options, comment FROM phpmyadmin.pma__column_info WHERE db_name = ? ORDER BY column_name',
      [db],
    )
    return JSON.stringify(r)
  }
  expect(await rows(DB_BMA)).toBe(await rows(DB_PMA))
}

const none = () => ''
const stored = (db: string) =>
  `INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options) VALUES ('${db}', 't', 'created', '', 'text_plain', 'output/text_plain_dateformat.php', '0', '', ''); INSERT INTO phpmyadmin.pma__table_info VALUES ('${db}', 't', 'created'); INSERT INTO phpmyadmin.pma__relation VALUES ('${db}', 't', 'created', '${db}', 't', 'id')`

describe.skipIf(!pmaReachable)(
  'parity: MIME columns of the column form (phpMyAdmin vs BetterMyAdmin)',
  () => {
    beforeAll(async () => {
      root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
      for (const u of [PMA_USER, BMA_USER]) {
        await root.query(
          `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04mime\\_%\`.* TO '${u}'@'%'`,
        )
      }
      log = await GeneralLog.open(ROOT)
      pma = new PmaClient(PMA_URL)
      await pma.login(PMA_USER, PMA_USER)
      bma = testApp(testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }))
      await bma.login(BMA_USER, BMA_USER)
    })

    afterAll(async () => {
      for (const db of [DB_PMA, DB_BMA]) {
        await root?.query(
          `DROP DATABASE IF EXISTS ${db}; DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${db}'; DELETE FROM phpmyadmin.pma__table_info WHERE db_name = '${db}'; DELETE FROM phpmyadmin.pma__relation WHERE master_db = '${db}' OR foreign_db = '${db}'`,
        )
      }
      await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
      await root?.end()
      await log?.close()
      await bma?.close()
    })

    it('set a media type, a browser transformation and its options (INSERT)', () => {
      const mime = {
        mimetype: 'Text_Plain',
        transformation: 'Output/Text_Plain_Dateformat.php',
        transformationOptions: "0,'%Y',local",
      }
      return runCase(
        none,
        () => pmaChange('created', mime),
        () => bmaChange('created', mime),
      )
    })

    it('an input transformation on another column (INSERT), the stored row untouched (UPDATE)', () => {
      const mime = { inputTransformation: 'Input/Text_Plain_Iptolong.php' }
      return runCase(
        stored,
        () => pmaChange('ip', mime),
        () => bmaChange('ip', mime),
      )
    })

    it('change the options of a stored transformation and rename the column (renameField + UPDATE)', () => {
      const mime = { transformationOptions: '2' }
      return runCase(
        stored,
        () => pmaChange('created', mime, 'created_at'),
        () => bmaChange('created', mime, 'created_at'),
      )
    })

    it('clear a stored transformation (DELETE)', () => {
      const mime = { mimetype: '', transformation: '', transformationOptions: '' }
      return runCase(
        stored,
        () => pmaChange('created', mime),
        () => bmaChange('created', mime),
      )
    })

    it('the change form selects the stored settings', async () => {
      await seed(stored)
      const json = await pma.getJson('/table/structure/change', {
        db: DB_PMA,
        table: 't',
        field: 'created',
        change_column: '1',
      })
      const pairs = serializeForm(findForm(String(json.message), { cls: 'append_fields_form' }))
      const get = (k: string) => pairs.find(([n]) => n === `${k}[0]`)?.[1]
      const form = (await bma.req('GET', `${bmaBase}/columns/form?fields=created`)).json as {
        columns: Array<{ mime: Mime }>
      }
      expect(form.columns[0]?.mime).toEqual({
        mimetype: get('field_mimetype'),
        transformation: get('field_transformation'),
        transformationOptions: get('field_transformation_options'),
        inputTransformation: get('field_input_transformation'),
        inputTransformationOptions: get('field_input_transformation_options'),
      })
    })
  },
)
