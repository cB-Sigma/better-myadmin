import { execFileSync } from 'node:child_process'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import {
  type Pairs,
  ROOT,
  bmaDump,
  createAccounts,
  pmaDump,
  pmaExportForm,
  withFields,
} from './lib/export.ts'
import { PmaClient } from './lib/pma.ts'
import { PMA_STORAGE, PMA_URL, pmaReachable } from './lib/server-setup.ts'

/**
 * The export's Kanji conversion (Encoding::kanjiStrConv in OutputHandler::addLine) in the Japanese
 * locale, byte for byte against phpMyAdmin: knjenc EUC-JP / SJIS / none, with and without xkana.
 * phpMyAdmin guesses each line's encoding among ASCII, SJIS, EUC-JP and JIS, which misreads UTF-8
 * Japanese (parity-exceptions.md Q70): the compared dump is CSV of ASCII rows, which both convert
 * the same way; the Japanese text itself is compared with mbstring in packages/export/test/kanji.test.ts.
 */
const DB = 'f07_kanji'
const USERS = { pma: 'f07_kpma', bma: 'f07_kbma' }

let root: mysql.Connection
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let form: Pairs

/**
 * Encoding::canConvertKanji() needs Current::$lang === 'ja': a reference built without translations
 * offers English only (lang=ja is ignored), and the suite is skipped. A copy of the reference with a
 * `resources/locale/ja/LC_MESSAGES/phpmyadmin.mo` (an empty catalog is enough) served as
 * BMA_PARITY_PMA_URL runs it.
 */
const japanese =
  pmaReachable &&
  (await new PmaClient(PMA_URL)
    .getPage('/', { lang: 'ja' })
    .then((html) => /<html lang="ja"/.test(html))
    .catch(() => false))

describe.skipIf(!japanese)('export Kanji conversion parity (Japanese locale)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await createAccounts(root, [USERS.pma, USERS.bma])
    await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} DEFAULT CHARACTER SET utf8mb4;
      CREATE TABLE ${DB}.t (id INT PRIMARY KEY, name VARCHAR(20));
      INSERT INTO ${DB}.t VALUES (1, 'alpha'), (2, 'beta "two"'), (3, NULL);
      CREATE TABLE ${DB}.jp (id INT PRIMARY KEY, name VARCHAR(20));
      INSERT INTO ${DB}.jp VALUES (1, '日本語'), (2, 'ｶﾞｷﾞﾊﾟ'), (3, 'テスト ～'), (4, 'abc');`)
    pma = new PmaClient(PMA_URL)
    await pma.login(USERS.pma, USERS.pma, 1, 'ja')
    bma = testApp(testConfig({}, PMA_STORAGE))
    await bma.req('GET', '/api/i18n?lang=ja')
    await bma.login(USERS.bma, USERS.bma)
    form = await pmaExportForm(pma, 'table', { db: DB, table: 't', single_table: 'true' })
  }, 60000)

  afterAll(async () => {
    await bma?.close()
    if (root !== undefined) {
      await root.query(`DROP DATABASE IF EXISTS ${DB}`)
      for (const u of Object.values(USERS)) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    }
  })

  it("phpMyAdmin's export form has the Kanji fields in this locale", () => {
    expect(form.some(([k]) => k === 'knjenc')).toBe(true)
  })

  for (const [knjenc, xkana] of [
    ['SJIS', null],
    ['EUC-JP', 'kana'],
    ['', 'kana'],
  ] as const) {
    it(`CSV with knjenc=${knjenc === '' ? '(none)' : knjenc}${xkana === null ? '' : ' and xkana'}`, async () => {
      const pairs = withFields(form, {
        what: 'csv',
        quick_or_custom: 'custom',
        output_format: 'sendit',
        knjenc,
        xkana,
      })
      const p = await pmaDump(pma, pairs)
      const b = await bmaDump(bma, pairs)
      expect(p.status).toBe(200)
      expect(b.status).toBe(200)
      expect(b.body.toString('hex')).toBe(p.body.toString('hex'))
    })
  }

  // Q70: phpMyAdmin leaves this UTF-8 text as is for SJIS (it guesses SJIS) and garbles it for
  // EUC-JP and Kana (it reads the bytes as SJIS / EUC-JP); ours is what mbstring makes of the UTF-8
  // text, which is what phpMyAdmin's own UTF-8 dump becomes through mb_convert_kana('KV') and
  // mb_convert_encoding(…, 'UTF-8') line by line
  for (const [knjenc, xkana] of [
    ['SJIS', null],
    ['EUC-JP', 'kana'],
    ['', 'kana'],
  ] as const) {
    it(`Japanese text, knjenc=${knjenc === '' ? '(none)' : knjenc}${xkana === null ? '' : ' and xkana'} (Q70)`, async () => {
      const jp = await pmaExportForm(pma, 'table', { db: DB, table: 'jp', single_table: 'true' })
      const base = { what: 'csv', quick_or_custom: 'custom', output_format: 'sendit' }
      const utf8 = await pmaDump(pma, withFields(jp, { ...base, knjenc: '', xkana: null }))
      const b = await bmaDump(bma, withFields(jp, { ...base, knjenc, xkana }))
      const php = [
        '$out = "";',
        'foreach (preg_split("/(?<=\\n)/", stream_get_contents(STDIN)) as $line) {',
        `  if (${xkana === 'kana' ? 'true' : 'false'}) $line = mb_convert_kana($line, "KV", "UTF-8");`,
        `  if ("${knjenc}" !== "") $line = mb_convert_encoding($line, "${knjenc}", "UTF-8");`,
        '  $out .= $line;',
        '}',
        'echo bin2hex($out);',
      ].join(' ')
      const expected = execFileSync('php', ['-r', php], { input: utf8.body }).toString()
      expect(b.body.toString('hex')).toBe(expected)
    })
  }
})
