import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SqlPage } from '../../../features/sql/SqlPage'
import { qs } from '../../../lib/search'

/** Server SQL tab (pma: /server/sql). `sql` prefills (show_query), `sig` executes a signed query. */
export const Route = createFileRoute('/s/$server/sql')({
  validateSearch: z.object({ sql: qs.str(), sig: qs.str() }),
  component: function ServerSql() {
    const { server } = Route.useParams()
    const { sql, sig } = Route.useSearch()
    return <SqlPage server={server} db="" table="" sql={sql} sig={sig} />
  },
})
