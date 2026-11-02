import { createFileRoute } from '@tanstack/react-router'
import { OperationsPage } from '../../../../../features/database/OperationsPage'
import { AdminPage } from '../../../../../lib/mobileAdmin'

/** pma: /database/operations */
export const Route = createFileRoute('/s/$server/db/$db/operations')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return (
      <AdminPage>
        <OperationsPage key={db} server={server} db={db} />
      </AdminPage>
    )
  },
})
