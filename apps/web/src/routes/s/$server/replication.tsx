import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ReplicationPage } from '../../../features/server/ReplicationPage'
import { qs } from '../../../lib/search'

/** pma: /server/replication */
export const Route = createFileRoute('/s/$server/replication')({
  validateSearch: z.object({
    view: qs.oneOfOr(['', 'primary_configure', 'replica_configure', 'primary_add_user'], ''),
    primary_connection: qs.strOr(''),
  }),
  component: function Replication() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <ReplicationPage
        server={server}
        search={search}
        onSearch={(s) => void navigate({ search: (p) => ({ ...p, ...s }) })}
      />
    )
  },
})
