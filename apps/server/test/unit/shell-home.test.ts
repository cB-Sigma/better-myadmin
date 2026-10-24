import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import { getServer } from '../../src/config.ts'
import { parseCommitBody } from '../../src/shell/git.ts'
import { homeWarnings } from '../../src/shell/home.ts'
import { testConfig } from '../support/app.ts'

describe('Git::extractDataFormTextBody (parseCommitBody)', () => {
  it('reads the author and the committer in their own time zone, and joins the message lines', () => {
    const body = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'parent 1111111111111111111111111111111111111111',
      'author Ann Author <ann@example.org> 1700000000 +0530',
      'committer Carl Committer <carl@example.org> 1700003600 -0100',
      '',
      'Fix the thing',
      '',
      'With a body.',
    ].join('\n')
    expect(parseCommitBody(body)).toEqual({
      author: { name: 'Ann Author', email: 'ann@example.org', date: '2023-11-15 03:43:20 +0530' },
      committer: { name: 'Carl Committer', email: 'carl@example.org', date: '2023-11-14 22:13:20 -0100' },
      message: 'Fix the thing  With a body.',
    })
  })
})

describe('HomeController::checkRequirements', () => {
  const cfg = testConfig()
  const ctx = { cfg, server: getServer(cfg, 1)!, tr: englishTranslator(), lang: 'en' }
  const env = {
    httpHost: 'localhost',
    configuredSecret: 'x'.repeat(32),
    secretGenerated: false,
    partialLogout: false,
    connectionCollation: 'utf8mb4_unicode_ci',
  }
  it("warns about the setup script's leftover config directory", () => {
    const msg = (setupConfigDir: boolean) =>
      homeWarnings(ctx, { ...env, setupConfigDir }).map((w) => w.message)
    expect(msg(true)).toContain(
      'Directory [code]config[/code], which is used by the setup script, still exists in your BetterMyAdmin directory. It is strongly recommended to remove it once BetterMyAdmin has been configured. Otherwise the security of your server may be compromised by unauthorized people downloading your configuration.',
    )
    expect(msg(false).some((m) => m.includes('[code]config[/code]'))).toBe(false)
  })
})
