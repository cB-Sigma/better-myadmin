import type { QueryResponse, SqlMessage } from '@bettermyadmin/contracts'
import { MessageBox, useUiSettings } from '@bettermyadmin/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { useConfig } from '../../lib/config'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { HighlightedSql } from './HighlightedSql'
import { StatementBlock } from './Results'
import { type CardEnv, QueryCard } from './SqlMessage'
import { DO_YOU_REALLY, checkSqlQuery, confirmationText } from './logic'
import { messageCard } from './message-card'
import { sqlTabRoute } from './routes'
import { runQuery } from './runner'

/**
 * The CardEnv of a page that shows Generator::getMessage cards outside the SQL pages (binary log,
 * user accounts): Edit opens the SQL tab with the query; the other links run it through /sql and
 * its result replaces the page (AJAX.responseHandler), which `replacement` renders.
 */
export function usePageCardEnv(server: number): { env: CardEnv; replacement: ReactNode | null } {
  const ui = useUiSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [other, setOther] = useState<QueryResponse | null>(null)
  const env: CardEnv = {
    server,
    versionInt: ui.serverVersion,
    confirmQuery: (sql) => {
      const check = checkSqlQuery(sql, ui.Confirm)
      if (check === 'empty') return false
      return check !== 'confirm' || window.confirm(confirmationText(sql, t(DO_YOU_REALLY)))
    },
    codemirror: true,
    onAction: (a) => {
      if (a.type === 'edit') {
        void navigate({ ...sqlTabRoute(server, '', ''), search: { sql: a.sql } } as never)
        return
      }
      void runQuery(
        server,
        {
          sql: a.sql,
          db: a.db,
          table: a.table,
          fromQueryBox: false,
          grid: true,
          ...(a.showAsPhp !== undefined ? { showAsPhp: a.showAsPhp } : {}),
          ...(a.profiling !== undefined ? { profiling: a.profiling } : {}),
          // pma: a signed link (Refresh, Profiling) goes to /sql, the query as posted
          ...(a.sig !== undefined ? { sig: a.sig } : {}),
          ...(a.fkChecks !== undefined ? { fkChecks: a.fkChecks } : {}),
        },
        'page',
      ).then((r) => {
        setOther(r)
        if (r.reloadNavigation) void qc.invalidateQueries({ queryKey: qk.srv(server), refetchType: 'active' })
      })
    },
  }
  const replacement =
    other === null ? null : (
      <div id="sqlqueryresultsouter" className="max-w-full">
        {other.statements.map((st, i) => (
          <StatementBlock key={`${i}-${st.sig}`} st={st} env={env} />
        ))}
      </div>
    )
  return { env, replacement }
}

/**
 * A message a page action returned with its SQL, as Generator::getMessage renders it: the message
 * with the query card (the server's, else built from the client-visible directives), or the message
 * alone when no SQL is shown.
 */
export function ActionMessage({
  message,
  scope,
  env,
}: {
  message: SqlMessage
  scope: { db: string; table: string }
  env: CardEnv
}) {
  const cfg = useConfig()
  const m = message
  // errors keep their SQL under the message (no query card)
  const card = m.card ?? (m.sql !== undefined && m.type !== 'error' ? messageCard(m.sql, scope, cfg) : null)
  if (card !== null) return <QueryCard type={m.type} text={m.text} card={card} sig="" env={env} />
  return (
    <div className="mb-3 overflow-hidden rounded border border-border">
      <MessageBox type={m.type} text={m.text} className="border-0" />
      {m.sql !== undefined && m.sql !== '' && (
        <HighlightedSql sql={m.sql} className="bg-bg-inset px-3 py-2" />
      )}
    </div>
  )
}

/**
 * ActionMessage for pages without a CardEnv of their own: a link of a card that runs its query
 * shows the result in place of the messages.
 */
export function PageMessages({
  server,
  messages,
  scope,
}: {
  server: number
  messages: SqlMessage[]
  scope: { db: string; table: string }
}) {
  const { env, replacement } = usePageCardEnv(server)
  if (replacement !== null) return replacement
  return <FlashMessages messages={messages} scope={scope} env={env} />
}

/** Messages carried to the next page (Insert / Edit "Go back", structure actions). */
export function FlashMessages({
  messages,
  scope,
  env,
}: {
  messages: SqlMessage[]
  scope: { db: string; table: string }
  env: CardEnv
}) {
  return (
    <>
      {messages.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: messages are positional
        <ActionMessage key={i} message={m} scope={scope} env={env} />
      ))}
    </>
  )
}
