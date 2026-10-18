import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

export interface GitUser {
  name: string
  email: string
  /** `Y-m-d H:i:s O` in the commit's own time zone */
  date: string
}

export interface GitInfo {
  hash: string
  branch: string | null
  /** Commit message (its lines joined by spaces), from a loose object; null when the commit is packed. */
  message: string | null
  author: GitUser | null
  committer: GitUser | null
}

/**
 * The author / committer header lines and the message of a commit object's body.
 * pma: src/Git.php::extractDataFormTextBody
 */
export function parseCommitBody(raw: string): {
  author: GitUser | null
  committer: GitUser | null
  message: string
} {
  const lines = raw.split('\n')
  let author: GitUser | null = null
  let committer: GitUser | null = null
  let line: string | undefined
  do {
    line = lines.shift()
    if (line === undefined) break
    const sp = line.indexOf(' ')
    const type = sp < 0 ? line : line.slice(0, sp)
    if (type !== 'author' && type !== 'committer') continue
    const m = line.slice(sp + 1).match(/([^<]+)<([^>]+)> ([0-9]+)( [^ ]+)?/)
    if (m === null) continue
    const tz = (m[4] ?? ' +0000').trim()
    const tm = tz.match(/^([+-])(\d{2})(\d{2})$/)
    const offset = tm === null ? 0 : (tm[1] === '-' ? -1 : 1) * (Number(tm[2]) * 60 + Number(tm[3]))
    const d = new Date((Number(m[3]) + offset * 60) * 1000)
    const p2 = (n: number) => String(n).padStart(2, '0')
    const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${tm === null ? '+0000' : tz}`
    const user = { name: m[1]!.trim(), email: m[2]!.trim(), date }
    if (type === 'author') author = user
    else committer = user
  } while (line !== '')
  return { author, committer, message: lines.join(' ').trim() }
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
    let author: GitUser | null = null
    let committer: GitUser | null = null
    const obj = join(commonDir, 'objects', hash.slice(0, 2), hash.slice(2))
    if (existsSync(obj)) {
      const raw = inflateSync(readFileSync(obj)).toString('utf8')
      // "commit <size>\0" then the headers, a blank line and the message
      const c = parseCommitBody(raw.slice(raw.indexOf('\0') + 1))
      message = c.message
      author = c.author
      committer = c.committer
    }
    cached = { hash, branch, message, author, committer }
    return cached
  } catch {
    return null
  }
}
