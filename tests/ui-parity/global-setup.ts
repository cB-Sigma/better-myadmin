import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { holdSuiteLock } from '../e2e/suite-lock.ts'
import { ROOT, WORKERS, caseObjectsOf, fixturesOf, runOf, usersOf } from './lib/env.ts'
import { startPmaInstance } from './lib/instances.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')

export default async function setup() {
  // one UI parity run per MySQL at a time: both apps list the server's databases, processes and
  // accounts, which a concurrent run would change between the two captures
  const release = await holdSuiteLock('bma_browser:ui-parity', ROOT)
  rmSync(join(repo, '.data/ui-parity'), { recursive: true, force: true })
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  // ours gets a configuration storage of its own (the same tables as the reference's `phpmyadmin`),
  // so both apps show the storage-backed features (tracking, central columns, relations…)
  const storage = fixturesOf(runOf(0)).pmadb
  const pmadb = readFileSync(join(repo, 'docker/seed/pmadb.sql'), 'utf8')
    .replaceAll('phpmyadmin', storage)
    .split('\n')
    .filter((l) => !/^\s*GRANT\b/i.test(l))
    .join('\n')
  await c.query(`DROP DATABASE IF EXISTS ${storage};\n${pmadb}`)
  // each worker its own fixture database and accounts (lib/env.ts RUN)
  for (let w = 0; w < WORKERS; w++) {
    const run = runOf(w)
    const fix = fixturesOf(run)
    const { dbs, accounts } = caseObjectsOf(run)
    await c.query(`${[...dbs, fix.insertDb].map((d) => `DROP DATABASE IF EXISTS ${d};`).join(' ')}
      ${accounts.map((a) => `DROP USER IF EXISTS ${a};`).join(' ')}
      DROP DATABASE IF EXISTS ${fix.db}; CREATE DATABASE ${fix.db} COLLATE utf8mb4_general_ci;
      CREATE TABLE ${fix.db}.${fix.table} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL DEFAULT 'x' COMMENT 'display name',
        created DATETIME NULL,
        kind ENUM('a','b') NOT NULL DEFAULT 'a',
        KEY idx_name (name)
      ) ENGINE=InnoDB COMMENT='UI parity table';
      INSERT INTO ${fix.db}.${fix.table} (name, created) VALUES ('one', '2024-01-01 00:00:00'), ('two', NULL);`)
    for (const u of Object.values(usersOf(run))) {
      await c.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';
        GRANT ALL ON *.* TO '${u}'@'%' WITH GRANT OPTION;
        DELETE FROM phpmyadmin.pma__userconfig WHERE username = '${u}';`)
    }
  }
  await c.end()
  const pma = await privateReference()
  return async () => {
    await pma?.stop()
    await release()
  }
}

/**
 * The run's own reference phpMyAdmin, configured like the shared :8081 one (server 1 = ROOT, the
 * `phpmyadmin` storage with control user pma), unless BMA_PARITY_PMA_URL names one. The shared
 * instance is a single-process `php -S` that every checkout's parity runs and agents hit: a case
 * queued behind their requests took minutes, and its timeout cascaded into the next cases. The
 * private instance serves only this run, several requests at a time (a page loads ~35 assets).
 * Workers inherit the URL through the environment.
 */
async function privateReference() {
  if (process.env.BMA_PARITY_PMA_URL !== undefined) return null
  const inst = await startPmaInstance(
    `$cfg['blowfish_secret'] = 'uip-private-reference-0123456789abcdef';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = 'pma';
$cfg['Servers'][$i]['controlpass'] = 'pmapass';
$cfg['Servers'][$i]['pmadb'] = 'phpmyadmin';`,
    // a page loads ~35 assets: a few PHP workers per Playwright worker
    { workers: Number(process.env.BMA_UIP_PMA_WORKERS ?? Math.max(6, 4 * WORKERS)) },
  )
  process.env.BMA_PARITY_PMA_URL = inst.url
  // compile the login page's templates once, before the first case's timeout runs
  await fetch(`${inst.url}/index.php`).catch(() => {})
  return inst
}
