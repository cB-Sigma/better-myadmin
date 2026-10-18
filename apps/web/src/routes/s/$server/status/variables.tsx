import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StatusVariablesPage } from '../../../../features/server/StatusPages'
import { qs } from '../../../../lib/search'

/** pma: /server/status/variables */
export const Route = createFileRoute('/s/$server/status/variables')({
  validateSearch: z.object({
    filterText: qs.strOr(''),
    filterAlert: qs.flag(),
    filterCategory: qs.strOr(''),
    dontFormat: qs.flag(),
  }),
  component: function StatusVariables() {
    const { server } = Route.useParams()
    return <StatusVariablesPage server={server} initial={Route.useSearch()} />
  },
})
