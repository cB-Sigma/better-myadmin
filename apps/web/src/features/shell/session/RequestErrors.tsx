import { sprintf } from '@bettermyadmin/i18n/php'
import { showMessage } from '@bettermyadmin/ui'
import { useEffect } from 'react'
import { REQUEST_FAILED_EVENT, type RequestFailure } from '../../../lib/api'
import { t } from '../../../lib/i18n'

/** Messages.strErrorConnection */
export const ERROR_CONNECTION =
  'It seems that the connection to server has been lost. Please check your network connectivity and server status.'

/**
 * The text of a failed request: "Error in processing request", then "Error code: %s" (when the
 * server answered), "Error text: %s (state)" and, the request having failed (jqXHR state
 * `rejected`), the connection hint.
 * pma: resources/js/modules/ajax.ts::getFatalErrorHandler
 */
export function requestFailureLines(f: RequestFailure): string[] {
  const lines = [t('Error in processing request')]
  if (f.status !== 0) lines.push(sprintf(t('Error code: %s'), String(f.status)))
  lines.push(sprintf(t('Error text: %s'), `${f.statusText} (rejected)`))
  lines.push(t(ERROR_CONNECTION))
  return lines
}

/**
 * `$(document).on('ajaxError', AJAX.getFatalErrorHandler())`: a request that failed without one of
 * our error envelopes (no answer, a proxy or server failure page) shows a sticky, dismissable
 * error notification; envelopes are the page's to show.
 */
export function RequestErrors() {
  useEffect(() => {
    const on = (e: Event) => {
      const lines = requestFailureLines((e as CustomEvent<RequestFailure>).detail)
      showMessage(
        <span>
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional lines
            <div key={i}>{l}</div>
          ))}
        </span>,
        false,
        'error',
      )
    }
    window.addEventListener(REQUEST_FAILED_EVENT, on)
    return () => window.removeEventListener(REQUEST_FAILED_EVENT, on)
  }, [])
  return null
}
