import { LoaderCircle } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import { cn } from '../lib/cn.ts'
import { DISMISS_CLICK_MS, DISMISS_HINT, type MessageType, messagePolicy } from '../lib/messages.ts'

/** Only one AJAX notification exists at a time: every new one replaces the previous (same id). */
const AJAX_ID = 'ajax_message'
let counter = 0

/** Mount once near the root (`#loading_parent`). */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: 200 }}
      visibleToasts={1}
      toastOptions={{ unstyled: true, className: 'w-[350px]' }}
    />
  )
}

export interface MessageHandle {
  id: string
  /** ajaxRemoveMessage($box) */
  remove: () => void
}

/**
 * `ajaxShowMessage(message?, timeout?, type?)` with phpMyAdmin's exact rules: "Loading…" by
 * default; Loading/Processing are sticky and not dismissable; `timeout=false` is sticky but
 * dismissable; otherwise the notification fades after `timeout ?? 5000` ms. Returns `null` for an
 * empty message (phpMyAdmin returns `true` and shows nothing).
 * pma: resources/js/modules/ajax-message.ts
 */
export function showMessage(
  message: ReactNode | string | null = null,
  timeout: number | false | null = null,
  type: MessageType = null,
): MessageHandle | null {
  const text = typeof message === 'string' || message === null ? message : '\u0000node'
  const policy = messagePolicy(text, timeout, type)
  if (policy === null) return null
  const body = typeof message === 'string' || message === null ? policy.text : message
  const num = ++counter
  toast.custom(
    (id) => (
      <Notification
        num={num}
        type={policy.type}
        spinner={policy.spinner}
        dismissable={policy.dismissable}
        onDismiss={() => toast.dismiss(id)}
      >
        {body}
      </Notification>
    ),
    { id: AJAX_ID, duration: policy.duration ?? Number.POSITIVE_INFINITY, dismissible: false },
  )
  return {
    id: AJAX_ID,
    remove: () => {
      if (num === counter) toast.dismiss(AJAX_ID)
    },
  }
}

/** Removes whatever notification is showing. */
export function removeMessage(handle: MessageHandle | null | boolean | undefined): void {
  if (handle !== null && typeof handle === 'object') handle.remove()
}

function Notification(props: {
  num: number
  type: MessageType
  spinner: boolean
  dismissable: boolean
  onDismiss: () => void
  children: ReactNode
}) {
  const down = useRef(0)
  const tone = {
    error: 'border-error/40 bg-error-bg text-error',
    warning: 'border-warning/40 bg-warning-bg text-warning',
    success: 'border-success/40 bg-success-bg text-success',
  } as const
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape/the close button are not part of phpMyAdmin's notification; keyboard users get role=status
    <span
      id={`ajax_message_num_${props.num}`}
      role="status"
      title={props.dismissable ? DISMISS_HINT : undefined}
      className={cn(
        'ajax_notification flex w-[350px] items-center gap-2 rounded-(--radius) border px-3 py-2 text-[13px] shadow-md',
        props.type === null ? 'border-notification-border bg-notification-bg text-fg' : tone[props.type],
        props.dismissable && 'dismissable cursor-pointer',
      )}
      onMouseDown={() => {
        down.current = Date.now()
      }}
      onClick={() => {
        // a press-and-release under 250 ms dismisses (functions.ts dismissNotifications)
        if (props.dismissable && Date.now() - down.current < DISMISS_CLICK_MS) props.onDismiss()
      }}
    >
      {props.spinner && <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />}
      <span className="min-w-0 flex-1 break-words">{props.children}</span>
    </span>
  )
}
