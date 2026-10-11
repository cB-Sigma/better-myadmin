import { FIX } from './lib/env.ts'
import { type Step, pageParity } from './lib/parity.ts'

/**
 * The export forms (docs/features/07-export-import.md) at server, database and table scope:
 * quick vs custom, then every format's option panel (the format select switches the visible
 * `#<plugin>_options` block; phpMyAdmin: export.ts).
 */
const FORMATS = [
  'CodeGen',
  'CSV',
  'CSV for MS Excel',
  'JSON',
  'LaTeX',
  'MediaWiki Table',
  'Microsoft Word 2000',
  'OpenDocument Spreadsheet',
  'OpenDocument Text',
  'PHP array',
  'Texy! text',
  'TOON',
  'YAML',
  'SQL',
]

const steps = (formats: string[]): Step[] => [
  { name: 'custom', do: { check: 'Custom - display all possible options' } },
  ...formats.map((f) => ({ name: `format ${f}`, do: { select: ['File format to export', f] as [string, string] } })),
]

pageParity('server-export', {
  pma: { route: '/server/export' },
  ours: { path: '/s/1/export' },
  interactions: steps(FORMATS),
})

pageParity('database-export', {
  pma: { route: '/database/export', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/export` },
  interactions: steps([...FORMATS.slice(0, -1), 'XML', 'SQL']),
})

pageParity('table-export', {
  pma: { route: '/table/export', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/export` },
  interactions: steps([...FORMATS.slice(0, -1), 'XML', 'SQL']),
})
