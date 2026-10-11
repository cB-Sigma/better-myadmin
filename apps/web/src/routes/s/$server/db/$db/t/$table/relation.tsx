import { createFileRoute } from '@tanstack/react-router'
import { RelationPage } from '../../../../../../../features/table/relation/RelationPage'

/** Relation view (pma: /table/relation) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/relation')({
  component: function Relation() {
    const { server, db, table } = Route.useParams()
    return <RelationPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
