import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CheckRelationsPage } from '../../../features/shell/CheckRelationsPage'
import { qs } from '../../../lib/search'

/** pma: /check-relations (the configuration storage check; `db` for the current-database offer) */
export const Route = createFileRoute('/s/$server/check-relations')({
  validateSearch: z.object({ db: qs.str() }),
  component: function CheckRelations() {
    const { server } = Route.useParams()
    const { db } = Route.useSearch()
    return <CheckRelationsPage server={server} db={db ?? ''} />
  },
})
