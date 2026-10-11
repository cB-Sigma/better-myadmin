import type { ReactNode } from 'react'
import { mysqlDocUrl, pmaDocUrl } from '../lib/doc-urls.ts'
import { useUiSettings } from '../settings.tsx'
import { PmaIcon } from './icon.tsx'

/**
 * `show_docu(page, anchor)`: a `b_help` icon titled "Documentation" opening the phpMyAdmin
 * documentation in the `documentation` window.
 * pma: src/Html/MySQLDocumentation.php::showDocumentation, Generator::showDocumentationLink
 */
export function DocLink({
  page,
  anchor = '',
  disableTabIndex = false,
}: { page: string; anchor?: string; disableTabIndex?: boolean }) {
  const { gettext } = useUiSettings()
  const doc = gettext('Documentation')
  return (
    <a
      href={pmaDocUrl(page, anchor)}
      target="documentation"
      rel="noopener noreferrer"
      title={doc}
      {...(disableTabIndex ? { tabIndex: -1 } : {})}
    >
      <PmaIcon name="b_help" alt={doc} />
    </a>
  )
}

/**
 * `show_mysql_docu(link, bigIcon, url, text, anchor)`: MySQL reference manual link for the
 * connected server version, `target="mysql_doc"`.
 * pma: src/Html/MySQLDocumentation.php::show
 */
export function MySqlDocLink({
  link,
  anchor = '',
  url,
  bigIcon = false,
  children,
}: {
  link: string
  anchor?: string
  /** A ready URL (e.g. from the mariadb-mysql-kbs knowledge base, packages/kbs). */
  url?: string
  bigIcon?: boolean
  children?: ReactNode
}) {
  const { serverVersion, gettext } = useUiSettings()
  const href = url ?? mysqlDocUrl(link, anchor, serverVersion)
  const doc = gettext('Documentation')
  return (
    <a href={href} target="mysql_doc" rel="noopener noreferrer" title={doc}>
      {children ?? <PmaIcon name={bigIcon ? 'b_sqlhelp' : 'b_help'} alt={doc} />}
    </a>
  )
}

/**
 * `Generator::showHint(message)`: help icon with the message as tooltip; nothing extra when
 * `$cfg['ShowHint']` is false (the icon stays, as `#no_hint` only disables the tooltip JS).
 */
export function Hint({ message }: { message: string }) {
  const { ShowHint } = useUiSettings()
  return (
    <span className="pma_hint inline-flex" {...(ShowHint ? { title: message } : {})}>
      <PmaIcon name="b_help" alt="" />
      <span className="sr-only">{message}</span>
    </span>
  )
}
