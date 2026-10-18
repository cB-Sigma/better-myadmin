import { spawnSync } from 'node:child_process'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { oathTotp } from '../../apps/server/src/preferences/totp.ts'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { getCreateTableSqlQueries } from '../../packages/metadata/src/resources.ts'
import { compareMetadataLogs } from './lib/compare.ts'
import { GeneralLog } from './lib/general-log.ts'
import { twoFactorVendor } from './lib/pma-2fa-vendor.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient, visibleText } from './lib/pma.ts'

/**
 * Golden parity for the authenticator-app (`application`) backend
 * (docs/features/08-settings-preferences-pmadb.md, "Two-factor authentication"): a private
 * phpMyAdmin instance with the optional Google2FA/Bacon packages (lib/pma-2fa-vendor.ts) and
 * BetterMyAdmin, each with its own pmadb and control user, go through setup (wrong code, then the
 * right one), login (wrong code, then the right one) and disabling (wrong code, then the right
 * one). The control-link writes and the `pma__userconfig` rows must match with the random secrets
 * masked, the QR codes must encode the otpauth URL Google2FA builds, module for module.
 * Only f08tf_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const P = { user: 'f08tf_pusr', ctl: 'f08tf_pctl', pmadb: 'f08tf_pmadb_p' }
const B = { user: 'f08tf_busr', ctl: 'f08tf_bctl', pmadb: 'f08tf_pmadb_b' }
const dbMap: Record<string, string> = {
  [P.pmadb]: 'PMADB',
  [B.pmadb]: 'PMADB',
  [P.ctl]: 'CTL',
  [B.ctl]: 'CTL',
  [P.user]: 'USER',
  [B.user]: 'USER',
}
const PHP = process.env.BMA_PARITY_PHP ?? 'php'
const BMA_HOST = 'bma.example:8443'

const vendor = phpAvailable() ? twoFactorVendor() : null

const pmaConfig = (autoload: string) => `require_once ${JSON.stringify(autoload)};
$cfg['blowfish_secret'] = 'f08tf-parity-secret-0123456789abcdef';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = '${P.ctl}';
$cfg['Servers'][$i]['controlpass'] = '${P.ctl}';
$cfg['Servers'][$i]['pmadb'] = '${P.pmadb}';`

let root: mysql.Connection
let log: GeneralLog
let inst: PmaInstance
let pma: PmaClient
type Bma = ReturnType<typeof testApp>
let bma: Bma
let pmaSecret = ''
let bmaSecret = ''

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API payloads in tests
type Json = Record<string, any>

const maskSecret = (s: string) => s.replace(/(\\?"secret\\?":\\?")[A-Z2-7]+/g, '$1SECRET')
const code = (secret: string) => oathTotp(secret, Math.floor(Date.now() / 30000))
const bmaReq = (method: string, path: string, body?: unknown) =>
  bma.req(method, path, body, { host: BMA_HOST })

async function row(x: typeof P): Promise<string | null> {
  const [rows] = (await root.query(
    `SELECT config_data FROM \`${x.pmadb}\`.pma__userconfig WHERE username = ?`,
    [x.user],
  )) as unknown as [Array<{ config_data: string }>]
  const r = rows[0]?.config_data
  return r === undefined ? null : maskSecret(r)
}

/** the same action in both apps: the same control-link statements and stored row (secrets masked) */
async function step(name: string, pmaAct: () => Promise<string>, bmaAct: () => Promise<Json>) {
  const m1 = await log.marker()
  const pr = await pmaAct()
  await log.settle(P.ctl, m1)
  const mask = (e: { command: string; sql: string }) => ({ ...e, sql: maskSecret(e.sql) })
  const pmaLog = (await log.since(P.ctl, m1)).map(mask)
  const m2 = await log.marker()
  const br = await bmaAct()
  const bmaLog = (await log.since(B.ctl, m2)).map(mask)
  const cmp = compareMetadataLogs(pmaLog, bmaLog, dbMap)
  expect(cmp.problems, `${name}\n${cmp.problems.join('\n')}`).toEqual([])
  expect(await row(B), `${name}: config_data`).toBe(await row(P))
  return { pr, br }
}

/** Bacon\Encoder::encode($text, L, 'utf-8') module rows (what Google2FA-QRCode draws) */
function baconMatrix(text: string): string[] {
  const r = spawnSync(
    PHP,
    [
      '-r',
      `require $argv[1];
$m = BaconQrCode\\Encoder\\Encoder::encode($argv[2], BaconQrCode\\Common\\ErrorCorrectionLevel::L(), 'utf-8')->getMatrix();
for ($y = 0; $y < $m->getHeight(); $y++) { $r = ''; for ($x = 0; $x < $m->getWidth(); $x++) $r .= $m->get($x, $y) ? '1' : '0'; echo $r, "\\n"; }`,
      vendor as string,
      text,
    ],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  return r.stdout.trim().split('\n')
}

/** Google2FA::getQRCodeUrl and the inline SVG's path of getQRCodeInline */
function google2fa(company: string, holder: string, secret: string): { url: string; path: string } {
  const r = spawnSync(
    PHP,
    [
      '-r',
      `require $argv[1];
$g = new PragmaRX\\Google2FAQRCode\\Google2FA();
preg_match('/<path[^>]* d="([^"]*)"/', $g->getQRCodeInline($argv[2], $argv[3], $argv[4]), $m);
echo json_encode(['url' => $g->getQRCodeUrl($argv[2], $argv[3], $argv[4]), 'path' => $m[1]]);`,
      vendor as string,
      company,
      holder,
      secret,
    ],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as { url: string; path: string }
}

const pmaPost = (fields: Array<[string, string]>) => pma.postPage('/preferences/two-factor', fields)
const pmaMessages = (html: string) => {
  const out: string[] = []
  for (const m of html.matchAll(
    /<div class="alert alert-(?:danger|primary|success)[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
  ))
    out.push(visibleText(m[1] as string))
  return out
}

describe.skipIf(vendor === null)('parity: two-factor authentication (application backend)', () => {
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
    inst = await startPmaInstance(pmaConfig(vendor as string))
    pma = new PmaClient(inst.url)
    await pma.login(P.user, P.user)
    bma = testApp(testConfig({ DataDir: '' }, { controluser: B.ctl, controlpass: B.ctl, pmadb: B.pmadb }))
    await bmaReq('GET', '/api/auth/state')
    const r = await bmaReq('POST', '/api/auth/login', { server: 1, username: B.user, password: B.user })
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

  it('[p08-47e665] the application backend is offered once its packages are installed', async () => {
    const page = await pma.getPage('/preferences/two-factor')
    expect(page).toContain('name="2fa_configure" value="application"')
    const s = (await bmaReq('GET', '/api/servers/1/preferences/two-factor')).json
    expect((s.backends as Json[]).map((b) => b.id)).toContain('application')
  })

  it('[p08-3db3a5] setup: secret, QR code and otpauth URL like Google2FA [p08-38b5dc]', async () => {
    const { pr, br } = await step(
      'choose application',
      () => pmaPost([['2fa_configure', 'application']]),
      async () =>
        (await bmaReq('POST', '/api/servers/1/preferences/two-factor/configure', { backend: 'application' }))
          .json,
    )
    pmaSecret = /Secret\/key:\s*(?:<[^>]*>\s*)*([A-Z2-7]{16})/.exec(pr)?.[1] ?? ''
    expect(pmaSecret).toMatch(/^[A-Z2-7]{16}$/)
    expect(br).toMatchObject({ status: 'setup', backend: 'application', error: null })
    bmaSecret = br.form.secret as string
    expect(bmaSecret).toMatch(/^[A-Z2-7]{16}$/)
    expect(visibleText(pr)).toContain(`Secret/key: ${pmaSecret}`)

    // phpMyAdmin labels the QR code with HTTP_HOST (port included) and draws Bacon's matrix
    const pmaHost = new URL(inst.url).host
    const ref = google2fa(`phpMyAdmin (${pmaHost})`, P.user, pmaSecret)
    expect(/<path[^>]* d="([^"]*)"/.exec(pr)?.[1]).toBe(ref.path)
    // ours: the same URL for our host and user, and the same modules
    const ours = google2fa(`phpMyAdmin (${BMA_HOST})`, B.user, bmaSecret)
    expect(br.form.otpauth).toBe(ours.url)
    expect(br.form.qr).toEqual(baconMatrix(ours.url))
  })

  it('[p08-38b5dc] setup: a wrong code keeps the secret, the right one stores it', async () => {
    const { pr, br } = await step(
      'wrong code',
      () =>
        pmaPost([
          ['2fa_configure', 'application'],
          ['2fa_code', '000000'],
        ]),
      async () =>
        (
          await bmaReq('POST', '/api/servers/1/preferences/two-factor/configure', {
            backend: 'application',
            fields: { '2fa_code': '000000' },
          })
        ).json,
    )
    expect(pmaMessages(pr)).toContain('Two-factor authentication failed.')
    expect(pr).toContain(pmaSecret)
    expect(br).toMatchObject({ status: 'setup', error: 'Two-factor authentication failed.' })
    expect(br.form.secret).toBe(bmaSecret)

    const ok = await step(
      'right code',
      () =>
        pmaPost([
          ['2fa_configure', 'application'],
          ['2fa_code', code(pmaSecret)],
        ]),
      async () =>
        (
          await bmaReq('POST', '/api/servers/1/preferences/two-factor/configure', {
            backend: 'application',
            fields: { '2fa_code': code(bmaSecret) },
          })
        ).json,
    )
    expect(pmaMessages(ok.pr)).toContain('Two-factor authentication has been configured.')
    expect(ok.br).toEqual({ status: 'done', message: 'Two-factor authentication has been configured.' })
    expect(await row(B)).toBe('{"2fa":{"backend":"application","settings":{"secret":"SECRET"}}}')
  })

  it('[p08-71a0b1] login: a wrong code fails, the right one logs in', async () => {
    const p2 = new PmaClient(inst.url)
    await p2.login(P.user, P.user)
    const prompt = await p2.getPage('/')
    expect(visibleText(prompt)).toContain(
      'You have enabled two factor authentication, please confirm your login.',
    )
    expect(prompt).toContain('name="2fa_code"')
    const wrong = await p2.postPage('/', [['2fa_code', '000000']])
    expect(pmaMessages(wrong)).toContain('Two-factor authentication failed.')
    const right = await p2.postPage('/', [['2fa_code', code(pmaSecret)]])
    expect(right).not.toContain('name="2fa_code"')
    expect(right).toContain('id="pma_navigation"')

    const b2 = testApp(
      testConfig({ DataDir: '' }, { controluser: B.ctl, controlpass: B.ctl, pmadb: B.pmadb }),
    )
    try {
      await b2.req('GET', '/api/auth/state')
      const login = await b2.req('POST', '/api/auth/login', { server: 1, username: B.user, password: B.user })
      expect(login.json).toMatchObject({ twoFactorRequired: true })
      const ch = (await b2.req('GET', '/api/auth/two-factor')).json
      expect(ch).toMatchObject({ form: { kind: 'application' }, showSubmit: true, error: null })
      const w = (await b2.req('POST', '/api/auth/two-factor', { fields: { '2fa_code': '000000' } })).json
      expect(w).toMatchObject({ ok: false, challenge: { error: 'Two-factor authentication failed.' } })
      const r = (await b2.req('POST', '/api/auth/two-factor', { fields: { '2fa_code': code(bmaSecret) } }))
        .json
      expect(r).toEqual({ ok: true })
      expect((await b2.req('GET', '/api/servers/1/preferences/two-factor')).status).toBe(200)
    } finally {
      await b2.close()
    }
  })

  it('[p08-bce194] disable: the confirmation asks for a code, a wrong one keeps 2FA', async () => {
    const ask = await step(
      'remove without a code',
      () => pmaPost([['2fa_remove', '1']]),
      async () => (await bmaReq('POST', '/api/servers/1/preferences/two-factor/remove', {})).json,
    )
    expect(visibleText(ask.pr)).toContain('Confirm disabling two-factor authentication')
    expect(ask.br).toMatchObject({ status: 'confirm', form: { kind: 'application' }, error: null })

    const wrong = await step(
      'remove with a wrong code',
      () =>
        pmaPost([
          ['2fa_remove', '1'],
          ['2fa_code', '000000'],
        ]),
      async () =>
        (
          await bmaReq('POST', '/api/servers/1/preferences/two-factor/remove', {
            fields: { '2fa_code': '000000' },
          })
        ).json,
    )
    expect(pmaMessages(wrong.pr)).toContain('Two-factor authentication failed.')
    expect(wrong.br).toMatchObject({ status: 'confirm', error: 'Two-factor authentication failed.' })

    const done = await step(
      'remove',
      () =>
        pmaPost([
          ['2fa_remove', '1'],
          ['2fa_code', code(pmaSecret)],
        ]),
      async () =>
        (
          await bmaReq('POST', '/api/servers/1/preferences/two-factor/remove', {
            fields: { '2fa_code': code(bmaSecret) },
          })
        ).json,
    )
    expect(pmaMessages(done.pr)).toContain('Two-factor authentication has been removed.')
    expect(done.br).toEqual({ status: 'done', message: 'Two-factor authentication has been removed.' })
    expect(await row(B)).toBe('{"2fa":{"backend":"","settings":[]}}')
  })
})
