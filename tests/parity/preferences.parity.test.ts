import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { getCreateTableSqlQueries } from '../../packages/metadata/src/resources.ts'
import { compareMetadataLogs } from './lib/compare.ts'
import { type Pairs, findForm, serializeForm, setPair } from './lib/form.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient, visibleText } from './lib/pma.ts'

/**
 * Golden parity for the user preferences (docs/features/08-settings-preferences-pmadb.md): the same
 * Settings form posts, page settings, imports, resets and two-factor changes in a private
 * phpMyAdmin instance and in BetterMyAdmin, each with its own pmadb and control user; the
 * `pma__userconfig` rows (config_data byte for byte) and the control-link writes must match, and
 * the forms must serialise to the same fields. Only f08_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const P = { user: 'f08_pusr', ctl: 'f08_pctl', pmadb: 'f08_pmadb_p' }
const B = { user: 'f08_busr', ctl: 'f08_bctl', pmadb: 'f08_pmadb_b' }
const dbMap: Record<string, string> = {
  [P.pmadb]: 'PMADB',
  [B.pmadb]: 'PMADB',
  [P.ctl]: 'CTL',
  [B.ctl]: 'CTL',
  [P.user]: 'USER',
  [B.user]: 'USER',
}

const pmaConfig = `$cfg['blowfish_secret'] = 'f08-parity-secret-0123456789abcdef!';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = '${P.ctl}';
$cfg['Servers'][$i]['controlpass'] = '${P.ctl}';
$cfg['Servers'][$i]['pmadb'] = '${P.pmadb}';
$cfg['MaxTableList'] = 300;
$cfg['DBG']['simple2fa'] = true;`

const available = phpAvailable()

let root: mysql.Connection
let log: GeneralLog
let inst: PmaInstance
let pma: PmaClient
type Bma = ReturnType<typeof testApp>
let bma: Bma

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>

async function row(x: typeof P): Promise<string | null> {
  const [rows] = (await root.query(
    `SELECT config_data FROM \`${x.pmadb}\`.pma__userconfig WHERE username = ?`,
    [x.user],
  )) as unknown as [Array<{ config_data: string }>]
  return rows[0]?.config_data ?? null
}

/** The fields a browser posts for a BetterMyAdmin form set (unchecked boxes absent, first option fallback). */
function bmaPairs(formSet: Json): Pairs {
  const out: Pairs = []
  for (const form of formSet.forms as Json[]) {
    for (const item of form.items as Json[]) {
      if (item.kind !== 'field') continue
      const f = item.field as Json
      if (f.type === 'checkbox') {
        if (f.value === true) out.push([f.id, 'on'])
      } else if (f.type === 'select') {
        const opts = f.options as Json[]
        out.push([f.id, opts.some((o) => o.value === f.value) ? f.value : (opts[0]?.value ?? '')])
      } else out.push([f.id, String(f.value)])
    }
  }
  return out
}

const HIDDEN = new Set(['token', 'server', 'tab_hash', 'check_page_refresh', 'submit_save', 'lang'])
const fieldsOnly = (p: Pairs): Pairs => p.filter(([k]) => !HIDDEN.has(k))
const record = (p: Pairs): Record<string, string> => Object.fromEntries(p)

/** pma form of a page (`.config-form`, inside `#within` when given), serialised like the browser */
async function pmaForm(route: string, within?: string): Promise<Pairs> {
  let html = await pma.getPage(route)
  if (within !== undefined) html = html.slice(html.indexOf(`id="${within}"`))
  return serializeForm(findForm(html, { cls: 'config-form' }))
}

/** visible error summary of a pma settings page */
const pmaErrors = (html: string): string[] => {
  const m = html.match(/<div class="alert alert-danger config-form"[\s\S]*?<\/div>/)
  return m === null ? [] : [visibleText(m[0])]
}

async function step(name: string, pmaAct: () => Promise<unknown>, bmaAct: () => Promise<unknown>) {
  const m1 = await log.marker()
  const pr = await pmaAct()
  await log.settle(P.ctl, m1)
  const pmaLog: LogEntry[] = await log.since(P.ctl, m1)
  const m2 = await log.marker()
  const br = await bmaAct()
  const bmaLog: LogEntry[] = await log.since(B.ctl, m2)
  const cmp = compareMetadataLogs(pmaLog, bmaLog, dbMap)
  expect(cmp.problems, `${name}\n${cmp.problems.join('\n')}`).toEqual([])
  expect(await row(B), `${name}: config_data`).toBe(await row(P))
  return { pr, br }
}

/** a Settings tab: same serialised form, then the same post */
async function formStep(tab: string, change: (p: Pairs) => Pairs) {
  const pp = fieldsOnly(await pmaForm(`/preferences/${tab}`))
  const g = await bma.req('GET', `/api/servers/1/preferences/forms/${tab}`)
  expect(g.status).toBe(200)
  expect(bmaPairs(g.json.formSet), `${tab}: form fields`).toEqual(pp)
  const posted = change(pp)
  return step(
    tab,
    () => pma.postPage(`/preferences/${tab}`, [...posted, ['submit_save', 'Apply'], ['tab_hash', '']]),
    async () =>
      (await bma.req('POST', `/api/servers/1/preferences/forms/${tab}`, { values: record(posted) })).json,
  )
}

describe.skipIf(!available)('parity: user preferences (pma__userconfig)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    log = await GeneralLog.open(ROOT)
    for (const x of [P, B]) {
      await root.query(`DROP DATABASE IF EXISTS \`${x.pmadb}\``)
      await root.query(`CREATE DATABASE \`${x.pmadb}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)
      await root.query(`USE \`${x.pmadb}\``)
      for (const sql of Object.values(getCreateTableSqlQueries({}))) await root.query(sql)
      for (const u of [x.user, x.ctl]) {
        await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
      }
      await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${x.pmadb}\`.* TO '${x.ctl}'@'%'`)
    }
    inst = await startPmaInstance(pmaConfig)
    pma = new PmaClient(inst.url)
    await pma.login(P.user, P.user)
    bma = testApp(
      testConfig(
        { DataDir: '', MaxTableList: 300, DBG: { simple2fa: true } },
        { controluser: B.ctl, controlpass: B.ctl, pmadb: B.pmadb },
      ),
    )
    const r = await bma.login(B.user, B.user)
    expect(r.status).toBe(200)
  })

  afterAll(async () => {
    await bma?.close()
    await inst?.stop()
    for (const x of [P, B]) {
      await root?.query(`DROP DATABASE IF EXISTS \`${x.pmadb}\``)
      for (const u of [x.user, x.ctl]) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    }
    await root?.end()
    await log?.close()
  })

  it('[p08-9b4f97] Features: defaults are not stored, changes are, 2fa re-persisted [p08-0b1f72]', async () => {
    await formStep('features', (p) =>
      setPair(
        p.filter(([k]) => k !== 'NaturalOrder'),
        'MaxTableList',
        '100',
      ),
    )
  })

  it('[p08-ee115b] SQL queries: an upper bound error keeps everything unsaved [p08-8ef8d5]', async () => {
    const { pr, br } = await formStep('sql', (p) => setPair(p, 'QueryHistoryMax', '500'))
    expect((br as Json).saved).toBe(false)
    const errs = ((br as Json).formSet.errorList as Json[]).flatMap((e) => [e.name, ...e.errors])
    expect(pmaErrors(String(pr))[0]).toBe(
      visibleText(`Cannot save settings, submitted form contains errors! ${errs.join(' ')}`),
    )
  })

  it('[p08-84b620] Features: hide_db is validated as a PCRE body', async () => {
    const { pr, br } = await formStep('features', (p) => setPair(p, 'Servers-1-hide_db', 'ab('))
    expect((br as Json).saved).toBe(false)
    expect(String(pr)).toContain('missing closing parenthesis at offset 3')
    const errs = ((br as Json).formSet.errorList as Json[]).flatMap((e) => [e.name, ...e.errors])
    expect(pmaErrors(String(pr))[0]).toBe(
      visibleText(`Cannot save settings, submitted form contains errors! ${errs.join(' ')}`),
    )
  })

  it('[p08-5102df] Features: hide_db saved as Server/hide_db', async () => {
    await formStep('features', (p) => setPair(p, 'Servers-1-hide_db', '^test'))
  })

  it('[p08-ee115b] Navigation panel', async () => {
    await formStep('navigation', (p) => setPair(p, 'NavigationTreeDbSeparator', '__'))
  })

  it('[p08-ee115b] Main panel: saved unchanged', async () => {
    await formStep('main-panel', (p) => setPair(p, 'MaxRows', '50'))
  })

  it('[p08-ee115b] Export and Import tabs', async () => {
    await formStep('export', (p) => setPair(p, 'Export-format', 'csv'))
    await formStep('import', (p) => setPair(p, 'Import-csv_terminated', ';'))
  })

  it('[p08-69a15f] page settings (Sql group on the server SQL page) save like a form', async () => {
    const pp = fieldsOnly(await pmaForm('/server/sql', 'page_settings_modal'))
    const g = await bma.req('GET', '/api/servers/1/preferences/page/Sql')
    expect(bmaPairs(g.json.formSet), 'page settings fields').toEqual(pp)
    const posted = setPair(pp, 'MaxCharactersInDisplayedSQL', '2000')
    await step(
      'page settings',
      () => pma.postPage('/server/sql', [...posted, ['submit_save', 'Sql']]),
      async () =>
        (await bma.req('POST', '/api/servers/1/preferences/page/Sql', { values: record(posted) })).json,
    )
  })

  it('[p08-1c37f1] exports the same JSON and PHP files', async () => {
    const host = new URL(inst.url).host
    const bmaDownload = (type: string) =>
      bma.app.request(`/api/servers/1/preferences/manage/export?type=${type}`, {
        headers: { cookie: [...bma.jar].map(([k, v]) => `${k}=${v}`).join('; '), host },
      })
    for (const [type, exportType] of [
      ['json', 'text_file'],
      ['php', 'php_file'],
    ] as const) {
      let pmaHeaders: Headers | undefined
      const body = await pma.postPage(
        '/preferences/manage',
        [
          ['submit_export', 'Go'],
          ['export_type', exportType],
        ],
        {
          binary: true,
          onHeaders: (_s, h) => {
            pmaHeaders = h
          },
        },
      )
      const res = await bmaDownload(type)
      expect(Buffer.from(await res.arrayBuffer()).toString('latin1'), type).toBe(body)
      expect(res.headers.get('content-disposition'), type).toBe(pmaHeaders?.get('content-disposition'))
      expect(res.headers.get('content-type'), type).toBe(pmaHeaders?.get('content-type'))
    }
  })

  it('[p08-f18efc] import: phpMyAdmin 6.0-dev fails with a TypeError (BetterMyAdmin: int test)', async () => {
    // FormDisplay::validateSelect(string|bool &$value) receives the integer defaults that
    // ManageController posts for every field: every import ends in "Internal error: TypeError"
    const json = JSON.stringify({ TabsMode: 'text' })
    const { pr } = await step(
      'import',
      () =>
        pma.postPage('/preferences/manage', [
          ['submit_import', 'Go'],
          ['import_type', 'text_file'],
          ['json', json],
        ]),
      async () => null,
    )
    expect(visibleText(String(pr))).toContain('TypeError')
  })

  it('[p08-47e665] two-factor: simple backend configure and remove', async () => {
    await step(
      'configure simple',
      () => pma.postPage('/preferences/two-factor', [['2fa_configure', 'simple']]),
      async () =>
        (await bma.req('POST', '/api/servers/1/preferences/two-factor/configure', { backend: 'simple' }))
          .json,
    )
    const { br } = await step(
      'remove without confirmation',
      () => pma.postPage('/preferences/two-factor', [['2fa_remove', '1']]),
      async () => (await bma.req('POST', '/api/servers/1/preferences/two-factor/remove', {})).json,
    )
    expect((br as Json).status).toBe('confirm')
    await step(
      'remove',
      () =>
        pma.postPage('/preferences/two-factor', [
          ['2fa_remove', '1'],
          ['2fa_confirm', '1'],
        ]),
      async () =>
        (
          await bma.req('POST', '/api/servers/1/preferences/two-factor/remove', {
            fields: { '2fa_confirm': '1' },
          })
        ).json,
    )
  })

  it('[p08-e23faa] reset keeps 2fa only', async () => {
    await step(
      'reset',
      () => pma.postPage('/preferences/manage', [['submit_clear', 'Reset']]),
      async () => (await bma.req('POST', '/api/servers/1/preferences/manage/reset', {})).json,
    )
  })
})
