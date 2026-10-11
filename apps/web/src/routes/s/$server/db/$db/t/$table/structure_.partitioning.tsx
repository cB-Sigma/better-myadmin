import { createFileRoute } from '@tanstack/react-router'
import { PartitioningPage } from '../../../../../../../features/table/structure/ColumnPages'

/** Edit partitioning / Partition table (pma: /table/structure/partitioning) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/structure_/partitioning')({
  component: function Partitioning() {
    const { server, db, table } = Route.useParams()
    return <PartitioningPage scope={{ server, db, table }} />
  },
})
