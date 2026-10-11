import { useParams } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { NavigationPanel } from '../navigation/NavigationPanel'
import { ShellLayout } from './layout/ShellLayout.tsx'

// the SQL console is a deferred chunk (docs/architecture/08-performance-and-snappiness.md)
const Console = lazy(() => import('../console/Console'))

/**
 * Server scope layout route component: the shell layout with the navigation panel (navigation
 * feature) in its `nav` slot and the SQL console (console feature) in its `console` slot.
 */
export function ServerShell() {
  const { server } = useParams({ from: '/s/$server' })
  return (
    <ShellLayout
      server={server}
      nav={<NavigationPanel server={server} />}
      console={
        <Suspense fallback={null}>
          <Console server={server} />
        </Suspense>
      }
    />
  )
}
