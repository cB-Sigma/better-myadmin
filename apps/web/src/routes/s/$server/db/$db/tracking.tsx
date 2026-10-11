import { createFileRoute } from '@tanstack/react-router'
import { TrackingPage } from '../../../../../features/database/TrackingPage'

/** pma: /database/tracking */
export const Route = createFileRoute('/s/$server/db/$db/tracking')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <TrackingPage key={db} server={server} db={db} />
  },
})
