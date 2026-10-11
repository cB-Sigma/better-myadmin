import mysql from 'mysql2/promise'
import { FIX, ROOT, USERS } from './lib/env.ts'
import { writeGallery } from './lib/gallery.ts'
import { GALLERY_DIR } from './lib/parity.ts'

export default async function teardown() {
  const c = await mysql.createConnection({ ...ROOT, multipleStatements: true })
  await c.query(`DROP DATABASE IF EXISTS ${FIX.db}; DROP DATABASE IF EXISTS ${FIX.pmadb}`)
  for (const u of Object.values(USERS)) await c.query(`DROP USER IF EXISTS '${u}'@'%'`)
  // accounts of privileges.uip.ts
  await c.query(
    "DROP USER IF EXISTS 'f06u_uip1'@'%'; DROP USER IF EXISTS 'f06u_uip1'@'localhost'; DROP USER IF EXISTS 'f06u_uip2'@'%'",
  )
  await c.end()
  const file = writeGallery(GALLERY_DIR)
  if (file !== null) console.log(`ui-parity: screenshot gallery ${file}`)
}
