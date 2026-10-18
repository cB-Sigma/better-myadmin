import { MessageBox, SafeHtml } from '@bettermyadmin/ui'
import { useLocation } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import { clearUserErrors, useUserErrors } from '../../../lib/user-errors.ts'

/**
 * `#pma_errors` under the page (base.twig): the user errors of the page's requests
 * (ErrorHandler::getDispErrors), an error or a notice box each. A new page empties it before its
 * own requests run, as ajax.ts removes `#pma_errors` on every page load.
 */
export function UserErrors() {
  const errors = useUserErrors()
  const { pathname } = useLocation()
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page clears the list
  useLayoutEffect(() => clearUserErrors(), [pathname])
  return (
    <div className="clearfloat px-3 print:hidden" id="pma_errors">
      {errors.map((e) => (
        <MessageBox
          key={`${e.level}:${e.html}`}
          type={e.level === 'error' ? 'error' : 'notice'}
          className={e.level === 'error' ? 'alert alert-danger' : 'alert alert-primary'}
        >
          <SafeHtml html={e.html} />
        </MessageBox>
      ))}
    </div>
  )
}
