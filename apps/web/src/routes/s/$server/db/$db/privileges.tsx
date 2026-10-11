import { createFileRoute } from '@tanstack/react-router'
import { DbPrivilegesPage } from '../../../../../features/database/DbPrivilegesPage'

/** pma: /database/privileges */
export const Route = createFileRoute('/s/$server/db/$db/privileges')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <DbPrivilegesPage key={db} server={server} db={db} />
  },
})
