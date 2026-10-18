import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../../src/app.ts'
import { setupOpenWarning } from '../../src/setup/service.ts'

/** L3 of docs/reference/security-review.md: the start-up warning while setup needs no login. */
describe('setup open without a login', () => {
  const deps = (o: Partial<AppDeps> = {}) => ({ cfg: { DBG: { demo: false } }, ...o }) as unknown as AppDeps
  it('warns without a configuration file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bma-setup-'))
    expect(setupOpenWarning(deps(), cwd)).toMatch(/setup script at \/setup is open without a login/)
  })
  it('is quiet once one was loaded or written', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bma-setup-'))
    expect(setupOpenWarning(deps({ configFile: '/etc/bettermyadmin.config.json' }), cwd)).toBeNull()
    writeFileSync(join(cwd, 'bettermyadmin.config.json'), '{}')
    expect(setupOpenWarning(deps(), cwd)).toBeNull()
  })
})
