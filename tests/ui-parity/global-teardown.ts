import mysql from 'mysql2/promise'
import { ROOT, WORKERS, caseObjectsOf, fixturesOf, runOf, usersOf } from './lib/env.ts'
import { writeGallery } from './lib/gallery.ts'
import { GALLERY_DIR } from './lib/parity.ts'

export default async function teardown() {
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${fixturesOf(runOf(0)).pmadb}`)
  for (let w = 0; w < WORKERS; w++) {
    const run = runOf(w)
    const fix = fixturesOf(run)
    const { dbs, accounts } = caseObjectsOf(run)
    await c.query(
      `${[fix.db, fix.insertDb, ...dbs].map((d) => `DROP DATABASE IF EXISTS ${d};`).join(' ')}
      ${accounts.map((a) => `DROP USER IF EXISTS ${a};`).join(' ')}`,
    )
    for (const u of Object.values(usersOf(run))) await c.query(`DROP USER IF EXISTS '${u}'@'%'`)
  }
  await c.end()
  const file = writeGallery(GALLERY_DIR)
  if (file !== null) console.log(`ui-parity: screenshot gallery ${file}`)
}
