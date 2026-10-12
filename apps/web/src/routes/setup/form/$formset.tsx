import { createFileRoute } from '@tanstack/react-router'
import { SetupFormPage } from '../../../features/setup/SetupForms'

/** pma: setup/index.php?route=/setup&page=form&formset=… (FormController) */
export const Route = createFileRoute('/setup/form/$formset')({
  component: function SetupForm() {
    const { formset } = Route.useParams()
    return <SetupFormPage key={formset} formset={formset} />
  },
})
