import { createFileRoute } from '@tanstack/react-router'
import { TriggersPage } from '../../../../../features/database/TriggersPage'

/** pma: /triggers */
export const Route = createFileRoute('/s/$server/db/$db/triggers')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <TriggersPage key={db} server={server} db={db} />
  },
})
