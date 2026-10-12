import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ConfigPage } from '../../features/setup/ConfigPage'

/** pma: setup/index.php?route=/setup&page=config (ConfigController) */
export const Route = createFileRoute('/setup/config')({
  validateSearch: z.object({ eol: z.enum(['unix', 'win']).optional().catch(undefined) }),
  component: function SetupConfig() {
    const { eol } = Route.useSearch()
    return <ConfigPage eol={eol ?? 'unix'} />
  },
})
