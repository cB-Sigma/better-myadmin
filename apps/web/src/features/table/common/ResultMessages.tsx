import type { SqlMessage } from '@bettermyadmin/contracts'
import { ApiError } from '../../../lib/api'
import { HighlightedSql } from '../../sql/HighlightedSql'
import { MessageBox } from '../../sql/SqlMessage'

/**
 * The messages of a table-level action: Generator::getMessage (message + the SQL that ran).
 */
export function ResultMessages({ messages }: { messages: readonly SqlMessage[] }) {
  return (
    <>
      {messages.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: message list
        <div key={i} className="result_query mb-3 overflow-hidden rounded-(--radius) border border-border">
          <MessageBox type={m.type} text={m.text} className="border-0" />
          {m.sql !== undefined && m.sql !== '' && <HighlightedSql sql={m.sql} className="px-3 py-2" />}
        </div>
      ))}
    </>
  )
}

/** An API error as a message (MySQL errors keep their SQL, `#errno - message`). */
export function errorMessage(e: unknown): SqlMessage {
  if (e instanceof ApiError) {
    const sql = e.envelope.sql
    const text =
      e.envelope.errno !== undefined ? `#${e.envelope.errno} - ${e.envelope.message}` : e.envelope.message
    return sql === undefined ? { type: 'error', text } : { type: 'error', text, sql }
  }
  return { type: 'error', text: String(e) }
}
