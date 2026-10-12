import { createFileRoute } from '@tanstack/react-router'
import { ChangelogPage } from '../../../features/shell/AboutPages'

/** List of changes (pma: /changelog) */
export const Route = createFileRoute('/s/$server/changelog')({
  component: function Page() {
    const { server } = Route.useParams()
    return <ChangelogPage server={server} />
  },
})
