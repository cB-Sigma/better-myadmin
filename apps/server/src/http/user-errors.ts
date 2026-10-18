import { AsyncLocalStorage } from 'node:async_hooks'
import { type Gettext, sprintf } from '@bettermyadmin/i18n'
import { convertBBCode } from '@bettermyadmin/i18n/bbcode'
import { htmlspecialchars } from '@bettermyadmin/i18n/php'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.ts'

/**
 * The user errors of a request (ErrorHandler::addUserError / addNotice): messages phpMyAdmin shows
 * in `#pma_errors` under the page (base.twig, or the `errors` key of an AJAX answer). Code anywhere in
 * the request adds them with `addUserError`; the middleware sends them back in the
 * `X-BMA-User-Errors` header (a JSON list of `{ level, html }`), which the SPA shows the same way.
 * pma: src/Error/ErrorHandler.php::addUserError, ::getDispErrors, src/Error/Error.php::getDisplay
 */
export interface UserError {
  /** the msgid, translated when the answer is sent */
  msgid: string
  args?: Array<string | number>
  /** E_USER_WARNING (addUserError) or E_USER_NOTICE (addNotice) */
  level?: 'error' | 'notice'
}

export const USER_ERRORS_HEADER = 'X-BMA-User-Errors'

const storage = new AsyncLocalStorage<Map<string, UserError>>()

/** Adds a user error to the current request; the same message twice is shown once (Error::getHash). */
export function addUserError(e: UserError): void {
  storage.getStore()?.set(JSON.stringify([e.msgid, e.args ?? [], e.level ?? 'error']), e)
}

/** Error::getDisplay of a user error: the message escaped, then its BBCode converted. */
export function userErrorHtml(tr: Gettext, e: UserError): string {
  const text =
    e.args !== undefined && e.args.length > 0 ? sprintf(tr.gettext(e.msgid), ...e.args) : tr.gettext(e.msgid)
  return convertBBCode(tr, htmlspecialchars(text), true)
}

export function userErrors(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const queue = new Map<string, UserError>()
    await storage.run(queue, next)
    if (queue.size === 0) return
    const tr = c.get('tr')
    const list = [...queue.values()].map((e) => ({ level: e.level ?? 'error', html: userErrorHtml(tr, e) }))
    c.res.headers.set(USER_ERRORS_HEADER, encodeURIComponent(JSON.stringify(list)))
  }
}
