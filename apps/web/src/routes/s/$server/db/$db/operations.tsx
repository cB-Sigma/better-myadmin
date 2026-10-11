import { createFileRoute } from '@tanstack/react-router'
import { OperationsPage } from '../../../../../features/database/OperationsPage'

/** pma: /database/operations */
export const Route = createFileRoute('/s/$server/db/$db/operations')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <OperationsPage key={db} server={server} db={db} />
  },
})
