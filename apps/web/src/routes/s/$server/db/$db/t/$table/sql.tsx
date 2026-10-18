import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SqlPage } from '../../../../../../../features/sql/SqlPage'
import { qs } from '../../../../../../../lib/search'

/** Table SQL tab (pma: /table/sql). */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/sql')({
  validateSearch: z.object({ sql: qs.str(), sig: qs.str() }),
  component: function TableSql() {
    const { server, db, table } = Route.useParams()
    const { sql, sig } = Route.useSearch()
    return <SqlPage server={server} db={db} table={table} sql={sql} sig={sig} />
  },
})
