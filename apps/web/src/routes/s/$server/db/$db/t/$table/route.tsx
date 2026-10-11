import { createFileRoute } from '@tanstack/react-router'
import { TableScopeLayout } from '../../../../../../../features/shell/layout/ScopeLayouts.tsx'
import { tableScopeQuery } from '../../../../../../../features/shell/scope.ts'

/** Table scope layout: tab bar of Menu::getTableTabs above the table pages. */
export const Route = createFileRoute('/s/$server/db/$db/t/$table')({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(tableScopeQuery(params.server, params.db, params.table))
  },
  component: TableScopeLayout,
})
