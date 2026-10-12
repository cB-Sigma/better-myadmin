import { createFileRoute } from '@tanstack/react-router'
import { NormalizationPage } from '../../../../../../../features/table/normalization/NormalizationPage'

/** The normalization wizard (pma: /normalization) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/normalization')({
  component: function Normalization() {
    const { server, db, table } = Route.useParams()
    return <NormalizationPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
