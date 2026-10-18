import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ProcessesPage } from '../../../../features/server/StatusPages'
import { qs } from '../../../../lib/search'

/** pma: /server/status/processes */
export const Route = createFileRoute('/s/$server/status/processes')({
  validateSearch: z.object({
    showExecuting: qs.flag(),
    full: qs.flag(),
    order_by_field: qs.strOr(''),
    sort_order: qs.strOr(''),
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
