import { createFileRoute } from '@tanstack/react-router'
import { DbPrivilegesPage } from '../../../../../../../features/server/privileges/DbPrivilegesPage'
import { AdminPage } from '../../../../../../../lib/mobileAdmin'

/** pma: /table/privileges */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/privileges')({
  component: function TablePrivileges() {
    const { server, db, table } = Route.useParams()
    return (
      <AdminPage>
        <DbPrivilegesPage key={`${db}.${table}`} server={server} db={db} table={table} />
      </AdminPage>
    )
  },
})
