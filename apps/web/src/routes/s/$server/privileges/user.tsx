import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { EditUserPage } from '../../../../features/server/privileges/EditUserPage'
import { qs } from '../../../../lib/search'

/** pma: /server/privileges?username=&hostname=[&dbname=[&tablename=|&routinename=]] */
export const Route = createFileRoute('/s/$server/privileges/user')({
  validateSearch: z.object({
    username: qs.strOr(''),
    hostname: qs.strOr(''),
    dbname: qs.strOrList(),
    tablename: qs.str(),
    routinename: qs.str(),
  }),
  component: function EditUser() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <EditUserPage key={JSON.stringify(search)} server={server} search={search} />
  },
})
