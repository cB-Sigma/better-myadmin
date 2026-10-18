import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ManagePage } from '../../../../features/preferences/ManagePage'
import { qs } from '../../../../lib/search'

/** pma: /preferences/manage */
export const Route = createFileRoute('/s/$server/preferences/manage')({
  validateSearch: z.object({ saved: qs.int() }),
  component: function Manage() {
    const { server } = Route.useParams()
    const { saved } = Route.useSearch()
    return <ManagePage server={server} saved={saved !== undefined} />
  },
})
