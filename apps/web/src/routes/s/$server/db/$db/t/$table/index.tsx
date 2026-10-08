import { createFileRoute } from '@tanstack/react-router'
import { NotImplemented } from '../../../../../../../features/shell/NotImplemented'

/** Table scope default tab (Browse); placeholder until the table scope lands. */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/')({
  component: function TableIndex() {
    const { db, table } = Route.useParams()
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold" data-testid="scope-table">
          Table: {db}.{table}
        </h2>
        <NotImplemented />
      </div>
    )
  },
})
