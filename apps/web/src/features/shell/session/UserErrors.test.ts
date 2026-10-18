import { describe, expect, it } from 'vitest'
import { userErrorText } from './UserErrors.tsx'

describe('connection user errors (ErrorHandler::addUserError of postConnect)', () => {
  it('the time zone message names the zone and the server twice; the collation message', () => {
    expect(userErrorText({ kind: 'timezone', timeZone: 'Mars/Olympus', server: 2 })).toBe(
      "Unable to use timezone \"Mars/Olympus\" for server 2. Please check your configuration setting for [em]$cfg['Servers'][2]['SessionTimeZone'][/em]. BetterMyAdmin is currently using the default time zone of the database server.",
    )
    expect(userErrorText({ kind: 'collation', server: 1 })).toBe(
      'Failed to set configured collation connection!',
    )
  })
})
