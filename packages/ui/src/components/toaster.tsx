import { type ComponentType, type ReactNode, Suspense, lazy, useEffect, useState } from 'react'
import { type MessageType, messagePolicy } from '../lib/messages.ts'

type Impl = typeof import('./toaster-impl.tsx')

let impl: Impl | null = null
let loading: Promise<Impl> | null = null
let mountHost: (() => void) | null = null
let wantHost = false
let counter = 0
let pending: (() => void) | null = null

/** sonner is loaded with the first notification, keeping it out of the initial bundle. */
function load(): Promise<Impl> {
  loading ??= import('./toaster-impl.tsx').then((m) => {
    impl = m
    return m
  })
  return loading
}

const Host = lazy(async () => {
  const m = await load()
  return { default: m.default as ComponentType }
})

/**
 * Mount once near the root (`#loading_parent`). It renders nothing until the first
 * notification is shown.
 */
export function Toaster() {
  const [on, setOn] = useState(wantHost)
  useEffect(() => {
    mountHost = () => setOn(true)
    if (wantHost) setOn(true)
    return () => {
      mountHost = null
    }
  }, [])
  if (!on) return null
  return (
    <Suspense fallback={null}>
      <HostReady />
    </Suspense>
  )
}

function HostReady() {
  useEffect(() => {
    // the host is mounted: flush the notification requested while sonner was loading
    const p = pending
    pending = null
    if (p !== null) queueMicrotask(p)
  }, [])
  return <Host />
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
  const run = () => {
    if (num === counter) impl?.show(num, policy, body)
  }
  if (impl !== null && pending === null && wantHost) {
    run()
  } else {
    pending = run
    wantHost = true
    mountHost?.()
    void load()
  }
  return {
    id: 'ajax_message',
    remove: () => {
      if (num !== counter) return
      if (pending === run) pending = null
      impl?.dismiss()
    },
  }
}

/** Removes whatever notification is showing. */
export function removeMessage(handle: MessageHandle | null | boolean | undefined): void {
  if (handle !== null && typeof handle === 'object') handle.remove()
}
