import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowsePage } from '../../../../../../../features/browse/BrowsePage'

/** Table Browse tab (pma: /sql with db, table, pos=0; FK and sort links carry a signed sql). */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/browse')({
  validateSearch: z.object({
    sql: z.string().optional(),
    sig: z.string().optional(),
    pos: z.coerce.number().int().min(0).optional(),
  }),
  component: function TableBrowse() {
    const { server, db, table } = Route.useParams()
    const search = Route.useSearch()
    return <BrowsePage server={server} db={db} table={table} {...search} />
  },
})
