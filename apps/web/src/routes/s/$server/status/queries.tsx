import { createFileRoute } from '@tanstack/react-router'
import { QueriesPage } from '../../../../features/server/StatusPages'

/** pma: /server/status/queries */
export const Route = createFileRoute('/s/$server/status/queries')({
  component: function Page() {
    const { server } = Route.useParams()
    return <QueriesPage server={server} />
  },
})
