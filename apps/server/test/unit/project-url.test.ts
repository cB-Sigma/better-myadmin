import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PROJECT_URL } from '@bettermyadmin/contracts/constants'
import { describe, expect, it } from 'vitest'
import { EXPORT_TOOL } from '../../src/export/service.ts'

/**
 * The project's URL is written once (packages/contracts/src/constants.ts): the dump headers, the
 * about pages, the login logo and the release links all use it, and no source file names another
 * repository of the project (QA: the export headers named a github.com/bettermyadmin one).
 */
const REPO = join(import.meta.dirname, '../../../..')

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'generated' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

describe('the project URL', () => {
  it('is the cB-Abhinav-Gautam/better-myadmin repository, shared by the server and the web app', () => {
    expect(PROJECT_URL).toBe('https://github.com/cB-Abhinav-Gautam/better-myadmin')
    expect(EXPORT_TOOL.url).toBe(PROJECT_URL)
    // the web app re-exports the constant (apps/web/src/lib/config.ts)
    expect(readFileSync(join(REPO, 'apps/web/src/lib/config.ts'), 'utf8')).toContain(
      "export { PROJECT_URL } from '@bettermyadmin/contracts/constants'",
    )
  })

  it('is written in one place only', () => {
    const offenders: string[] = []
    for (const root of ['apps/server/src', 'apps/web/src', 'packages']) {
      for (const f of sources(join(REPO, root))) {
        const rel = relative(REPO, f)
        if (rel === 'packages/contracts/src/constants.ts') continue
        const text = readFileSync(f, 'utf8')
        if (/github\.com\/[^/'"`\s]+\/better-?myadmin|cB-Abhinav-Gautam/i.test(text)) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
