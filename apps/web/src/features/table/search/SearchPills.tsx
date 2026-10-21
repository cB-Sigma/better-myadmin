import { PmaIcon } from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import type { TableRef } from '../../../lib/api'
import { t } from '../../../lib/i18n'

const enc = encodeURIComponent

/**
 * The pill bar of the Search tab.
 * pma: resources/templates/table/search/index.twig (nav-pills), zoom_search/index.twig, find_replace/index.twig
 */
export function SearchPills({
  scope,
  active,
}: { scope: TableRef; active: 'search' | 'zoom-search' | 'find-replace' }) {
  const base = `/s/${scope.server}/db/${enc(scope.db)}/t/${enc(scope.table)}`
  const pills = [
    ['search', 'b_search', t('Table search')],
    ['zoom-search', 'b_select', t('Zoom search')],
    ['find-replace', 'b_find_replace', t('Find and replace')],
  ] as const
  return (
    <ul className="bma-subnav m-2 flex gap-2 text-sm" data-testid="search-pills">
      {pills.map(([key, icon, label]) => (
        <li key={key}>
          <Link
            to={`${base}/${key}` as string}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 ${active === key ? 'bg-accent text-accent-fg' : 'text-accent hover:underline'}`}
            {...(active === key ? { 'aria-current': 'page' as const } : {})}
          >
            <PmaIcon name={icon} alt="" />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
