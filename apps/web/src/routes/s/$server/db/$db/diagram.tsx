import { createFileRoute } from '@tanstack/react-router'
import { DiagramPage } from '../../../../../features/database/diagram/DiagramPage'
import { AdminPage } from '../../../../../lib/mobileAdmin'

/** pma: none — the BetterMyAdmin-only, read-only ER diagram (X63) next to /database/designer */
export const Route = createFileRoute('/s/$server/db/$db/diagram')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return (
      <AdminPage>
        <DiagramPage key={db} server={server} db={db} />
      </AdminPage>
    )
  },
})
