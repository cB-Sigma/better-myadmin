import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export { startPmaInstance, type PmaInstance } from '../../parity/lib/pma-instance.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => resolve(typeof addr === 'object' && addr !== null ? addr.port : 0))
    })
  })
}

export interface BmaInstance {
  url: string
  stop(): Promise<void>
}

/**
 * Our server with its own configuration (another auth type), or with none at all (`config`
 * undefined: the setup script runs only then), serving the built SPA. The working directory is a
 * fresh temporary one, so no configuration file is found there.
 */
export async function startBmaInstance(config?: Record<string, unknown>): Promise<BmaInstance> {
  const cwd = mkdtempSync(join(tmpdir(), 'bma-uip-'))
  const port = await freePort()
  const args = [join(repo, 'apps/server/src/main.ts'), '--port', String(port), '--host', '127.0.0.1']
  args.push('--static', join(repo, 'apps/web/dist'))
  if (config !== undefined) {
    const file = join(cwd, 'instance.config.json')
    writeFileSync(file, JSON.stringify({ DataDir: join(cwd, 'data'), ...config }))
    args.push('--config', file)
  }
  const env: Record<string, string | undefined> = { ...process.env, BMA__DataDir: join(cwd, 'data') }
  const proc: ChildProcess = spawn(join(repo, 'apps/server/node_modules/.bin/tsx'), args, {
    cwd,
    env,
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    const up = await fetch(`${url}/api/meta/health`)
      .then((r) => r.ok)
      .catch(() => false)
    if (up) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    url,
    async stop() {
      proc.kill()
      await new Promise((r) => setTimeout(r, 100))
      rmSync(cwd, { recursive: true, force: true })
    },
  }
}
