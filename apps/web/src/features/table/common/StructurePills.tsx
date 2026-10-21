import { Link } from '@tanstack/react-router'
import type { TableRef } from '../../../lib/api'
import { t } from '../../../lib/i18n'

const enc = encodeURIComponent

/**
 * The secondary pills of the Structure tab: "Table structure" / "Relation view".
 * pma: resources/templates/table/page_with_secondary_tabs.twig
 */
export function StructurePills({ scope, active }: { scope: TableRef; active: 'structure' | 'relation' }) {
  const base = `/s/${scope.server}/db/${enc(scope.db)}/t/${enc(scope.table)}`
  const pill = (key: 'structure' | 'relation', label: string) => (
    <li>
      <Link
        id={key === 'structure' ? 'table_structure_id' : 'table_relation_id'}
        to={`${base}/${key}` as string}
        className={`rounded px-2 py-1 ${active === key ? 'bg-bg-subtle font-medium' : 'text-accent hover:underline'}`}
        {...(active === key ? { 'aria-current': 'page' as const } : {})}
      >
        {label}
      </Link>
    </li>
  )
  return (
    <ul className="bma-subnav mb-2 flex gap-2 text-sm print:hidden" data-testid="structure-pills">
      {pill('structure', t('Table structure'))}
      {pill('relation', t('Relation view'))}
    </ul>
  )
}
