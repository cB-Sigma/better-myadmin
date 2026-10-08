import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../../../features/shell/HomePage'

export const Route = createFileRoute('/s/$server/')({ component: HomePage })
