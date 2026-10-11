import { createFileRoute } from '@tanstack/react-router'
import { EnginePage } from '../../../../../features/server/InfoPages'

/** pma: /server/engines/{engine}/{page} (InnoDB Bufferpool / Status) */
export const Route = createFileRoute('/s/$server/engines/$engine/$page')({
  component: function EngineInfoPage() {
    const { server, engine, page } = Route.useParams()
    return <EnginePage server={server} engine={engine} page={page} />
  },
})
