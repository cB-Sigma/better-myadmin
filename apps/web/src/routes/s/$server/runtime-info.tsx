import { createFileRoute } from '@tanstack/react-router'
import { RuntimeInfoPage } from '../../../features/shell/AboutPages'

/** Show runtime information (pma: /phpinfo, parity exception X15) */
export const Route = createFileRoute('/s/$server/runtime-info')({
  component: function Page() {
    const { server } = Route.useParams()
    return <RuntimeInfoPage server={server} />
  },
})
