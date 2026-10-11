import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StatusVariablesPage } from '../../../../features/server/StatusPages'

/** pma: /server/status/variables */
export const Route = createFileRoute('/s/$server/status/variables')({
  validateSearch: z.object({
    filterText: z.string().catch('').default(''),
    filterAlert: z.boolean().catch(false).default(false),
    filterCategory: z.string().catch('').default(''),
    dontFormat: z.boolean().catch(false).default(false),
  }),
  component: function StatusVariables() {
    const { server } = Route.useParams()
    return <StatusVariablesPage server={server} initial={Route.useSearch()} />
  },
})
