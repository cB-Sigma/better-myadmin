import { getAvailableMimeTypes } from '@bettermyadmin/mysql-types'
import { pgettext, t } from '../../lib/i18n'

/**
 * Available media types and transformations (the catalog is static, as phpMyAdmin scans its own
 * plugin directory).
 * pma: src/Controllers/Transformation/OverviewController.php, templates/transformation_overview.twig
 */
export function TransformationOverviewPage() {
  const types = getAvailableMimeTypes()
  const table = (head: string, rows: typeof types.transformation) => (
    <table className="w-auto border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-border">
          <th className="px-2 py-1 text-start">{head}</th>
          <th className="px-2 py-1 text-start">{pgettext('for media type transformation', 'Description')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.file} className="border-b border-border odd:bg-bg-subtle">
            <td className="px-2 py-1 align-middle whitespace-nowrap">
              {p.mimetype}: {p.label}
            </td>
            <td className="px-2 py-1 align-middle">{t(p.info)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <div className="space-y-3 p-2" data-testid="transformation-overview">
      <h2 className="text-lg">{t('Available media types')}</h2>
      <ul className="list-disc ps-6 text-[13px]">
        {types.mimetype.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <h2 className="text-lg" id="transformation">
        {t('Available browser display transformations')}
      </h2>
      {table(t('Browser display transformation'), types.transformation)}
      <h2 className="text-lg" id="input_transformation">
        {t('Available input transformations')}
      </h2>
      {table(t('Input transformation'), types.input_transformation)}
    </div>
  )
}
