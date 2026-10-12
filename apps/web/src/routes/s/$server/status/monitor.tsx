import { createFileRoute } from '@tanstack/react-router'
import { MonitorPage } from '../../../../features/server/MonitorPage'

/** pma: /server/status/monitor */
export const Route = createFileRoute('/s/$server/status/monitor')({
  component: function Page() {
    const { server } = Route.useParams()
    return <MonitorPage server={server} />
  },
})
