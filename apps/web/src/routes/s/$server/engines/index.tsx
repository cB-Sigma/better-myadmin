import { createFileRoute } from '@tanstack/react-router'
import { EnginesPage } from '../../../../features/server/InfoPages'

/** pma: /server/engines */
export const Route = createFileRoute('/s/$server/engines/')({
  component: function Page() {
    const { server } = Route.useParams()
    return <EnginesPage server={server} />
  },
})
