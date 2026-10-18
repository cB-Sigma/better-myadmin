import { checkLink } from '@bettermyadmin/i18n'

/**
 * The navigation logo's target (Navigation::getDisplay): `NavigationLogoLink` trimmed, `index.php`
 * when it is not a valid link; a link with a host is external (a new window with
 * NavigationLogoLinkWindow = new), anything else opens the home page.
 */
export function logoTarget(
  configured: string,
  window: 'main' | 'new',
):
  | { kind: 'none' }
  | { kind: 'home'; newWindow: boolean }
  | { kind: 'external'; href: string; newWindow: boolean } {
  if (configured === '') return { kind: 'none' }
  let link = configured.trim()
  if (!checkLink(link, true)) link = 'index.php'
  let host = ''
  try {
    host = new URL(link).host
  } catch {
    host = ''
  }
  const newWindow = window !== 'main'
  return host === '' ? { kind: 'home', newWindow } : { kind: 'external', href: link, newWindow }
}
