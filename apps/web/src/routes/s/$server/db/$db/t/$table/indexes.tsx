import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { IndexPage } from '../../../../../../../features/table/indexes/IndexPage'
import { qs } from '../../../../../../../lib/search'

/** The index editor as a page (pma: /table/indexes, non-AJAX) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/indexes')({
  validateSearch: z.object({ index: qs.str(), create: qs.int() }),
  component: function Indexes() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    return (
      <IndexPage
        scope={{ server, db, table }}
        query={
          s.index !== undefined ? { index: s.index } : s.create !== undefined ? { create: s.create } : {}
        }
      />
    )
  },
})
