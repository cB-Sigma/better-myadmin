import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AddUserPage } from '../../../../features/server/privileges/AddUserPage'
import { qs } from '../../../../lib/search'

/** pma: /server/privileges?adduser=1[&dbname=&tablename=] */
export const Route = createFileRoute('/s/$server/privileges/add-user')({
  validateSearch: z.object({
    dbname: qs.str(),
    tablename: qs.str(),
  }),
  component: function AddUser() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <AddUserPage key={JSON.stringify(search)} server={server} search={search} />
  },
})
