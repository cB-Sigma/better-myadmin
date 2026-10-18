import type { UserError } from '@bettermyadmin/contracts'
import { MessageBox } from '@bettermyadmin/ui'
import { useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { USER_ERRORS_EVENT } from '../../../lib/api'
import { t, tProduct } from '../../../lib/i18n'
import { BBCode } from '../bbcode'

/** DatabaseInterface::postConnect's SessionTimeZone message */
export const TIMEZONE_ERROR =
  "Unable to use timezone \"%1$s\" for server %2$d. Please check your configuration setting for [em]$cfg['Servers'][%3$d]['SessionTimeZone'][/em]. phpMyAdmin is currently using the default time zone of the database server."
/** DatabaseInterface::setCollation */
export const COLLATION_ERROR = 'Failed to set configured collation connection!'

/** The text of one user error (Sanitize::convertBBCode applies to the time zone message). */
export function userErrorText(e: UserError): string {
  return e.kind === 'timezone' ? tProduct(TIMEZONE_ERROR, e.timeZone, e.server, e.server) : t(COLLATION_ERROR)
}

/**
 * ErrorHandler::dispUserErrors: the user errors of the connection set-up (DatabaseInterface::
 * postConnect, setCollation) above the page, as error alerts; a new page starts without them
 * until one of its requests reports them again (phpMyAdmin connects per request).
 * pma: src/Error/ErrorHandler.php::getDispUserErrors, resources/templates/error/get_display.twig
 */
export function UserErrors() {
  const [errors, setErrors] = useState<UserError[]>([])
  const pathname = useLocation({ select: (l) => l.pathname })
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleared when the page changes
  useEffect(() => setErrors([]), [pathname])
  useEffect(() => {
    const on = (e: Event) => {
      const incoming = (e as CustomEvent<UserError[]>).detail
      setErrors((prev) => {
        const seen = new Set(prev.map((x) => JSON.stringify(x)))
        const added = incoming.filter((x) => !seen.has(JSON.stringify(x)))
        return added.length === 0 ? prev : [...prev, ...added]
      })
    }
    window.addEventListener(USER_ERRORS_EVENT, on)
    return () => window.removeEventListener(USER_ERRORS_EVENT, on)
  }, [])
  if (errors.length === 0) return null
  return (
    <div id="pma_errors" className="px-3 pt-3">
      {errors.map((e) => (
        <MessageBox key={JSON.stringify(e)} type="error">
          <BBCode text={userErrorText(e)} />
        </MessageBox>
      ))}
    </div>
  )
}
