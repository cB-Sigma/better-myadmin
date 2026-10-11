import { createFileRoute } from '@tanstack/react-router'
import { DatabaseScopeLayout } from '../../../../../features/shell/layout/ScopeLayouts.tsx'
import { databaseScopeQuery } from '../../../../../features/shell/scope.ts'

/** Database scope layout: tab bar of Menu::getDbTabs above the database pages. */
export const Route = createFileRoute('/s/$server/db/$db')({
  loader: ({ context, params }) => {
    // tabs render complete on scope entry (preloading policy); errors show in the layout
    void context.queryClient.prefetchQuery(databaseScopeQuery(params.server, params.db))
  },
  component: DatabaseScopeLayout,
})
