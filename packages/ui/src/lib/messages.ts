/**
 * The notification policy of phpMyAdmin's `ajaxShowMessage`, as pure data so it is unit-testable.
 * pma: resources/js/modules/ajax-message.ts
 */

export const LOADING = 'Loading…'
export const PROCESSING_REQUEST = 'Processing request'
export const DISMISS_HINT = 'Click to dismiss this notification'

export type MessageType = 'error' | 'warning' | 'success' | null

export interface MessagePolicy {
  /** The text shown; `null` message means "Loading…". */
  text: string
  /** Auto-dismiss delay in ms; `null` = sticky. */
  duration: number | null
  /** Clicking the notification removes it (with the "Click to dismiss" tooltip). */
  dismissable: boolean
  /** The spinning clock background is only kept for "Loading…". */
  spinner: boolean
  type: MessageType
}

/**
 * `ajaxShowMessage(message = null, timeout = null, type = null)`:
 * - an empty string shows nothing (returns null here);
 * - "Loading…" and "Processing request" are sticky and not dismissable;
 * - `timeout === false` is sticky but dismissable; otherwise it fades after `timeout ?? 5000` ms.
 */
export function messagePolicy(
  message: string | null = null,
  timeout: number | false | null = null,
  type: MessageType = null,
): MessagePolicy | null {
  if (message === '') return null
  const text = message ?? LOADING
  const special = text === LOADING || text === PROCESSING_REQUEST
  const selfClosing = !special && timeout !== false
  return {
    text,
    duration: selfClosing ? (timeout === null ? 5000 : timeout) : null,
    dismissable: !special,
    spinner: text === LOADING,
    type,
  }
}

/** A press-and-release shorter than this removes a dismissable notification (functions.ts dismissNotifications). */
export const DISMISS_CLICK_MS = 250
