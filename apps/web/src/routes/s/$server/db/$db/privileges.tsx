import { createFileRoute } from '@tanstack/react-router'
import { DbPrivilegesPage } from '../../../../../features/server/privileges/DbPrivilegesPage'
import { AdminPage } from '../../../../../lib/mobileAdmin'

/** pma: /database/privileges */
export const Route = createFileRoute('/s/$server/db/$db/privileges')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return (
      <AdminPage>
        <DbPrivilegesPage key={db} server={server} db={db} />
      </AdminPage>
    )
  },
})
