import { SLOW_QUERY_SORTS } from '@bettermyadmin/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SlowQueriesPage } from '../../../../features/server/SlowQueriesPage'
import { qs } from '../../../../lib/search'

/** Status › Slow queries: BetterMyAdmin only, no phpMyAdmin route (parity exception X65) */
export const Route = createFileRoute('/s/$server/status/slow-queries')({
  validateSearch: z.object({
    source: z.enum(['digest', 'slowlog']).catch('digest'),
    db: qs.strOr(''),
    sort: z.enum(SLOW_QUERY_SORTS).catch('total'),
    order: z.enum(['asc', 'desc']).catch('desc'),
  }),
  component: function SlowQueries() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <SlowQueriesPage
        server={server}
        search={search}
        onSearch={(s) => void navigate({ search: (p) => ({ ...p, ...s }) })}
      />
    )
  },
})
