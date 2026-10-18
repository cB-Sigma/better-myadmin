import type { SqlMessage } from '@bettermyadmin/contracts'
import { MessageBox, MessageLine } from '@bettermyadmin/ui'
import { useParams } from '@tanstack/react-router'
import { HighlightedSql } from '../../sql/HighlightedSql'
import { PageMessages } from '../../sql/page-card'

export { errorMessage } from '../../../lib/api'

/**
 * The messages of a table-level action: Generator::getMessage, the message with the query card of
 * the SQL that ran (Edit inline / Edit / Create PHP code), as the SQL pages show it.
 */
export function ResultMessages({ messages }: { messages: readonly SqlMessage[] }) {
  const p = useParams({ strict: false }) as { server?: string; db?: string; table?: string }
  if (messages.length === 0) return null
  if (p.server !== undefined)
    return (
      <PageMessages
        server={Number(p.server)}
        messages={[...messages]}
        scope={{ db: p.db ?? '', table: p.table ?? '' }}
      />
    )
  return <PlainMessages messages={messages} />
}

/** Outside a server route (no query card environment): the message and its highlighted SQL. */
function PlainMessages({ messages }: { messages: readonly SqlMessage[] }) {
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
