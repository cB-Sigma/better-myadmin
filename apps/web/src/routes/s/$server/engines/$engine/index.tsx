import { createFileRoute } from '@tanstack/react-router'
import { EnginePage } from '../../../../../features/server/InfoPages'

/** pma: /server/engines/{engine} */
export const Route = createFileRoute('/s/$server/engines/$engine/')({
  component: function Engine() {
    const { server, engine } = Route.useParams()
    return <EnginePage server={server} engine={engine} page="" />
  },
})
