import { LoaderCircle } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import { cn } from '../lib/cn.ts'
import {
  DISMISS_CLICK_MS,
  DISMISS_HINT,
  LOADING,
  type MessagePolicy,
  type MessageType,
  PROCESSING_REQUEST,
} from '../lib/messages.ts'
import { useUiSettings } from '../settings.tsx'

/** Only one AJAX notification exists at a time: every new one replaces the previous (same id). */
export const AJAX_ID = 'ajax_message'

/** The sonner host (`#loading_parent`), loaded with the first notification. */
export default function SonnerHost() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: 200 }}
      visibleToasts={1}
      toastOptions={{ unstyled: true, className: 'w-[350px]' }}
    />
  )
}

export function show(num: number, policy: MessagePolicy, body: ReactNode): void {
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
}

export function dismiss(): void {
  toast.dismiss(AJAX_ID)
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
  const { gettext } = useUiSettings()
  // Messages.strLoading / strProcessingRequest are msgids; other texts arrive translated
  const text =
    props.children === LOADING || props.children === PROCESSING_REQUEST
      ? gettext(props.children as string)
      : props.children
  const tone = {
    error: 'border-error/40 bg-error-bg text-error',
    warning: 'border-warning/40 bg-warning-bg text-warning',
    success: 'border-success/40 bg-success-bg text-success',
  } as const
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: phpMyAdmin's notification is mouse-dismissed; it is a role=status live region
    <span
      id={`ajax_message_num_${props.num}`}
      role="status"
      title={props.dismissable ? gettext(DISMISS_HINT) : undefined}
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
      <span className="min-w-0 flex-1 break-words">{text}</span>
    </span>
  )
}
