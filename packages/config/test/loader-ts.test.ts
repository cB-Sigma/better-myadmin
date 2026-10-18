import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/loader.ts'

/**
 * A TypeScript config file loads as an ES module wherever it sits: here in a temporary directory
 * with no package.json above it (Node would take a `.ts` there for CommonJS).
 */
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bma-ts-config-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const noPackageJsonAbove = (d: string): boolean => {
  for (let p = d; ; p = dirname(p)) {
    if (existsSync(join(p, 'package.json'))) return false
    if (dirname(p) === p) return true
  }
}

describe('loadConfig: .ts outside an ES module package', () => {
  it('default export, type annotations, top-level await', async () => {
    expect(noPackageJsonAbove(dir)).toBe(true)
    await writeFile(
      join(dir, 'bettermyadmin.config.ts'),
      `interface Partial { MaxRows: number }
       const rows: number = await Promise.resolve(50)
       const config: Partial & Record<string, unknown> = { MaxRows: rows, Servers: [{ host: 'db.example.org' }] }
       export default config`,
    )
    const { config, file } = await loadConfig({ cwd: dir, env: {} })
    expect(file).toBe(join(dir, 'bettermyadmin.config.ts'))
    expect(config.MaxRows).toBe(50)
    expect(config.Servers[1]?.host).toBe('db.example.org')
  })

  it("relative imports and defineConfig from '@bettermyadmin/config' (resolved from the loader)", async () => {
    await mkdir(join(dir, 'parts'))
    await writeFile(join(dir, 'parts/servers.ts'), `export const servers = [{ host: 'a' }, { host: 'b' }]`)
    await writeFile(
      join(dir, 'bettermyadmin.config.ts'),
      `import { defineConfig } from '@bettermyadmin/config'
       import { servers } from './parts/servers.ts'
       export default defineConfig({ Servers: servers, MaxRows: 25 })`,
    )
    const { config } = await loadConfig({ cwd: dir, env: {} })
    expect([config.Servers[1]?.host, config.Servers[2]?.host]).toEqual(['a', 'b'])
  })

  it('a default-exported function, .mts; nothing is written next to the file', async () => {
    await writeFile(join(dir, 'c.mts'), 'export default async (): Promise<object> => ({ MaxRows: 100 })')
    expect((await loadConfig({ cwd: dir, file: 'c.mts', env: {} })).config.MaxRows).toBe(100)
    expect(await readdir(dir)).toEqual(['c.mts'])
  })

  it('a syntax error is a ConfigError naming the file', async () => {
    await writeFile(join(dir, 'bettermyadmin.config.ts'), 'export default {')
    await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(/cannot load config module/)
  })
})
