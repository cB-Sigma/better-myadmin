import { createFileRoute } from '@tanstack/react-router'
import { ExportPage } from '../../../features/export/ExportPage'
import { exportSearch, searchPairs } from '../../../features/export/search'

/** Server Export tab (pma: /server/export) */
export const Route = createFileRoute('/s/$server/export')({
  validateSearch: exportSearch,
  component: function ServerExport() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <ExportPage server={server} scope="server" request={searchPairs(search)} />
  },
})
