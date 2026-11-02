import { createFileRoute } from '@tanstack/react-router'
import { EnginesPage } from '../../../../features/server/InfoPages'
import { AdminPage } from '../../../../lib/mobileAdmin'

/** pma: /server/engines */
export const Route = createFileRoute('/s/$server/engines/')({
  component: function Page() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <EnginesPage server={server} />
      </AdminPage>
    )
  },
})
