import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PageNotFound } from './features/shell/PageNotFound'
import { I18nProvider } from './lib/i18n'
import { parsePhpQuery, stringifyPhpQuery } from './lib/search'
import { routeTree } from './routeTree.gen'
import './styles/app.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
})

const router = createRouter({
  routeTree,
  // pma: query values read like $_GET (lib/search.ts)
  parseSearch: parsePhpQuery,
  stringifySearch: stringifyPhpQuery,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadDelay: 50,
  defaultPendingMs: 300,
  defaultPendingMinMs: 200,
  defaultNotFoundComponent: PageNotFound,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
)
