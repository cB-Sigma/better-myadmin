import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { IndexPage } from '../../../../../../../features/table/indexes/IndexPage'

/** The index editor as a page (pma: /table/indexes, non-AJAX) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/indexes')({
  validateSearch: z.object({ index: z.coerce.string().optional(), create: z.coerce.number().optional() }),
  component: function Indexes() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    return (
      <IndexPage
        scope={{ server, db, table }}
        query={s.index !== undefined ? { index: s.index } : { create: s.create ?? 1 }}
      />
    )
  },
})
