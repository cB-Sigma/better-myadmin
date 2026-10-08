import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { AuthGate } from '../features/shell/AuthGate'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <AuthGate>
      <Outlet />
    </AuthGate>
  ),
})
