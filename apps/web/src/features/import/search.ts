import { z } from 'zod'
import { qs } from '../../lib/search'

/** The import page's request parameters (a resumed import's link, a repopulated format). */
// read like $_GET (lib/search.ts)
export const importSearch = z.object({
  format: qs.str(),
  timeout_passed: qs.str(),
  offset: qs.str(),
  local_import_file: qs.str(),
  skip_queries: qs.str(),
})
export type ImportSearch = z.infer<typeof importSearch>

export function importPairs(s: ImportSearch): Array<[string, string]> {
  return Object.entries(s).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as [string, string]]))
}
