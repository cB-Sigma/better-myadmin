/**
 * Vitest setup (int and parity projects): a process-level guard so a lost DB socket cannot crash the
 * worker.
 *
 * The harness and the app under test open real MySQL connections. On a 2-core CI runner the server
 * can reset an idle one mid-run; mysql2 then surfaces a connection-level failure asynchronously — an
 * 'error' event with no listener, or a late unhandled rejection — with no catch site, so it escapes
 * the test body and crashes the whole vitest worker. Per-test `retry` cannot recover that, because
 * the worker process itself dies. These are never query results: `await conn.query(...)` still
 * rejects on a real SQL error. So swallow ONLY a narrow allowlist of lost-socket errors and rethrow
 * everything else, so genuine bugs still surface and fail the run.
 */

const LOST_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'])

const LOST_SOCKET_MESSAGES = [
  'This socket has been ended by the other party',
  'Connection lost',
  'read ECONNRESET',
  'socket hang up',
]

function isLostSocket(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && LOST_SOCKET_CODES.has(code)) return true
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && LOST_SOCKET_MESSAGES.some((m) => message.includes(m))
}

function label(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err)
  const e = err as { code?: string; message?: string }
  return e.code ?? e.message ?? String(err)
}

process.on('uncaughtException', (err) => {
  if (isLostSocket(err)) {
    console.warn(`[socket-guard] swallowed a lost DB socket (uncaughtException): ${label(err)}`)
    return
  }
  throw err
})

process.on('unhandledRejection', (reason) => {
  if (isLostSocket(reason)) {
    console.warn(`[socket-guard] swallowed a lost DB socket (unhandledRejection): ${label(reason)}`)
    return
  }
  throw reason
})
