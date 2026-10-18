import { afterAll, describe, expect, it } from 'vitest'
import { USER_ERRORS_HEADER } from '../../src/http/user-errors.ts'
import { testApp, testConfig } from '../support/app.ts'

/**
 * The user errors of a request (ErrorHandler::addUserError): DatabaseInterface::postConnect's time
 * zone and setCollation's collation, sent with every answer that used such a connection.
 */
const header = (r: { res: Response }) => {
  const h = r.res.headers.get(USER_ERRORS_HEADER)
  return h === null ? null : (JSON.parse(decodeURIComponent(h)) as Array<{ level: string; html: string }>)
}
const apps: Array<ReturnType<typeof testApp>> = []
const make = (...a: Parameters<typeof testConfig>) => {
  const app = testApp(testConfig(...a))
  apps.push(app)
  return app
}
afterAll(async () => {
  for (const a of apps) await a.close()
})

describe('connection set-up errors', () => {
  it('a SessionTimeZone the server refuses: "Unable to use timezone …", on every answer', async () => {
    const app = make({}, { SessionTimeZone: 'Nowhere/F05' })
    await app.login()
    for (const path of ['/api/servers/1/home', '/api/servers/1/databases']) {
      expect(header(await app.req('GET', path))).toEqual([
        {
          level: 'error',
          html: 'Unable to use timezone &quot;Nowhere/F05&quot; for server 1. Please check your configuration setting for <em>$cfg[&#039;Servers&#039;][1][&#039;SessionTimeZone&#039;]</em>. phpMyAdmin is currently using the default time zone of the database server.',
        },
      ])
    }
  })

  it('a connection collation the server refuses: "Failed to set configured collation connection!"', async () => {
    const app = make({ DefaultConnectionCollation: 'f05_nope_ci' })
    await app.login()
    expect(header(await app.req('GET', '/api/servers/1/home'))).toEqual([
      { level: 'error', html: 'Failed to set configured collation connection!' },
    ])
  })

  it('a valid set-up sends none', async () => {
    const app = make({ DefaultConnectionCollation: 'utf8mb4_unicode_ci' }, { SessionTimeZone: '+00:00' })
    await app.login()
    expect(header(await app.req('GET', '/api/servers/1/home'))).toBeNull()
  })
})
