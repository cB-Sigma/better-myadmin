import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SqlPage } from '../../../../../features/sql/SqlPage'

/** Database SQL tab (pma: /database/sql). */
export const Route = createFileRoute('/s/$server/db/$db/sql')({
  validateSearch: z.object({ sql: z.string().optional(), sig: z.string().optional() }),
  component: function DatabaseSql() {
    const { server, db } = Route.useParams()
    const { sql, sig } = Route.useSearch()
    return <SqlPage server={server} db={db} table="" sql={sql} sig={sig} />
  },
})
