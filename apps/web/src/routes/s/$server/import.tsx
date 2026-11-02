import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from '../../../features/import/ImportPage'
import { importPairs, importSearch } from '../../../features/import/search'
import { AdminPage } from '../../../lib/mobileAdmin'

/** Server Import tab (pma: /server/import) */
export const Route = createFileRoute('/s/$server/import')({
  validateSearch: importSearch,
  component: function ServerImport() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return (
      <AdminPage>
        <ImportPage server={server} scope="server" request={importPairs(search)} />
      </AdminPage>
    )
  },
})
