import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UserGroupsPage } from '../../../features/server/privileges/UserGroupsPage'
import { qs } from '../../../lib/search'

/** pma: /server/user-groups (`addUserGroup`, `editUserGroup`/`viewUsers` with the group name) */
export const Route = createFileRoute('/s/$server/user-groups')({
  validateSearch: z.object({
    addUserGroup: qs.str(),
    editUserGroup: qs.str(),
    viewUsers: qs.str(),
  }),
  component: function UserGroups() {
    const { server } = Route.useParams()
    const search = Route.useSearch()
    return <UserGroupsPage key={JSON.stringify(search)} server={server} search={search} />
  },
})
