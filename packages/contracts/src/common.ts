import { z } from 'zod'

/** Error codes of the JSON error envelope (docs/architecture/04-backend-architecture.md#error-model). */
export const ErrorCode = z.enum([
  'MYSQL_ERROR',
  'VALIDATION',
  'AUTH_REQUIRED',
  'AUTH_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_SERVER',
  'FEATURE_DISABLED',
  'CSRF',
  'INTERNAL',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    errno: z.number().int().optional(),
    sqlstate: z.string().optional(),
    docUrl: z.string().optional(),
    sql: z.string().optional(),
    statementIndex: z.number().int().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

/**
 * A cell value as it travels over the wire. Never a JS number: numeric and temporal values are
 * the exact text the server sent (docs/architecture/06-data-and-metadata-model.md#numeric-and-value-fidelity).
 * Binary values (charset 63 strings/blobs, BIT, GEOMETRY) are base64 with their byte length.
 */
export const Cell = z.union([z.null(), z.string(), z.object({ b64: z.string(), bytes: z.number().int() })])
export type Cell = z.infer<typeof Cell>

export { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './constants.ts'
