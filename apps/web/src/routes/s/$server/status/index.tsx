import { createFileRoute } from '@tanstack/react-router'
import { StatusOverviewPage } from '../../../../features/server/StatusPages'

/** pma: /server/status */
export const Route = createFileRoute('/s/$server/status/')({
  component: function Page() {
    const { server } = Route.useParams()
    return <StatusOverviewPage server={server} />
  },
})
