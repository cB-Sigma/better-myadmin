import { createFileRoute } from '@tanstack/react-router'
import { SetupServerPage } from '../../../features/setup/SetupForms'

/** pma: setup/index.php?route=/setup&page=servers&mode=add|edit&id=… (ServersController; 0 adds) */
export const Route = createFileRoute('/setup/servers/$id')({
  component: function SetupServer() {
    const { id } = Route.useParams()
    const n = Number.parseInt(id, 10)
    return <SetupServerPage key={id} id={Number.isInteger(n) && n > 0 ? n : 0} />
  },
})
