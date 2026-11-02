import { createFileRoute } from '@tanstack/react-router'
import { StatusLayout } from '../../../../features/server/StatusPages'
import { AdminPage } from '../../../../lib/mobileAdmin'

/** pma: templates/server/status/base.twig */
export const Route = createFileRoute('/s/$server/status')({
  component: function Page() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <StatusLayout server={server} />
      </AdminPage>
    )
  },
})
