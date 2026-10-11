import { z } from 'zod'

/** The import page's request parameters (a resumed import's link, a repopulated format). */
export const importSearch = z.object({
  format: z.string().optional(),
  timeout_passed: z.string().optional(),
  offset: z.string().optional(),
  local_import_file: z.string().optional(),
  skip_queries: z.string().optional(),
})
export type ImportSearch = z.infer<typeof importSearch>

export function importPairs(s: ImportSearch): Array<[string, string]> {
  return Object.entries(s).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as [string, string]]))
}
