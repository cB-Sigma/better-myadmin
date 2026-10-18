import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { EventsPage } from '../../../../../features/database/EventsPage'
import { qs } from '../../../../../lib/search'

/** pma: /events (and /events/export) */
export const Route = createFileRoute('/s/$server/db/$db/events')({
  // SpecialSchemaLinks of the Browse grid open an item's editor (edit_item=1&item_name=…)
  validateSearch: z.object({ edit_item: qs.str(), item_name: qs.str() }),
  component: function Page() {
    const { server, db } = Route.useParams()
    const q = Route.useSearch()
    const editItem =
      q.edit_item !== undefined && q.edit_item !== '' && q.item_name !== undefined
        ? { name: q.item_name, type: '' }
        : null
    return <EventsPage key={db} server={server} db={db} editItem={editItem} />
  },
})
