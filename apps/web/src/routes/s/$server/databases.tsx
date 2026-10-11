import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DatabasesPage } from '../../../features/server/DatabasesPage'

/** pma: /server/databases */
export const Route = createFileRoute('/s/$server/databases')({
  validateSearch: z.object({
    statistics: z.boolean().catch(false).default(false),
    pos: z.coerce.number().int().min(0).catch(0).default(0),
    sort_by: z.string().catch('').default(''),
    sort_order: z.string().catch('').default(''),
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
