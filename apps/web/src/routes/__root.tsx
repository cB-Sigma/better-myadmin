import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import { AuthGate } from '../features/shell/AuthGate'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: function Root() {
    // the setup script needs no login (public/setup/index.php)
    const setup = useRouterState({ select: (s) => /^\/setup(\/|$)/.test(s.location.pathname) })
    if (setup) return <Outlet />
    return (
      <AuthGate>
        <Outlet />
      </AuthGate>
    )
  },
})
