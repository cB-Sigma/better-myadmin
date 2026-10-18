import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UsersPage } from '../../../../features/server/privileges/UsersPage'
import { qs } from '../../../../lib/search'

/** pma: /server/privileges (overview: `initial`, `showall`) */
export const Route = createFileRoute('/s/$server/privileges/')({
  validateSearch: z.object({
    initial: qs.str(),
    showall: qs.str(),
  }),
  component: function Users() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <UsersPage server={server} search={search} />
  },
})
