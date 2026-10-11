import { z } from 'zod'
import { FormPairs, type PluginInfo } from './export.ts'
import { StatementResult } from './query.ts'

/**
 * Import (docs/features/07-export-import.md). The form is posted as phpMyAdmin's own field pairs
 * (`format`, `import_type`, `charset_of_file`, `csv_terminated` …); the file goes up first in
 * chunks (`…/import/uploads`), then `POST …/import` streams progress and the result as SSE.
 */
export type ImportScope = 'server' | 'database' | 'table'

export interface ImportPageResponse {
  importType: ImportScope
  db: string
  table: string
  /** "Importing into the current server" … */
  title: string
  /** Import::getCompressions */
  compressions: string[]
  isUpload: boolean
  /** Util::getFormattedMaximumUploadSize($cfg['MaxUploadSize']): "(Max: 512MiB)" */
  maxUploadSize: string
  /** $cfg['UploadDir'] ('' when unset) */
  uploadDir: string
  /** Util::userDir(UploadDir) */
  userUploadDir: string
  /** Import::getLocalFiles: false when the directory cannot be read */
  localFiles: Array<{ name: string; selected: boolean }> | false
  /** Encoding::listEncodings (null: no recoding engine → MySQL charsets) */
  encodings: string[] | null
  charsets: string[]
  importCharset: string
  timeoutPassed: boolean
  offset: number | null
  localImportFile: string
  allowInterrupt: boolean
  skipQueries: number
  fkChecks: boolean
  plugins: PluginInfo[]
  selectedPlugin: string
  kanji: boolean
}

/** POST …/import/uploads/:id?offset=n carries the raw bytes of one chunk */
export const ImportUploadCreated = z.object({ id: z.string() })
export type ImportUploadCreated = z.infer<typeof ImportUploadCreated>

export const ImportRequest = z.object({
  params: FormPairs,
  /** the chunked upload holding `import_file` */
  upload: z.object({ id: z.string(), name: z.string() }).optional(),
})
export type ImportRequest = z.infer<typeof ImportRequest>

/** The outcome of an import (ImportController::__invoke). */
export const ImportResult = z.object({
  /** goSql: every statement went through the SQL tab path */
  statements: z.array(StatementResult).optional(),
  /** Current::$message (HTML, already sanitized) */
  message: z.object({ type: z.enum(['success', 'error', 'notice']), html: z.string() }).optional(),
  /** text a plugin echoed into the page */
  echoed: z.array(z.string()).optional(),
  /** the error card for a failed query (Generator::mysqlDie) with the back link */
  error: StatementResult.optional(),
  /** Generator::getBackUrlHtml target */
  back: z.boolean().optional(),
  reloadNavigation: z.boolean(),
  db: z.string(),
  table: z.string(),
})
export type ImportResult = z.infer<typeof ImportResult>

/** One SSE `progress` event of POST …/import */
export const ImportProgress = z.object({
  offset: z.number(),
  total: z.number(),
  executed: z.number(),
})
export type ImportProgress = z.infer<typeof ImportProgress>
