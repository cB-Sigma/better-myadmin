import { createFileRoute } from '@tanstack/react-router'
import { PluginsPage } from '../../../features/server/InfoPages'

/** pma: /server/plugins */
export const Route = createFileRoute('/s/$server/plugins')({
  component: function Page() {
    const { server } = Route.useParams()
    return <PluginsPage server={server} />
  },
})
