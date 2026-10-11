/**
 * pnpm parity:inventory — regenerates tools/parity/inventory/*.json from the phpMyAdmin checkout
 * (PMA_PATH, default /home/user/ref/pma). Needs PHP 8.3 (executes phpMyAdmin's routing, Twig and
 * Settings) and the checkout at the commit in docs/reference/reference-commit.txt.
 */
import { INVENTORY_KINDS, extractAll, writeInventories } from '../inventory.ts'
import { pmaHead, pmaPath, referenceCommit } from '../util.ts'

const pma = pmaPath()
const head = pmaHead(pma)
const ref = referenceCommit()
if (head === null) {
  console.error(`parity:inventory: no phpMyAdmin checkout at ${pma} (set PMA_PATH)`)
  process.exit(2)
}
if (head !== ref && !process.argv.includes('--any-commit')) {
  console.error(
    `parity:inventory: ${pma} is at ${head.slice(0, 8)} but docs/reference/reference-commit.txt says ${ref.slice(0, 8)}.\n` +
      'Check out the reference commit, or update reference-commit.txt (and the docs) first; --any-commit overrides.',
  )
  process.exit(2)
}
const inv = extractAll(pma)
writeInventories(inv)
for (const kind of INVENTORY_KINDS) console.log(`${kind.padEnd(11)} ${inv[kind]._meta.count}`)
