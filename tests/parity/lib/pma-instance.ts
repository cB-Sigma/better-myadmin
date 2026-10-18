import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { languageStats } from '../../../packages/i18n/src/generated/catalog-index.ts'
import { isPmaUp } from './pma.ts'

/**
 * A private phpMyAdmin instance for parity cases that need their own `config.inc.php`
 * (e.g. `QueryHistoryDB`, a dedicated pmadb and control user), so they neither depend on
 * nor disturb the shared reference instance.
 *
 * The instance is a "shadow" root next to the reference checkout: every file is a symlink to
 * the checkout except `public/index.php` (copied, so `ROOT_PATH` resolves to the shadow root),
 * `config.inc.php`, `tmp/` and `app/cache/`. It is served by PHP's built-in server.
 */
export interface PmaInstance {
  url: string
  /** Lines written by the `dumpState` hook, one per request (oldest first). */
  dumps(): PmaStateDump[]
  /** Replaces config.inc.php (read by phpMyAdmin on every request). */
  setConfig(php: string): void
  stop(): Promise<void>
}

/** What the `dumpState` hook records at the end of every phpMyAdmin request. */
export interface PmaStateDump {
  route: string
  /** Current::$sqlQuery / $database / $table after the request */
  sqlQuery: string
  db: string
  table: string
  /** $_SESSION['sql_history'] */
  sqlHistory: Array<{ db: string; table: string; sqlquery: string }> | null
}

/**
 * Instrumentation appended to the shadow `public/index.php`: phpMyAdmin keeps some state only in
 * `$_SESSION` (e.g. the SQL history when pma__history is not written), which parity cases compare.
 */
function dumpHook(file: string): string {
  return `
register_shutdown_function(static function () {
  $c = \\PhpMyAdmin\\Current::class;
  file_put_contents(${JSON.stringify(file)}, json_encode([
    'route' => $_GET['route'] ?? $_POST['route'] ?? '',
    'sqlQuery' => $c::$sqlQuery,
    'db' => $c::$database,
    'table' => $c::$table,
    'sqlHistory' => $_SESSION['sql_history'] ?? null,
  ]) . "\\n", FILE_APPEND);
});
`
}

const PMA_PATH = process.env.PMA_PATH ?? '/home/user/ref/pma'
const BUILD_MO = fileURLToPath(new URL('../../../packages/i18n/scripts/build-mo.py', import.meta.url))
const PHP = process.env.BMA_PARITY_PHP ?? 'php'

/**
 * Whether a private instance can start: PHP and the reference checkout (PMA_PATH) with its vendor
 * tree. CI runners have PHP but no checkout (the references are compose containers there), so
 * the suites that need a private instance skip instead of failing on the missing tree.
 */
export function phpAvailable(): boolean {
  if (!existsSync(join(PMA_PATH, 'public', 'index.php')) || !existsSync(join(PMA_PATH, 'vendor')))
    return false
  try {
    return spawnSync(PHP, ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

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

function shadowTree(root: string, locales: readonly string[] = []): void {
  for (const entry of readdirSync(PMA_PATH)) {
    if (['public', 'app', 'config.inc.php', 'tmp'].includes(entry)) continue
    if (entry === 'resources' && locales.length > 0) continue
    symlinkSync(join(PMA_PATH, entry), join(root, entry))
  }
  if (locales.length > 0) {
    // resources/ of the checkout, plus the compiled catalogues a release ships (a git checkout has
    // no resources/locale: bin/generate-mo needs msgfmt), compiled with polib like
    // packages/i18n/scripts/serve-localized-pma.sh
    mkdirSync(join(root, 'resources'))
    for (const entry of readdirSync(join(PMA_PATH, 'resources'))) {
      if (entry !== 'locale') symlinkSync(join(PMA_PATH, 'resources', entry), join(root, 'resources', entry))
    }
    const r = spawnSync(
      'python3',
      ['-I', BUILD_MO, PMA_PATH, join(root, 'resources', 'locale'), ...locales],
      { encoding: 'utf8' },
    )
    if (r.status !== 0) throw new Error(`build-mo.py failed (pip install polib?)\n${r.stderr}`)
  }
  mkdirSync(join(root, 'public'))
  for (const entry of readdirSync(join(PMA_PATH, 'public'))) {
    if (entry === 'index.php') copyFileSync(join(PMA_PATH, 'public', entry), join(root, 'public', entry))
    else if (entry !== 'setup') symlinkSync(join(PMA_PATH, 'public', entry), join(root, 'public', entry))
  }
  // the setup script's ROOT_PATH (and so its config.inc.php check) is the shadow root too
  mkdirSync(join(root, 'public', 'setup'))
  for (const entry of readdirSync(join(PMA_PATH, 'public', 'setup'))) {
    const from = join(PMA_PATH, 'public', 'setup', entry)
    if (entry === 'index.php') copyFileSync(from, join(root, 'public', 'setup', entry))
    else symlinkSync(from, join(root, 'public', 'setup', entry))
  }
  mkdirSync(join(root, 'app'))
  for (const entry of readdirSync(join(PMA_PATH, 'app'))) {
    if (entry === 'cache') continue
    symlinkSync(join(PMA_PATH, 'app', entry), join(root, 'app', entry))
  }
  mkdirSync(join(root, 'app', 'cache'))
  mkdirSync(join(root, 'tmp'))
  // a release's app/language_stats.inc.php (generated with the catalogues, absent from a checkout):
  // the home page's incomplete-translation notice reads it
  if (locales.length > 0 && !readdirSync(join(PMA_PATH, 'app')).includes('language_stats.inc.php')) {
    const rows = Object.entries(languageStats).map(([k, v]) => `    ${JSON.stringify(k)} => ${v},`)
    writeFileSync(join(root, 'app', 'language_stats.inc.php'), `<?php\n\nreturn [\n${rows.join('\n')}\n];\n`)
  }
}

export async function startPmaInstance(
  configPhp: string,
  /** `noConfig`: no config.inc.php (the setup script runs only then; `configPhp` is ignored) */
  opts: {
    dumpState?: boolean
    noConfig?: boolean
    /** PHP_CLI_SERVER_WORKERS: the built-in server answers this many requests at once (default 1) */
    workers?: number
    /** compiled translations for these locale codes (default none: English only, like the checkout) */
    locales?: readonly string[]
  } = {},
): Promise<PmaInstance> {
  const root = mkdtempSync(join(tmpdir(), 'bma-pma-'))
  shadowTree(root, opts.locales)
  const dumpFile = join(root, 'tmp', 'state-dump.jsonl')
  writeFileSync(dumpFile, '')
  if (opts.dumpState === true) {
    const index = join(root, 'public', 'index.php')
    writeFileSync(
      index,
      readFileSync(index, 'utf8').replace(
        'require AUTOLOAD_FILE;',
        `require AUTOLOAD_FILE;\n${dumpHook(dumpFile)}`,
      ),
    )
  }
  const writeConfig = (php: string) =>
    writeFileSync(
      join(root, 'config.inc.php'),
      `<?php\ndeclare(strict_types=1);\n$cfg['TempDir'] = ${JSON.stringify(join(root, 'tmp'))};\n${php}\n`,
    )
  if (opts.noConfig !== true) writeConfig(configPhp)
  const port = await freePort()
  // revalidate_freq=0: setConfig() and rewritten included files (SignonScript) apply at once
  const proc: ChildProcess = spawn(
    PHP,
    ['-d', 'opcache.revalidate_freq=0', '-S', `127.0.0.1:${port}`, '-t', join(root, 'public')],
    {
      stdio: 'ignore',
      env:
        opts.workers !== undefined && opts.workers > 1
          ? { ...process.env, PHP_CLI_SERVER_WORKERS: String(opts.workers) }
          : process.env,
    },
  )
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    const ok = await isPmaUp(url, { anyStatus: true })
    if (ok) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    url,
    dumps: () =>
      readFileSync(dumpFile, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as PmaStateDump),
    setConfig: writeConfig,
    async stop() {
      proc.kill()
      await new Promise((r) => setTimeout(r, 50))
      rmSync(root, { recursive: true, force: true })
    },
  }
}
