import { t } from '../../../lib/i18n'

/**
 * phpMyAdmin's strDoYouReally question for the Structure row actions that confirm with the
 * generated SQL (asked in the confirm modal).
 * pma: resources/js/modules/table/structure.ts (confirm with Messages.strDoYouReally)
 */
export function sqlQuestion(sql: string): string {
  return t('Do you really want to execute "%s"?', sql)
}
