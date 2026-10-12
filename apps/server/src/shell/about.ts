/**
 * The static pages: List of changes, License, and the runtime information that stands in for
 * phpinfo() (parity exception X15).
 *
 * pma: src/Controllers/ChangeLogController.php, src/Controllers/LicenseController.php,
 *      src/Controllers/PhpInfoController.php, templates/changelog.twig
 */
import { existsSync, readFileSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

/** the checkout's root: the first parent with pnpm-workspace.yaml */
function projectRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const up = dirname(dir)
    if (up === dir) return resolve(start)
    dir = up
  }
}

/** LICENSE_FILE / Config::getChangeLogFilePath: overridable, gzip accepted for the changelog */
export function aboutFile(kind: 'license' | 'changelog'): string {
  const env = kind === 'license' ? process.env.BMA_LICENSE_FILE : process.env.BMA_CHANGELOG_FILE
  if (env !== undefined && env !== '') return env
  const root = projectRoot()
  if (kind === 'license') return join(root, 'LICENSE')
  const md = join(root, 'CHANGELOG.md')
  return existsSync(md) || !existsSync(`${md}.gz`) ? md : `${md}.gz`
}

function readText(file: string): string | null {
  try {
    const buf = readFileSync(file)
    return (file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8')
  } catch {
    return null
  }
}

export const readLicense = (file = aboutFile('license')) => readText(file)

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

/**
 * ChangeLogController: the escaped changelog with phpMyAdmin's rewrites (headings, release and
 * issue links, FAQ, CVE / CAN, PMASA entries, links opening a new window), for the project's
 * repository instead of phpMyAdmin's.
 */
export function renderChangelog(text: string, repoUrl: string, faqUrl: string): string {
  let changelog = esc(text)
  const repo = repoUrl.endsWith('/') ? repoUrl : `${repoUrl}/`
  const q = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const releaseLinks = new Map<string, string>()
  for (const m of changelog.matchAll(new RegExp(`\\n\\[(\\d+\\.\\d+\\.\\d+)]: (${q}\\S+)`, 'g'))) {
    releaseLinks.set(m[1] ?? '', m[2] ?? '')
  }
  changelog = changelog.replace(
    /\n## \[(\d+\.\d+\.\d+)]/g,
    (_, v: string) => `\n## [${v}](${releaseLinks.get(v) ?? ''})`,
  )
  const replaces: Array<[RegExp, string]> = [
    [/# Changes in (.+?) (\d+\.\d+)/g, '<h1>Changes in $1 $2</h1>'],
    [/\[Keep a Changelog\]\(https:\/\/keepachangelog.com\/\)/g, 'Keep a Changelog'],
    [/\n### (Added|Changed|Deprecated|Removed|Fixed|Security)/g, '\n<h3>$1</h3>'],
    // Add link to release title
    [
      new RegExp(
        `\\n## \\[(\\d+\\.\\d+\\.\\d+)\\]\\((${q}\\S+)\\) \\- (\\d{4}|YYYY)-(\\d{2}|MM)-(\\d{2}|DD)\\n`,
        'g',
      ),
      '\n<h2><a href="$2">$1</a> $3-$4-$5</h2>\n',
    ],
    // Add link to issues/commits
    [new RegExp(`\\[(\\#\\d+|[a-z0-9]+)\\]\\((${q}\\S+)\\)`, 'g'), '<a href="$2">$1</a>'],
    // FAQ entries
    [/FAQ ([0-9]+)\.([0-9a-z]+)/gi, `<a href="${faqUrl}#faq$1-$2">FAQ $1.$2</a>`],
    // CVE/CAN entries
    [/((CAN|CVE)-[0-9]+-[0-9]+)/g, '<a href="https://www.cve.org/CVERecord?id=$1">$1</a>'],
    // PMASA entries
    [/(PMASA-[0-9]+-[0-9]+)/g, '<a href="https://www.phpmyadmin.net/security/$1/">$1</a>'],
    // Links target and rel
    [/a href="/g, 'a target="_blank" rel="noopener noreferrer" href="'],
  ]
  for (const [re, to] of replaces) changelog = changelog.replace(re, to)
  // the release date placeholder
  return changelog.replace(/YYYY-MM-DD/g, '(not yet released)')
}

/** the runtime facts shown instead of phpinfo() (X15) */
export function runtimeInfo(cfg: { ShowServerInfo: unknown }) {
  const mem = process.memoryUsage()
  return {
    runtime: { name: 'Node.js', version: process.version, versions: { ...process.versions } },
    system: { platform: platform(), arch: arch(), release: release() },
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      cwd: process.cwd(),
    },
    config: { ShowServerInfo: cfg.ShowServerInfo },
  }
}
