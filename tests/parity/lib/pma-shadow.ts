import { type ChildProcess, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPmaUp } from './pma.ts'

/**
 * A second instance of the reference phpMyAdmin whose configuration the test can change between
 * requests: same source tree (symlinked), its own `config.inc.php` that includes the reference one
 * and then applies `overrides.json`. Served by `php -S` on its own port.
 *
 * Used where parity depends on directives the shared reference instance keeps at their defaults
 * (FirstLevelNavigationItems, DisableIS, hide_db, grouping…), or on a language the checkout (built
 * without translations, English only) does not offer: `locales` adds an empty catalog
 * `resources/locale/<code>/LC_MESSAGES/phpmyadmin.mo` per code to the shadow tree only, so
 * phpMyAdmin offers and selects that language (texts stay English, Current::$lang is the code).
 */
export interface PmaShadow {
  url: string
  /** `cfg` keys become `$cfg[k]`, `server` keys `$cfg['Servers'][1][k]`; replaces the previous overrides. */
  configure(o: { cfg?: Record<string, unknown>; server?: Record<string, unknown> }): void
  stop(): Promise<void>
}

export const PMA_ROOT = process.env.BMA_PARITY_PMA_ROOT ?? '/home/user/ref/pma'

export function canStartShadow(): boolean {
  return existsSync(join(PMA_ROOT, 'public', 'index.php')) && existsSync(join(PMA_ROOT, 'vendor'))
}

const phpString = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

export async function startPmaShadow(
  port: number,
  base: Record<string, unknown> = {},
  opts: { locales?: string[] } = {},
): Promise<PmaShadow> {
  const root = join(tmpdir(), `bma-pma-shadow-${port}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'public'), { recursive: true })
  const locales = opts.locales ?? []
  for (const entry of readdirSync(PMA_ROOT)) {
    if (entry === 'public' || entry === 'config.inc.php') continue
    if (entry === 'resources' && locales.length > 0) continue
    symlinkSync(join(PMA_ROOT, entry), join(root, entry))
  }
  if (locales.length > 0) {
    const resources = join(PMA_ROOT, 'resources')
    mkdirSync(join(root, 'resources', 'locale'), { recursive: true })
    for (const entry of readdirSync(resources)) {
      if (entry !== 'locale') symlinkSync(join(resources, entry), join(root, 'resources', entry))
    }
    const shipped = existsSync(join(resources, 'locale')) ? readdirSync(join(resources, 'locale')) : []
    for (const l of shipped) symlinkSync(join(resources, 'locale', l), join(root, 'resources', 'locale', l))
    for (const l of locales.filter((x) => !shipped.includes(x))) {
      mkdirSync(join(root, 'resources', 'locale', l, 'LC_MESSAGES'), { recursive: true })
      writeFileSync(join(root, 'resources', 'locale', l, 'LC_MESSAGES', 'phpmyadmin.mo'), '')
    }
  }
  for (const entry of readdirSync(join(PMA_ROOT, 'public'))) {
    // index.php must be a real file: ROOT_PATH = dirname(__DIR__)
    if (entry === 'index.php') copyFileSync(join(PMA_ROOT, 'public', entry), join(root, 'public', entry))
    else symlinkSync(join(PMA_ROOT, 'public', entry), join(root, 'public', entry))
  }
  const overrides = join(root, 'overrides.json')
  writeFileSync(
    join(root, 'config.inc.php'),
    `<?php
declare(strict_types=1);
require ${phpString(join(PMA_ROOT, 'config.inc.php'))};
// the server of the parity target (BMA_PARITY_TARGET, tests/parity/lib/target.ts), not the checkout's
$cfg['Servers'][1]['host'] = ${phpString(process.env.BMA_TEST_HOST ?? '127.0.0.1')};
$cfg['Servers'][1]['port'] = ${phpString(process.env.BMA_TEST_PORT ?? '3306')};
$bmaBase = json_decode(${phpString(JSON.stringify(base))}, true);
foreach (($bmaBase['server'] ?? []) as $k => $v) { $cfg['Servers'][1][$k] = $v; }
foreach (($bmaBase['cfg'] ?? []) as $k => $v) { $cfg[$k] = $v; }
$bmaOverrides = json_decode((string) @file_get_contents(__DIR__ . '/overrides.json'), true) ?: [];
foreach (($bmaOverrides['server'] ?? []) as $k => $v) { $cfg['Servers'][1][$k] = $v; }
foreach (($bmaOverrides['cfg'] ?? []) as $k => $v) { $cfg[$k] = $v; }
`,
  )
  writeFileSync(overrides, '{}')
  const proc: ChildProcess = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public'], {
    cwd: root,
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const ok = await isPmaUp(url)
    if (ok) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    url,
    configure(o) {
      writeFileSync(overrides, JSON.stringify(o))
    },
    async stop() {
      proc.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 50))
      rmSync(root, { recursive: true, force: true })
    },
  }
}
