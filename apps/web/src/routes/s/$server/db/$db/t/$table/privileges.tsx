import { createFileRoute } from '@tanstack/react-router'
import { TablePrivilegesPage } from '../../../../../../../features/server/privileges/TablePrivilegesPage'

/** pma: /table/privileges */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/privileges')({
  component: function TablePrivileges() {
    const { server, db, table } = Route.useParams()
    return <TablePrivilegesPage table={{ server, db, table }} />
  },
})
