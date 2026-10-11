import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Who is reading `mysql.general_log` right now. Every GeneralLog registers a holder file (pid +
 * start) in a directory shared by every worktree of this clone (next to the common .git dir; in CI
 * the checkout's .data), so the log is only rotated when no suite holds a marker into it.
 * Holders of dead processes are stale and removed. `BMA_LOG_HOLDERS_DIR` overrides the location.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')

function sharedRoot(): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return dirname(common)
  } catch {
    return repo
  }
}

export const HOLDERS_DIR =
  process.env.BMA_LOG_HOLDERS_DIR ?? join(sharedRoot(), '.data', 'general-log-holders')
const LOCK = `${HOLDERS_DIR}.lock`

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Runs `fn` under the registry's mutex (an atomic mkdir; a lock older than 60 s is broken). */
export async function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(LOCK), { recursive: true })
  for (let i = 0; ; i++) {
    try {
      mkdirSync(LOCK)
      break
    } catch {
      if (i > 600) {
        rmSync(LOCK, { recursive: true, force: true }) // a crashed holder of the lock (60 s)
        continue
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  try {
    return await fn()
  } finally {
    rmdirSync(LOCK)
  }
}

/** Live holders (stale ones of dead processes are deleted on the way). */
export function liveHolders(): string[] {
  mkdirSync(HOLDERS_DIR, { recursive: true })
  const out: string[] = []
  for (const f of readdirSync(HOLDERS_DIR)) {
    const pid = Number(readFileSync(join(HOLDERS_DIR, f), 'utf8').split(' ')[0])
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) out.push(f)
    else rmSync(join(HOLDERS_DIR, f), { force: true })
  }
  return out
}

/** Registers this process as a log reader; returns the release function (also run at exit). */
export function registerHolder(): () => void {
  mkdirSync(HOLDERS_DIR, { recursive: true })
  const file = join(HOLDERS_DIR, `${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  writeFileSync(file, `${process.pid} ${new Date().toISOString()} ${repo}\n`)
  let released = false
  const release = () => {
    if (released) return
    released = true
    rmSync(file, { force: true })
  }
  process.once('exit', release)
  return release
}
