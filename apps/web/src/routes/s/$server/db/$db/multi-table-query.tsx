import { createFileRoute } from '@tanstack/react-router'
import { MultiTableQueryPage } from '../../../../../features/database/MultiTableQueryPage'

/** pma: /database/multi-table-query */
export const Route = createFileRoute('/s/$server/db/$db/multi-table-query')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <MultiTableQueryPage key={db} server={server} db={db} />
  },
})
