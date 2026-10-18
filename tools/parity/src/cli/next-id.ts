/**
 * pnpm parity:next-id X|Q — the next free exception id of docs/reference/parity-exceptions.md
 * (one above the highest registered, retired rows included).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTER, nextId, registeredIds } from '../exception-ids.ts'
import { REPO } from '../util.ts'

const kind = process.argv
  .slice(2)
  .find((a) => a !== '--')
  ?.toUpperCase()
if (kind !== 'X' && kind !== 'Q') {
  console.error('usage: pnpm parity:next-id X|Q   (X: intentional difference, Q: source quirk)')
  process.exit(2)
}
console.log(nextId(registeredIds(readFileSync(join(REPO, REGISTER), 'utf8')), kind))
