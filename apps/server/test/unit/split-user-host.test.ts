import { describe, expect, it } from 'vitest'
import { splitUserHost } from '../../src/shell/privileges.ts'

// X55: CURRENT_USER() / a definer split at the last '@' (a host never contains one)
describe('splitUserHost', () => {
  it('splits a plain user', () => {
    expect(splitUserHost('root@localhost')).toEqual(['root', 'localhost'])
  })
  it('keeps the @ of a user named by an email', () => {
    expect(splitUserHost('abhinav@codebuckets.in@%')).toEqual(['abhinav@codebuckets.in', '%'])
  })
  it('gives an empty host without an @, and an empty user for --skip-grant-tables', () => {
    expect(splitUserHost('role')).toEqual(['role', ''])
    expect(splitUserHost('@')).toEqual(['', ''])
  })
})
