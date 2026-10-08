import type { ErrorCode, ErrorEnvelope } from '@bettermyadmin/contracts'

/** Base class for every error that maps onto the JSON error envelope. */
export class BmaError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly extra: Omit<ErrorEnvelope['error'], 'code' | 'message'>

  constructor(code: ErrorCode, message: string, status: number, extra: BmaError['extra'] = {}) {
    super(message)
    this.code = code
    this.status = status
    this.extra = extra
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, ...this.extra } }
  }
}

export class AuthRequiredError extends BmaError {
  constructor(message = 'Authentication required.') {
    super('AUTH_REQUIRED', message, 401)
  }
}

export class AuthExpiredError extends BmaError {
  constructor(message: string) {
    super('AUTH_EXPIRED', message, 401)
  }
}

export class ForbiddenError extends BmaError {
  constructor(message: string) {
    super('FORBIDDEN', message, 403)
  }
}

export class NotFoundError extends BmaError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404)
  }
}

export class CsrfError extends BmaError {
  constructor() {
    // pma: src/Http/Middleware/TokenRequestParamChecking.php (AJAX branch)
    super('CSRF', 'Error: Token mismatch', 403)
  }
}

export class ValidationError extends BmaError {
  constructor(message: string, issues: Array<{ path: string; message: string }> = []) {
    super('VALIDATION', message, 400, { issues })
  }
}

export interface MysqlErrorLike {
  errno?: number
  sqlState?: string
  sqlMessage?: string
  message: string
  code?: string
}

export function isMysqlError(e: unknown): e is MysqlErrorLike {
  return typeof e === 'object' && e !== null && 'errno' in e && typeof (e as MysqlErrorLike).errno === 'number'
}

export class MysqlError extends BmaError {
  constructor(e: MysqlErrorLike, sql?: string, statementIndex?: number) {
    const extra: BmaError['extra'] = {}
    if (e.errno !== undefined) extra.errno = e.errno
    if (e.sqlState !== undefined) extra.sqlstate = e.sqlState
    if (sql !== undefined) extra.sql = sql
    if (statementIndex !== undefined) extra.statementIndex = statementIndex
    super('MYSQL_ERROR', e.sqlMessage ?? e.message, 400, extra)
  }
}
