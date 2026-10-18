import { USER_ERRORS_HEADER } from '@bettermyadmin/contracts'
import { describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../support/app.ts'

/**
 * ErrorHandler::addUserError of the connection set-up (DatabaseInterface::postConnect): an unusable
 * SessionTimeZone is reported with the response (USER_ERRORS_HEADER) of every request that uses the
 * connection, as phpMyAdmin reports it on every page; a working one reports nothing.
 */
const errorsOf = (res: Response) => {
  const h = res.headers.get(USER_ERRORS_HEADER)
  return h === null ? null : (JSON.parse(decodeURIComponent(h)) as unknown)
}

describe('connection user errors', () => {
  it('an unknown SessionTimeZone: the time zone error with the server number, on each request', async () => {
    const t = testApp(testConfig({}, { SessionTimeZone: 'Mars/Olympus_Mons' }))
    try {
      await t.login()
      for (let i = 0; i < 2; i++) {
        const r = await t.req('GET', '/api/servers/1')
        expect(r.status).toBe(200)
        expect(errorsOf(r.res)).toEqual([{ kind: 'timezone', timeZone: 'Mars/Olympus_Mons', server: 1 }])
      }
    } finally {
      await t.close()
    }
  })

  it('a valid SessionTimeZone reports nothing', async () => {
    const t = testApp(testConfig({}, { SessionTimeZone: '+00:00' }))
    try {
      await t.login()
      const r = await t.req('GET', '/api/servers/1')
      expect(r.status).toBe(200)
      expect(errorsOf(r.res)).toBeNull()
    } finally {
      await t.close()
    }
  })
})
