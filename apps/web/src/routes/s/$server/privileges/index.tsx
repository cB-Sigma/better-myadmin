import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UsersPage } from '../../../../features/server/privileges/UsersPage'

/** pma: /server/privileges (overview: `initial`, `showall`) */
export const Route = createFileRoute('/s/$server/privileges/')({
  validateSearch: z.object({
    initial: z.coerce.string().optional(),
    showall: z.coerce.string().optional(),
  }),
  component: function Users() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <UsersPage server={server} search={search} />
  },
})
