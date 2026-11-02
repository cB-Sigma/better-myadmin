import { createFileRoute } from '@tanstack/react-router'
import { PluginsPage } from '../../../features/server/InfoPages'
import { AdminPage } from '../../../lib/mobileAdmin'

/** pma: /server/plugins */
export const Route = createFileRoute('/s/$server/plugins')({
  component: function Page() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <PluginsPage server={server} />
      </AdminPage>
    )
  },
})
