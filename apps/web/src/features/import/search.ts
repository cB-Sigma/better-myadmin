import { z } from 'zod'

/** The import page's request parameters (a resumed import's link, a repopulated format). */
// the router parses `?timeout_passed=1` into a number: coerced back to the posted strings
export const importSearch = z.object({
  format: z.coerce.string().optional(),
  timeout_passed: z.coerce.string().optional(),
  offset: z.coerce.string().optional(),
  local_import_file: z.coerce.string().optional(),
  skip_queries: z.coerce.string().optional(),
})
export type ImportSearch = z.infer<typeof importSearch>

export function importPairs(s: ImportSearch): Array<[string, string]> {
  return Object.entries(s).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as [string, string]]))
}
