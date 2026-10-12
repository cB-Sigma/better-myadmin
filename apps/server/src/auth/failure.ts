import { type Gettext, englishTranslator, sprintf } from '@bettermyadmin/i18n'
import { BmaError, isMysqlError } from '../http/errors.ts'

/** Failure kinds and texts (phpMyAdmin msgids, translated per request). pma: src/Exceptions/AuthenticationFailure.php */
export const AuthMessages = {
  serverDenied: 'Cannot log in to the database server.',
  allowDenied: 'Access denied!',
  rootDenied: 'Access denied!',
  emptyDenied: 'Login without a password is forbidden by configuration (see AllowNoPassword).',
  noActivity:
    'You have been automatically logged out due to inactivity of %s seconds. Once you log in again, you should be able to resume the work where you left off.',
  sessionExpired: 'Your session has expired. Please log in again.',
  passwordTooLong:
    'Your password is too long. To prevent denial-of-service attacks, phpMyAdmin restricts passwords to less than 2000 characters.',
  arbitraryNotAllowed: 'You are not allowed to log in to this MySQL server!',
  /** pma: src/Dbal/DbiMysqli.php::connect, %s = the directive (BBCode `[code][doc@…]…[/doc][/code]` there) */
  hiddenConnectionError:
    'Error 1045: Access denied for user. Additional error information may be available, but is being hidden by the %s configuration directive.',
} as const

const english = englishTranslator()

export class LoginFailure extends BmaError {
  readonly failureType: 'server-denied' | 'allow-denied' | 'root-denied' | 'empty-denied' | 'form'
  /** The connection error number of a server-denied failure (DatabaseInterface::getConnectionErrorNumber). */
  readonly errno: number | undefined
  constructor(failureType: LoginFailure['failureType'], message: string, errno?: number) {
    super('FORBIDDEN', message, 403)
    this.failureType = failureType
    this.errno = errno
  }
}

/** Core::sanitizeMySQLUser — cut at the first NUL byte. */
export function sanitizeMySQLUser(name: string): string {
  const i = name.indexOf('\0')
  return i === -1 ? name : name.slice(0, i)
}

/** Core::sanitizeMySQLHost — strip leading `p:` (persistent) prefixes. */
export function sanitizeMySQLHost(name: string): string {
  let n = name
  while (n.toLowerCase().startsWith('p:')) n = n.slice(2)
  return n
}

/** pma: src/Dbal/DbiMysqli.php::connect (ConnectionException message) */
export function connectionErrorMessage(
  e: unknown,
  hideConnectionErrors: boolean,
  tr: Gettext = english,
): string {
  if (isMysqlError(e)) {
    if (e.errno === 1045 && hideConnectionErrors) {
      return sprintf(
        tr.gettext(AuthMessages.hiddenConnectionError),
        "$cfg['Servers'][$i]['hide_connection_errors']",
      )
    }
    return `${e.errno}: ${e.sqlMessage ?? e.message}`
  }
  const err = e as { code?: string; message?: string }
  // Network errors have no MySQL errno; mysqli reports 2002 (socket/host) or 2003 (refused/unreachable).
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
    return `2003: ${err.message ?? ''}`
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ENOENT' || err.code === 'EAI_AGAIN') {
    return `2002: ${err.message ?? ''}`
  }
  return tr.gettext(AuthMessages.serverDenied)
}
