/** Wire constants without any runtime dependency (the web app imports these without pulling zod). */

/** Name of the header carrying the double-submit CSRF token. */
export const CSRF_HEADER = 'X-BMA-Token'
export const CSRF_COOKIE = 'bma_token'
export const SESSION_COOKIE = 'bma_sid'

/** Connection user errors of a response (URI-encoded JSON `UserError[]`, common.ts). */
export const USER_ERRORS_HEADER = 'X-BMA-User-Errors'
