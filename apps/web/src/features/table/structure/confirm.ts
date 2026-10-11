import { t } from '../../../lib/i18n'

/**
 * `window.confirm` with phpMyAdmin's strDoYouReally wording, for the Structure row actions that
 * confirm with the generated SQL.
 * pma: resources/js/modules/table/structure.ts (confirm with Messages.strDoYouReally)
 */
export function confirmSql(sql: string): boolean {
  return window.confirm(t('Do you really want to execute "%s"?', sql))
}
