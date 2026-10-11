import type { PrivMessage } from '@bettermyadmin/contracts'

/**
 * The message of the last privileges action, shown once by the page the SPA opens next
 * (phpMyAdmin renders it on the response page of the form POST: Generator::getMessage).
 */
export interface Flash {
  message: PrivMessage
  sql: string
}

let pending: Flash | null = null

export function setFlash(f: Flash): void {
  pending = f
}

/** The pending message, cleared. */
export function takeFlash(): Flash | null {
  const f = pending
  pending = null
  return f
}
