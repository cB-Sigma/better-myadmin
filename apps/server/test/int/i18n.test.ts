import { sprintf } from '@bettermyadmin/i18n'
import { translatorFor } from '@bettermyadmin/i18n/node'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Per-request language on the server. The expected German texts are phpMyAdmin's catalogue
 * (packages/i18n/po/de.po); tests/parity/i18n.parity.test.ts checks them against a translated
 * phpMyAdmin when one is running.
 */
const DB = 'bma_it_i18n'

beforeAll(async () => {
  const c = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
    CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20));
    INSERT INTO t (name) VALUES ${Array.from({ length: 30 }, (_, i) => `('r${i}')`).join(',')};`)
  await c.end()
})
afterAll(async () => {
  const c = await mysql.createConnection(MYSQL)
  await c.query(`DROP DATABASE IF EXISTS ${DB}`)
  await c.end()
})

const sec = (s: string) => s.replace(/\d+[.,]\d{4}/g, 'T')

describe('GET /api/i18n — LanguageManager::selectLanguage', () => {
  it('defaults to English and lists the shipped languages sorted by English name', async () => {
    const t = testApp()
    const r = await t.req('GET', '/api/i18n')
    expect(r.json).toMatchObject({ key: 'en', code: 'en', dir: 'ltr', warning: null })
    const langs = r.json.languages as Array<{ key: string; name: string }>
    expect(langs.length).toBe(49)
    expect(langs.slice(0, 3).map((l) => l.name)).toEqual([
      'Shqip - Albanian',
      'العربية - Arabic',
      'Հայերէն - Armenian',
    ])
    expect(langs.find((l) => l.key === 'de')?.name).toBe('Deutsch - German')
    expect(langs.find((l) => l.key === 'pt_br')?.name).toBe('Português (Brasil) - Portuguese (Brazil)')
    await t.close()
  })

  it('Accept-Language, then ?lang= which is remembered in the cookie', async () => {
    const t = testApp()
    expect(
      (await t.req('GET', '/api/i18n', undefined, { 'accept-language': 'fr-FR,fr;q=0.9' })).json.key,
    ).toBe('fr')
    const r = await t.req('GET', '/api/i18n?lang=ar')
    expect(r.json).toMatchObject({ key: 'ar', code: 'ar', dir: 'rtl' })
    expect(r.res.headers.getSetCookie().find((c) => c.startsWith('bma_lang='))).toMatch(
      /^bma_lang=ar; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Strict$/,
    )
    // the cookie now beats Accept-Language
    expect((await t.req('GET', '/api/i18n', undefined, { 'accept-language': 'de' })).json.key).toBe('ar')
    await t.close()
  })

  it("an unsupported code is ignored with phpMyAdmin's (translated) warning", async () => {
    const t = testApp()
    const r = await t.req('GET', '/api/i18n?lang=xx', undefined, { 'accept-language': 'de' })
    expect(r.json).toMatchObject({ key: 'de', warning: 'Ignoriere nicht unterstützten Sprach-Code.' })
    await t.close()
  })

  it('Lang forces the language and hides the selector; FilterLanguages restricts the list', async () => {
    const forced = testApp(testConfig({ Lang: 'cs' }))
    expect((await forced.req('GET', '/api/i18n?lang=de')).json).toMatchObject({ key: 'cs', languages: null })
    await forced.close()
    const filtered = testApp(testConfig({ FilterLanguages: '^(en|de)$' }))
    const r = await filtered.req('GET', '/api/i18n')
    expect((r.json.languages as Array<{ key: string }>).map((l) => l.key)).toEqual(['en', 'de'])
    await filtered.close()
  })
})

describe('server messages follow the request language', () => {
  it('login failures are translated', async () => {
    const t = testApp(testConfig({}, { AllowRoot: false }))
    await t.req('GET', '/api/i18n?lang=de')
    const r = await t.login('root', 'whatever')
    expect(r.status).toBe(403)
    expect((r.json.error as { message: string }).message).toBe('Zugriff verweigert!')
    await t.close()
  })

  it('query pipeline messages and MySQL errors (lc_messages) are German', async () => {
    const t = testApp()
    await t.req('GET', '/api/i18n?lang=de')
    await t.login()
    const q = async (sql: string) => {
      const r = await t.req('POST', '/api/servers/1/query', { sql, db: DB, fromQueryBox: true })
      return (r.json.statements as Array<{ message: { text: string } }>).map((s) => sec(s.message.text))
    }
    expect(await q('SELECT * FROM t')).toEqual([
      'Zeige Datensätze 0 - 24 (30 insgesamt, Die Abfrage dauerte T Sekunden.)',
    ])
    expect(await q('UPDATE t SET name = name WHERE id < 0')).toEqual([
      '0 Datensatz betroffen. (Die Abfrage dauerte T Sekunden.)',
    ])
    expect(await q('SELECT * FROM missing')).toEqual([`#1146 - Tabelle '${DB}.missing' existiert nicht`])
    expect(
      (await t.req('POST', '/api/servers/1/query', { sql: ' ', fromQueryBox: true })).json.error,
    ).toMatchObject({
      message: 'Das Formular ist leer!',
    })

    // switching back to English re-sets lc_messages on the pooled connection
    await t.req('GET', '/api/i18n?lang=en')
    expect(await q('SELECT * FROM missing')).toEqual([`#1146 - Table '${DB}.missing' doesn't exist`])
    await t.close()
  })

  it('SQL tab: import mode summary, PHP code, rollback, profiling numbers, simulate, lint, console', async () => {
    const t = testApp()
    await t.req('GET', '/api/i18n?lang=de')
    await t.login()
    const run = async (body: Record<string, unknown>) =>
      (await t.req('POST', '/api/servers/1/query', { db: DB, fromQueryBox: true, ...body })).json as {
        statements: Array<{ message: { text: string }; profiling?: { states: Array<{ percent: string }> } }>
      }

    // import mode (from the 50th statement): the message of the last statement, "# Rows: n" style
    const many = `${Array.from({ length: 55 }, () => 'SELECT 1').join(';\n')};`
    expect((await run({ sql: many })).statements.map((s) => s.message.text)).toEqual(['# Datensätze: 1'])
    const updates = `${Array.from({ length: 55 }, (_, i) => `UPDATE t SET name = 'x${i}' WHERE id = 1`).join(';\n')};`
    expect((await run({ sql: updates })).statements.map((s) => s.message.text)).toEqual([
      '# 1 Datensatz betroffen.',
    ])

    // "Create PHP code" and "Rollback when finished"
    expect((await run({ sql: 'SELECT 1', showAsPhp: true })).statements[0]?.message.text).toBe(
      'Ansicht als PHP-Code',
    )
    expect(
      sec(
        (await run({ sql: 'UPDATE t SET name = name WHERE id < 0', rollback: true })).statements[0]!.message
          .text,
      ),
    ).toBe('0 Datensatz betroffen. (Die Abfrage dauerte T Sekunden.) [ROLLBACK aufgetreten.]')

    // profiling: Util::formatNumber with the German separators
    const prof = (await run({ sql: 'SELECT * FROM t', profiling: true })).statements[0]?.profiling
    if (prof !== undefined) {
      for (const s of prof.states) expect(s.percent).toMatch(/^(<0,01|[\d.]+,\d\d)$/)
    }
    await run({ sql: 'SELECT 1', profiling: false })

    // simulate: "Only single-table UPDATE and DELETE queries can be simulated."
    const sim = await t.req('POST', '/api/servers/1/query/simulate', { sql: 'SELECT 1', db: DB })
    expect(sim.json).toMatchObject({
      sqlData: null,
      message: 'Nur UPDATE- und DELETE-Abfragen mit einer Tabelle können simuliert werden.',
    })

    // linter: "%1$s (near <code>%2$s</code>)"
    const lint = await t.req('POST', '/api/servers/1/sql/lint', { sql: 'SELECT * FROM' })
    const lints = lint.json.lints as Array<{ message: string }>
    expect(lints.length).toBeGreaterThan(0)
    for (const l of lints) expect(l.message).toMatch(/ \(bei <code>.*<\/code>\)$/)

    // console options
    expect(
      (await t.req('POST', '/api/servers/1/console/config', { key: 'Mode', value: 'show' })).json,
    ).toEqual({
      message: 'Die Konsoleneinstellungen wurden erfolgreich aktualisiert.',
    })
    const bad = await t.req('POST', '/api/servers/1/console/config', { key: 'Mode', value: 'nope' })
    expect((bad.json.error as { message: string }).message).toBe('Unerwarteter Parameterwert.')
    // back to the default: the stored preference is removed again
    await t.req('POST', '/api/servers/1/console/config', { key: 'Mode', value: 'info' })
    await t.close()
  })

  it('the UI msgids of the SQL tab exist in the German catalogue', () => {
    // the web app renders these with t(); the same catalogue (packages/i18n/po/de.po) is loaded there
    const de = translatorFor('de')
    expect(sprintf(de.gettext('%d errors were found during analysis.'), 2)).toBe(
      '2 Fehler wurden während der Analyse gefunden.',
    )
    expect(de.gettext('Affected rows:')).toBe('Betroffene Zeilen:')
    expect(de.gettext('Static analysis:')).toBe('Statische Analyse:')
    expect(
      ['Profiling', 'Detailed profile', 'Summary by state', 'Total Time'].map((m) => de.gettext(m)),
    ).toEqual(['Messen', 'Detailliertes Profil', 'Zusammenfassung nach Status', 'Gesamtzeit'])
  })
})
