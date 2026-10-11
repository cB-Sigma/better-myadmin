import type { SqlMessage } from '@bettermyadmin/contracts'

/**
 * Messages carried to the next Structure page render (phpMyAdmin's FlashMessenger / the message
 * prepended above the re-rendered structure after a form submit).
 */
let pending: SqlMessage[] = []

export function setFlash(messages: SqlMessage[]): void {
  pending = messages
}

export function takeFlash(): SqlMessage[] {
  const m = pending
  pending = []
  return m
}
