import { createFileRoute } from '@tanstack/react-router'
import { DbPrivilegesPage } from '../../../../../../../features/database/DbPrivilegesPage'

/** Table Privileges tab (pma: /table/privileges) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/privileges')({
  component: function Privileges() {
    const { server, db, table } = Route.useParams()
    return <DbPrivilegesPage key={`${db}.${table}`} server={server} db={db} table={table} />
  },
})
