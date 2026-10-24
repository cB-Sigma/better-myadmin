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

export { CSRF_COOKIE, CSRF_HEADER, QUERY_HEADER, SESSION_COOKIE, USER_ERRORS_HEADER } from './constants.ts'

/**
 * ErrorHandler::addUserError raised while connecting (DatabaseInterface::postConnect / setCollation),
 * sent with the response in the USER_ERRORS_HEADER header (constants.ts) (URI-encoded JSON) and shown above the page.
 */
export type UserError =
  | { kind: 'timezone'; timeZone: string; server: number }
  | { kind: 'collation'; server: number }
  /** ExternalTransformationsPlugin's E_USER_DEPRECATED: the options field holds command-line options */
  | { kind: 'external-options' }
