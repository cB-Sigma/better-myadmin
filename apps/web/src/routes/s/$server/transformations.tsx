import { createFileRoute } from '@tanstack/react-router'
import { TransformationOverviewPage } from '../../../features/transformations/OverviewPage'

/** Available media types and transformations (pma: /transformation/overview) */
export const Route = createFileRoute('/s/$server/transformations')({ component: TransformationOverviewPage })
