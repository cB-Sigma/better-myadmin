import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ManagePage } from '../../../../features/preferences/ManagePage'

/** pma: /preferences/manage */
export const Route = createFileRoute('/s/$server/preferences/manage')({
  validateSearch: z.object({ saved: z.coerce.number().optional().catch(undefined) }),
  component: function Manage() {
    const { server } = Route.useParams()
    const { saved } = Route.useSearch()
    return <ManagePage server={server} saved={saved !== undefined} />
  },
})
