import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

export interface GitInfo {
  hash: string
  branch: string | null
  /** Commit message (first line), from a loose object; null when the commit is packed. */
  message: string | null
}

let cached: GitInfo | null | undefined

/**
 * Git revision of the running checkout, read from `.git` without spawning git: HEAD, loose refs,
 * packed-refs, worktree `gitdir:` files and loose commit objects (pack files are not parsed, so
 * the message is omitted for packed commits).
 * pma: src/Git.php (isGitRevision, checkGitRevision, getHashFromHeadRef, getPackedRefs, …)
 */
export function readGitInfo(start = dirname(fileURLToPath(import.meta.url))): GitInfo | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    let dir = resolve(start)
    let gitPath: string | null = null
    for (;;) {
      if (existsSync(join(dir, '.git'))) {
        gitPath = join(dir, '.git')
        break
      }
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    if (gitPath === null) return null
    let gitDir = gitPath
    if (statSync(gitPath).isFile()) {
      const m = readFileSync(gitPath, 'utf8').match(/^gitdir:\s*(.+)$/m)
      if (m === null) return null
      gitDir = isAbsolute(m[1]!.trim()) ? m[1]!.trim() : resolve(dir, m[1]!.trim())
    }
    const commonFile = join(gitDir, 'commondir')
    const commonDir = existsSync(commonFile)
      ? resolve(gitDir, readFileSync(commonFile, 'utf8').trim())
      : gitDir
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    let hash: string | null = null
    let branch: string | null = null
    const ref = head.match(/^ref:\s*(.+)$/)
    if (ref !== null) {
      const name = ref[1]!.trim()
      branch = name.replace(/^refs\/heads\//, '')
      for (const base of [gitDir, commonDir]) {
        const f = join(base, name)
        if (existsSync(f)) {
          hash = readFileSync(f, 'utf8').trim()
          break
        }
      }
      if (hash === null) {
        const packed = join(commonDir, 'packed-refs')
        if (existsSync(packed)) {
          for (const line of readFileSync(packed, 'utf8').split('\n')) {
            const [h, r] = line.split(' ')
            if (r === name && h !== undefined) hash = h
          }
        }
      }
    } else if (/^[0-9a-f]{40}$/.test(head)) {
      hash = head
    }
    if (hash === null) return null
    let message: string | null = null
    const obj = join(commonDir, 'objects', hash.slice(0, 2), hash.slice(2))
    if (existsSync(obj)) {
      const raw = inflateSync(readFileSync(obj)).toString('utf8')
      const body = raw.slice(raw.indexOf('\n\n') + 2)
      message = body.split('\n')[0] ?? null
    }
    cached = { hash, branch, message }
    return cached
  } catch {
    return null
  }
}
