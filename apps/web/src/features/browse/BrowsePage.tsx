import type { QueryResponse } from '@bettermyadmin/contracts'
import { MessageBox, useUiSettings } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { usePagePrefs } from '../preferences/PageSettings.tsx'
import { HighlightedSql } from '../sql/HighlightedSql'
import { StatementBlock } from '../sql/Results'
import type { CardEnv } from '../sql/SqlMessage'
import { DO_YOU_REALLY, checkSqlQuery, confirmationText } from '../sql/logic'
import { FlashMessages } from '../sql/page-card'
import { sqlTabRoute } from '../sql/routes'
import { runQuery } from '../sql/runner'
import { takeFlash } from '../table/structure/flash'

export interface BrowsePageProps {
  server: number
  db: string
  table: string
  /** sql_query + sql_signature of a signed link (FK links, Browse distinct values) */
  sql?: string | undefined
  sig?: string | undefined
  pos?: number | undefined
  /** is_browse_distinct (Structure → Distinct values) */
  distinct?: boolean | undefined
}

/**
 * The table Browse tab: /sql with db + table (default browse query) or a signed query.
 * pma: src/Controllers/Sql/SqlController.php
 */
export function BrowsePage(props: BrowsePageProps) {
  const { server, db, table } = props
  // pma: Sql\SqlController: PageSettings::init('Browse')
  usePagePrefs(server, 'Browse')
  const ui = useUiSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [other, setOther] = useState<QueryResponse | null>(null)
  // the message of the Insert/Edit save that came back here (ReplaceController → /sql)
  const [flash] = useState(() => takeFlash())
  const req = {
    db,
    table,
    // a query of the URL runs only with its signature: without one the server is sent an empty
    // signature, which fails, so it browses the table (phpMyAdmin ignores an unsigned GET sql_query)
    ...(props.sql !== undefined ? { sql: props.sql, sig: props.sig ?? '' } : {}),
    ...(props.pos !== undefined ? { pos: props.pos } : {}),
    ...(props.distinct === true ? { isBrowseDistinct: true } : {}),
  }
  const q = useQuery({
    queryKey: qk.browse({ server, db, table }, req),
    queryFn: () => api.browse(server, req),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })

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
        void navigate({ ...sqlTabRoute(server, a.db, a.table), search: { sql: a.sql } } as never)
        return
      }
      // Explain / Create PHP code / inline edit: the /import path, shown in place of the grid;
      // Profiling keeps its signature (/sql)
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

  if (q.error instanceof ApiError) return <MessageBox {...errorMessage(q.error)} flush />
  if (q.data === undefined) return <div className="text-sm text-fg-subtle">{t('Loading…')}</div>
  const res = other ?? q.data
  return (
    <div id="sqlqueryresultsouter" className="max-w-full">
      <FlashMessages messages={flash} scope={{ db, table }} env={env} />
      {res.statements.map((st, i) => (
        <StatementBlock
          key={`${i}-${st.sig}`}
          st={st}
          env={env}
          {...(other === null ? { usingBookmark: q.data.usingBookmark, previous: q.data.previous } : {})}
        />
      ))}
    </div>
  )
}
