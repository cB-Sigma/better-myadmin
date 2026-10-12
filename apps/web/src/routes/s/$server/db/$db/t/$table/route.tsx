import { createFileRoute } from '@tanstack/react-router'
import { addRecentTable } from '../../../../../../../features/navigation/NavExtras.tsx'
import { TableScopeLayout } from '../../../../../../../features/shell/layout/ScopeLayouts.tsx'
import { tableScopeQuery } from '../../../../../../../features/shell/scope.ts'

/** Table scope layout: tab bar of Menu::getTableTabs above the table pages. */
export const Route = createFileRoute('/s/$server/db/$db/t/$table')({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(tableScopeQuery(params.server, params.db, params.table))
    // pma: Http\Middleware\RecentTableHandling — every request naming a table adds it to Recent
    addRecentTable(context.queryClient, params.server, { db: params.db, table: params.table })
  },
  component: TableScopeLayout,
})
