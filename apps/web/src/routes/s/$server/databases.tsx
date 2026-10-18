import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DatabasesPage } from '../../../features/server/DatabasesPage'
import { qs } from '../../../lib/search'

/** pma: /server/databases */
export const Route = createFileRoute('/s/$server/databases')({
  validateSearch: z.object({
    statistics: qs.flag(),
    pos: qs.intOr(0, 0),
    sort_by: qs.strOr(''),
    sort_order: qs.strOr(''),
  }),
  component: function Databases() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <DatabasesPage
        server={server}
        search={search}
        onSearch={(s) => void navigate({ search: (p) => ({ ...p, ...s }) })}
      />
    )
  },
})
