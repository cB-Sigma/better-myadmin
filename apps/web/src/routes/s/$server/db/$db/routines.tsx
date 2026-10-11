import { createFileRoute } from '@tanstack/react-router'
import { RoutinesPage } from '../../../../../features/database/RoutinesPage'

/** pma: /database/routines */
export const Route = createFileRoute('/s/$server/db/$db/routines')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <RoutinesPage key={db} server={server} db={db} />
  },
})
