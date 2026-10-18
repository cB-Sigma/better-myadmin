import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The language part of UserPreferencesHandler::loadUserPreferences (preferences/language-sync.ts)
 * against the shared pmadb (`phpmyadmin`, control user pma). Only the user f08l_u is touched.
 */
const USER = 'f08l_u'
const SRV = { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' }
let root: mysql.Connection

async function storedPrefs(): Promise<Record<string, unknown> | null> {
  const [r] = (await root.query('SELECT config_data FROM phpmyadmin.pma__userconfig WHERE username = ?', [
    USER,
  ])) as unknown as [Array<{ config_data: string }>]
  return r[0] === undefined ? null : (JSON.parse(r[0].config_data) as Record<string, unknown>)
}

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}'`)
  await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
})
afterAll(async () => {
  await root.query('DELETE FROM phpmyadmin.pma__userconfig WHERE username = ?', [USER])
  await root.query(`DROP USER IF EXISTS '${USER}'@'%'`)
  await root.end()
})

describe('the language kept in the preferences [p08-495415]', () => {
  it('a language chosen before the login is stored at the next request; without the cookie the stored one is used; en removes it', async () => {
    const t = testApp(testConfig({}, SRV))
    // chosen on the login page
    await t.req('GET', '/api/i18n?lang=fr')
    expect((await t.login(USER, USER)).status).toBe(200)
    expect(t.jar.get('bma_lang')).toBe('fr')
    await t.req('GET', '/api/servers/1/home')
    expect((await storedPrefs())?.lang).toBe('fr')

    // a browser without the language cookie: the stored language, and the cookie written with it
    t.jar.delete('bma_lang')
    expect((await t.req('GET', '/api/servers/1/home')).status).toBe(200)
    expect(t.jar.get('bma_lang')).toBe('fr')

    await t.req('GET', '/api/i18n?lang=en')
    await t.req('GET', '/api/servers/1/home')
    expect((await storedPrefs())?.lang).toBeUndefined()
    await t.close()
  })
})
