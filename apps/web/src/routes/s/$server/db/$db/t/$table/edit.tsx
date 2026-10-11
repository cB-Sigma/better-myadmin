import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { InsertEditPage } from '../../../../../../../features/insert-edit/InsertEditPage'

const list = z.union([z.coerce.string(), z.array(z.coerce.string())]).optional()
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
    action: z.enum(['insert', 'update']).optional(),
    unique: z.coerce.number().optional(),
    goto: z.string().optional(),
    sql_query: z.string().optional(),
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
        sqlQuery={s.sql_query}
      />
    )
  },
})
