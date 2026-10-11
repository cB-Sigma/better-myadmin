import { FIX } from './lib/env.ts'
import { type Step, pageParity } from './lib/parity.ts'

/**
 * The import forms (docs/features/07-export-import.md) at server, database and table scope, with
 * every format's option panel (the Format select shows `#<plugin>_options`; phpMyAdmin: import.ts).
 */
const FORMATS = ['CSV', 'ESRI Shape File', 'MediaWiki Table', 'OpenDocument Spreadsheet', 'XML', 'SQL']

const steps = (formats: string[]): Step[] =>
  formats.map((f) => ({ name: `format ${f}`, do: { select: ['Format', f] as [string, string] } }))

pageParity('server-import', {
  pma: { route: '/server/import' },
  ours: { path: '/s/1/import' },
  interactions: steps(FORMATS),
})

pageParity('database-import', {
  pma: { route: '/database/import', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/import` },
  interactions: steps(FORMATS),
})

pageParity('table-import', {
  pma: { route: '/table/import', params: { db: FIX.db, table: FIX.table } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/import` },
  interactions: steps(['CSV', 'CSV using LOAD DATA', ...FORMATS.slice(1)]),
})
