import { createFileRoute } from '@tanstack/react-router'
import { CollationsPage } from '../../../features/server/InfoPages'
import { AdminPage } from '../../../lib/mobileAdmin'

/** pma: /server/collations */
export const Route = createFileRoute('/s/$server/collations')({
  component: function Page() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <CollationsPage server={server} />
      </AdminPage>
    )
  },
})
