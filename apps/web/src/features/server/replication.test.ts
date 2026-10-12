import { describe, expect, it } from 'vitest'
import { checkAddUser, hostnameForPreset, primaryConfigSnippet, randomServerId } from './replication.ts'

describe('replication helpers', () => {
  it('primary configuration snippet (replication.ts::updateConfig)', () => {
    expect(primaryConfigSnippet(42, 'all', [])).toBe(
      'server-id=42\nlog_bin=mysql-bin\nlog_error=mysql-bin.err\n',
    )
    expect(primaryConfigSnippet(42, 'all', ['a', 'b'])).toBe(
      'server-id=42\nlog_bin=mysql-bin\nlog_error=mysql-bin.err\nbinlog_ignore_db=a\nbinlog_ignore_db=b\n',
    )
    expect(primaryConfigSnippet(7, 'ign', ['a'])).toBe(
      'server-id=7\nlog_bin=mysql-bin\nlog_error=mysql-bin.err\nbinlog_do_db=a\n',
    )
  })

  it('random server id below 10000000', () => {
    expect(randomServerId(() => 0.99999999)).toBe(9999999)
    expect(randomServerId(() => 0)).toBe(0)
  })

  it('host presets fill the host field', () => {
    expect(hostnameForPreset('any', null)).toBe('%')
    expect(hostnameForPreset('localhost', null)).toBe('localhost')
    expect(hostnameForPreset('thishost', '10.0.0.2')).toBe('10.0.0.2')
    expect(hostnameForPreset('thishost', null)).toBeNull()
    expect(hostnameForPreset('hosttable', null)).toBe('')
    expect(hostnameForPreset('userdefined', null)).toBeNull()
  })

  it('CheckAddUser: host, then user name, then the password pair', () => {
    const ok = {
      hostname: '%',
      predUsername: 'userdefined' as const,
      username: 'r',
      predPassword: 'userdefined' as const,
      password: 'x',
      password2: 'x',
    }
    expect(checkAddUser(ok)).toBeNull()
    expect(checkAddUser({ ...ok, hostname: '' })).toBe('The host name is empty!')
    expect(checkAddUser({ ...ok, username: '' })).toBe('The user name is empty!')
    expect(checkAddUser({ ...ok, predUsername: 'any', username: '' })).toBeNull()
    expect(checkAddUser({ ...ok, password2: 'y' })).toBe("The passwords aren't the same!")
    expect(checkAddUser({ ...ok, password: '', password2: '' })).toBe('The password is empty!')
    expect(checkAddUser({ ...ok, predPassword: 'none', password: '' })).toBeNull()
  })
})
