import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { InsertEditPage } from '../../../../../../../features/insert-edit/InsertEditPage'
import { qs } from '../../../../../../../lib/search'

const list = qs.list()
const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/**
 * Edit / Copy rows by signed unique condition (pma: /table/change?where_clause=&where_clause_signature=,
 * /table/change/rows with default_action=update|insert). `where`/`sig` pairs; `action=insert`
 * copies; `unique=1` is clause_is_unique; `goto` is where "Go back to previous page" leads.
 */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/edit')({
  validateSearch: z.object({
    where: list,
    sig: list,
    action: qs.oneOf(['insert', 'update']),
    unique: qs.int(),
    goto: qs.str(),
    /** the Browse query (sql_query) and its signature (sql_signature) */
    sql: qs.str(),
    sql_sig: qs.str(),
  }),
  component: function Edit() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    const sigs = asList(s.sig)
    const where = asList(s.where).map((clause, i) => ({ clause, sig: sigs[i] ?? '' }))
    return (
      <InsertEditPage
        key={`${db}.${table}.${where.map((w) => w.clause).join('\u0000')}.${s.action ?? ''}`}
        server={Number(server)}
        db={db}
        table={table}
        where={where}
        copy={s.action === 'insert'}
        clauseIsUnique={s.unique === 1}
        goto={s.goto}
        sqlQuery={s.sql}
        sqlQuerySig={s.sql === undefined ? undefined : (s.sql_sig ?? '')}
      />
    )
  },
})
