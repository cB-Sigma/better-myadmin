import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VariablesPage } from '../../../features/server/VariablesPage'
import { AdminPage } from '../../../lib/mobileAdmin'
import { qs } from '../../../lib/search'

/** pma: /server/variables (`?filter=` comes from the advisor's variable links) */
export const Route = createFileRoute('/s/$server/variables')({
  validateSearch: z.object({ filter: qs.strOr('') }),
  component: function Variables() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <VariablesPage server={server} filter={Route.useSearch().filter} />
      </AdminPage>
    )
  },
})
