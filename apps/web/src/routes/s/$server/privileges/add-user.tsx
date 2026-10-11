import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AddUserPage } from '../../../../features/server/privileges/AddUserPage'

/** pma: /server/privileges?adduser=1[&dbname=&tablename=] */
export const Route = createFileRoute('/s/$server/privileges/add-user')({
  validateSearch: z.object({
    dbname: z.coerce.string().optional(),
    tablename: z.coerce.string().optional(),
  }),
  component: function AddUser() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <AddUserPage key={JSON.stringify(search)} server={server} search={search} />
  },
})
