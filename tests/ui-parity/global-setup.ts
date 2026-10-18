import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { holdSuiteLock } from '../e2e/suite-lock.ts'
import { FIX, ROOT, USERS } from './lib/env.ts'
import { startPmaInstance } from './lib/instances.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')

export default async function setup() {
  // one UI parity run per MySQL at a time: both apps list the server's databases, processes and
  // accounts, which a concurrent run would change between the two captures
  const release = await holdSuiteLock('bma_browser:ui-parity', ROOT)
  rmSync(join(repo, '.data/ui-parity'), { recursive: true, force: true })
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${FIX.insertDb};
    DROP DATABASE IF EXISTS ${FIX.db}; CREATE DATABASE ${FIX.db} COLLATE utf8mb4_general_ci;
    CREATE TABLE ${FIX.db}.${FIX.table} (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(40) NOT NULL DEFAULT 'x' COMMENT 'display name',
      created DATETIME NULL,
      kind ENUM('a','b') NOT NULL DEFAULT 'a',
      KEY idx_name (name)
    ) ENGINE=InnoDB COMMENT='UI parity table';
    INSERT INTO ${FIX.db}.${FIX.table} (name, created) VALUES ('one', '2024-01-01 00:00:00'), ('two', NULL);`)
  // ours gets a configuration storage of its own (the same tables as the reference's `phpmyadmin`),
  // so both apps show the storage-backed features (tracking, central columns, relations…)
  const pmadb = readFileSync(join(repo, 'docker/seed/pmadb.sql'), 'utf8')
    .replaceAll('phpmyadmin', FIX.pmadb)
    .split('\n')
    .filter((l) => !/^\s*GRANT\b/i.test(l))
    .join('\n')
  await c.query(`DROP DATABASE IF EXISTS ${FIX.pmadb};\n${pmadb}`)
  for (const u of Object.values(USERS)) {
    await c.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';
      GRANT ALL ON *.* TO '${u}'@'%' WITH GRANT OPTION;`)
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
    { workers: Number(process.env.BMA_UIP_PMA_WORKERS ?? 6) },
  )
  process.env.BMA_PARITY_PMA_URL = inst.url
  // compile the login page's templates once, before the first case's timeout runs
  await fetch(`${inst.url}/index.php`).catch(() => {})
  return inst
}
