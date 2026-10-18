import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowsePage } from '../../../../../../../features/browse/BrowsePage'
import { qs } from '../../../../../../../lib/search'

/** Table Browse tab (pma: /sql with db, table, pos=0; FK and sort links carry a signed sql). */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/browse')({
  validateSearch: z.object({
    sql: qs.str(),
    sig: qs.str(),
    pos: qs.int(0),
    /** is_browse_distinct=1 */
    distinct: qs.int(),
  }),
  component: function TableBrowse() {
    const { server, db, table } = Route.useParams()
    const { distinct, ...search } = Route.useSearch()
    return <BrowsePage server={server} db={db} table={table} {...search} distinct={distinct === 1} />
  },
})
