import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { OverviewPage } from '../../features/setup/OverviewPage'

/** pma: setup/index.php?route=/setup (HomeController; `version_check`) */
export const Route = createFileRoute('/setup/')({
  validateSearch: z.object({ version_check: z.coerce.number().optional().catch(undefined) }),
  component: function SetupOverview() {
    const { version_check } = Route.useSearch()
    return <OverviewPage versionCheck={version_check !== undefined} />
  },
})
