import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
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
const PHP = process.env.BMA_PARITY_PHP ?? 'php'

export function phpAvailable(): boolean {
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

function shadowTree(root: string): void {
  for (const entry of readdirSync(PMA_PATH)) {
    if (['public', 'app', 'config.inc.php', 'tmp'].includes(entry)) continue
    symlinkSync(join(PMA_PATH, entry), join(root, entry))
  }
  mkdirSync(join(root, 'public'))
  for (const entry of readdirSync(join(PMA_PATH, 'public'))) {
    if (entry === 'index.php') copyFileSync(join(PMA_PATH, 'public', entry), join(root, 'public', entry))
    else symlinkSync(join(PMA_PATH, 'public', entry), join(root, 'public', entry))
  }
  mkdirSync(join(root, 'app'))
  for (const entry of readdirSync(join(PMA_PATH, 'app'))) {
    if (entry === 'cache') continue
    symlinkSync(join(PMA_PATH, 'app', entry), join(root, 'app', entry))
  }
  mkdirSync(join(root, 'app', 'cache'))
  mkdirSync(join(root, 'tmp'))
}

export async function startPmaInstance(
  configPhp: string,
  opts: { dumpState?: boolean } = {},
): Promise<PmaInstance> {
  const root = mkdtempSync(join(tmpdir(), 'bma-pma-'))
  shadowTree(root)
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
  writeConfig(configPhp)
  const port = await freePort()
  const proc: ChildProcess = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', join(root, 'public')], {
    stdio: 'ignore',
  })
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
