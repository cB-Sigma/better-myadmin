#!/usr/bin/env node
/**
 * The production entry point: the server runs from its TypeScript sources (the workspace packages
 * read their resources — translations, SQL scripts, the advisor rules — next to their sources), with
 * tsx's loader registered in-process. Config files are looked up in the working directory.
 *
 *   node apps/server/bin/bettermyadmin.mjs [--config file] [--host 0.0.0.0] [--port 8080] [--static dir]
 *   node apps/server/bin/bettermyadmin.mjs import-pma-config <config.inc.php> [-o file] [--force]
 */
import { register } from 'tsx/esm/api'

// node:sqlite (the session store) is stable enough for us; its ExperimentalWarning is noise, other
// warnings still print
const printWarning = process.listeners('warning')
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return
  for (const l of printWarning) l(w)
})

register()
if (process.argv[2] === 'import-pma-config') {
  const { importPmaConfigCommand } = await import('../src/cli/import-pma-config.ts')
  process.exitCode = importPmaConfigCommand(process.argv.slice(3))
} else {
  await import('../src/main.ts')
}
