import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ProcessesPage } from '../../../../features/server/StatusPages'

/** pma: /server/status/processes */
export const Route = createFileRoute('/s/$server/status/processes')({
  validateSearch: z.object({
    showExecuting: z.boolean().catch(false).default(false),
    full: z.boolean().catch(false).default(false),
    order_by_field: z.string().catch('').default(''),
    sort_order: z.string().catch('').default(''),
  }),
  component: function Processes() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <ProcessesPage
        server={server}
        search={search}
        onSearch={(s) => void navigate({ search: (p) => ({ ...p, ...s }) })}
      />
    )
  },
})
