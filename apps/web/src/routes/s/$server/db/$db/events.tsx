import { createFileRoute } from '@tanstack/react-router'
import { EventsPage } from '../../../../../features/database/EventsPage'

/** pma: /database/events */
export const Route = createFileRoute('/s/$server/db/$db/events')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <EventsPage key={db} server={server} db={db} />
  },
})
