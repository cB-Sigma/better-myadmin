import { createFileRoute } from '@tanstack/react-router'
import { ThemesPage } from '../../../features/shell/themes/ThemesPage.tsx'

/** pma: /themes (ThemesController) */
export const Route = createFileRoute('/s/$server/themes')({ component: ThemesPage })
