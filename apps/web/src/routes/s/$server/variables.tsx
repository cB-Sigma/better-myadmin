import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VariablesPage } from '../../../features/server/VariablesPage'

/** pma: /server/variables (`?filter=` comes from the advisor's variable links) */
export const Route = createFileRoute('/s/$server/variables')({
  validateSearch: z.object({ filter: z.string().catch('').default('') }),
  component: function Variables() {
    const { server } = Route.useParams()
    return <VariablesPage server={server} filter={Route.useSearch().filter} />
  },
})
