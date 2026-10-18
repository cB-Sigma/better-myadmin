import { MessageBox } from '@bettermyadmin/ui'
import { useLocation } from '@tanstack/react-router'
import { Trans } from '../../lib/i18n'

/**
 * A URL no route answers: "Error 404! The page … was not found." as an error message.
 * pma: src/Routing/Routing.php::callControllerForRoute (Dispatcher::NOT_FOUND)
 */
export function PageNotFound() {
  const { pathname } = useLocation()
  return (
    <MessageBox type="error" className="m-3">
      <Trans id="Error 404! The page %s was not found." args={[<code key="route">{pathname}</code>]} />
    </MessageBox>
  )
}
