import { describe, expect, it } from 'vitest'
import { evaluateCondition, latestCompatible, versionCompare, versionToInt } from '../../src/shell/version.ts'

/** Expected values printed by PHP 8.3 (version_compare) and phpMyAdmin's VersionInformation. */
describe('VersionInformation port', () => {
  it.each([
    ['1.0', '1.0.0', -1],
    ['1.0.0', '1.0', 1],
    ['5.2.1', '5.2.1rc1', 1],
    ['5.2.1', '5.2.1pl1', -1],
    ['22.5.0', '22.4.9', 1],
    ['8.0.30', '8.0.30', 0],
    ['1.0-dev', '1.0', -1],
    ['1.0alpha', '1.0beta', -1],
    ['1.0RC1', '1.0', -1],
    ['10.11.6-MariaDB', '10.5', 1],
  ] as const)('version_compare(%s, %s) = %i', (a, b, exp) => {
    expect(versionCompare(a, b)).toBe(exp)
  })

  it.each([
    ['6.0.0-dev', 6000000],
    ['5.2.1', 5020150],
    ['5.2.1-rc2', 5020132],
    ['4.9.0.1', 4090051],
    ['5.0.0-beta1', 5000021],
    ['5.0.0-alpha', 5000010],
    ['5.2.1-pl1', 5020161],
    ['x.y', 50],
  ] as const)('versionToInt(%s) = %i', (v, exp) => {
    expect(versionToInt(v)).toBe(exp)
  })

  it('evaluates release constraints and picks the latest compatible release [p01-bb3004]', () => {
    expect(evaluateCondition('22.5.0', '>=22.5')).toBe(true)
    expect(evaluateCondition('22.5.0', '<22')).toBe(false)
    expect(evaluateCondition(null, '>=5.5')).toBe(false)
    const releases = [
      { version: '1.0.0', date: '2026-01-01', runtimeVersions: '>=20', mysqlVersions: '>=5.5' },
      { version: '1.2.0', date: '2026-06-01', runtimeVersions: '>=22.5', mysqlVersions: '>=5.7' },
      { version: '2.0.0', date: '2026-09-01', runtimeVersions: '>=99', mysqlVersions: '>=5.7' },
    ]
    expect(latestCompatible(releases, '22.15.0', '8.4.0', true)?.version).toBe('1.2.0')
    // MySQL constraints only count with exactly one server configured
    expect(latestCompatible(releases, '22.15.0', null, false)?.version).toBe('1.2.0')
    expect(latestCompatible(releases, '22.15.0', null, true)).toBeNull()
  })
})
