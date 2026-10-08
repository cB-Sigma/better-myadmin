import {
  type Context,
  type LintEditorType,
  type LintMessages,
  createServerContext,
  lintQuery,
} from '@bettermyadmin/sql-lexer'

/**
 * The SQL linter (phpMyAdmin's /lint) in a worker: same lexer, parser and messages, no round trip.
 * The parser context is the connected server's (Context::loadClosest + setMode), like the PHP request.
 */
export interface LintJob {
  id: number
  sql: string
  editorType?: LintEditorType | undefined
  server: { versionInt: number; isMariaDb: boolean; sqlMode: string }
  /** The linter's two msgids in the page language (the worker has no catalogue). */
  messages: LintMessages
}

const contexts = new Map<string, Context>()

self.onmessage = (e: MessageEvent<LintJob>) => {
  const { id, sql, editorType, server, messages } = e.data
  const key = `${server.versionInt}|${server.isMariaDb}|${server.sqlMode}`
  let context = contexts.get(key)
  if (context === undefined) {
    context = createServerContext(server.versionInt, server.isMariaDb, server.sqlMode)
    contexts.set(key, context)
  }
  const lints = lintQuery(sql, editorType ?? null, { context, messages })
  ;(self as unknown as { postMessage(message: unknown): void }).postMessage({ id, lints })
}
