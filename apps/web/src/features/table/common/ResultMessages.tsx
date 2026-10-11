import type { SqlMessage } from '@bettermyadmin/contracts'
import { MessageBox, MessageLine } from '@bettermyadmin/ui'
import { HighlightedSql } from '../../sql/HighlightedSql'

export { errorMessage } from '../../../lib/api'

/**
 * The messages of a table-level action: Generator::getMessage (message + the SQL that ran, with
 * the SQL highlighted and linked to the manual like phpMyAdmin's sql-highlight).
 */
export function ResultMessages({ messages }: { messages: readonly SqlMessage[] }) {
  return (
    <>
      {messages.map((m, i) =>
        m.sql !== undefined && m.sql !== '' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: message list
          <div key={i} className="result_query mb-3 overflow-hidden rounded-(--radius) border border-border">
            <MessageLine type={m.type} text={m.text} className="border-x-0 border-t-0" />
            <HighlightedSql sql={m.sql} className="px-3 py-2" />
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: message list
          <MessageBox key={i} type={m.type} text={m.text} />
        ),
      )}
    </>
  )
}
