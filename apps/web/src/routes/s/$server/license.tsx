import { createFileRoute } from '@tanstack/react-router'
import { LicensePage } from '../../../features/shell/AboutPages'

/** License (pma: /license) */
export const Route = createFileRoute('/s/$server/license')({
  component: function Page() {
    const { server } = Route.useParams()
    return <LicensePage server={server} />
  },
})
