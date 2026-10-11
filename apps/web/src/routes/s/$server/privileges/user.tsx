import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { EditUserPage } from '../../../../features/server/privileges/EditUserPage'

const many = z.union([z.coerce.string(), z.array(z.coerce.string())])

/** pma: /server/privileges?username=&hostname=[&dbname=[&tablename=|&routinename=]] */
export const Route = createFileRoute('/s/$server/privileges/user')({
  validateSearch: z.object({
    username: z.coerce.string().catch(''),
    hostname: z.coerce.string().catch(''),
    dbname: many.optional(),
    tablename: z.coerce.string().optional(),
    routinename: z.coerce.string().optional(),
  }),
  component: function EditUser() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <EditUserPage key={JSON.stringify(search)} server={server} search={search} />
  },
})
