import { createFileRoute } from '@tanstack/react-router'
import { TriggersPage } from '../../../../../../../features/database/TriggersPage'
import { AdminPage } from '../../../../../../../lib/mobileAdmin'

/** Table Triggers tab (pma: /triggers?db=…&table=…) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/triggers')({
  component: function TableTriggers() {
    const { server, db, table } = Route.useParams()
    return (
      <AdminPage>
        <TriggersPage key={`${db}.${table}`} server={server} db={db} table={table} />
      </AdminPage>
    )
  },
})
