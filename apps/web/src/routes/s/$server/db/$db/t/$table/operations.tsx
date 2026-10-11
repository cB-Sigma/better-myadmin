import { createFileRoute } from '@tanstack/react-router'
import { OperationsPage } from '../../../../../../../features/table/operations/OperationsPage'

/** Table / view Operations tab (pma: /table/operations, /view/operations) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/operations')({
  component: function Operations() {
    const { server, db, table } = Route.useParams()
    return <OperationsPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
