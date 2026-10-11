import { createFileRoute } from '@tanstack/react-router'
import { AdvisorPage } from '../../../../features/server/StatusPages'

/** pma: /server/status/advisor */
export const Route = createFileRoute('/s/$server/status/advisor')({
  component: function Page() {
    const { server } = Route.useParams()
    return <AdvisorPage server={server} />
  },
})
