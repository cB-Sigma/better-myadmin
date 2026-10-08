/**
 * @bettermyadmin/metadata — the phpMyAdmin configuration storage (pmadb): discovery and feature
 * gating, ZeroConf auto-creation, and the repositories for bookmarks, query history,
 * recent/favorite tables, table UI preferences, user preferences, navigation hiding and the
 * relation / display-field / column-info readers. pmadb through the control connection, with a
 * SQLite fallback for the per-user tables.
 */
import userFormFields from '../resources/generated/user-form-fields.json' with { type: 'json' }

export * from './bookmarks.ts'
export * from './conn.ts'
export * from './driver.ts'
export * from './foreign-keys.ts'
export * from './history.ts'
export * from './metadata.ts'
export * from './php.ts'
export * from './pmadb-driver.ts'
export * from './recent-favorite.ts'
export * from './relation-parameters.ts'
export * from './relations.ts'
export * from './resources.ts'
export * from './sqlite-driver.ts'
export * from './storage.ts'
export * from './uiprefs.ts'
export * from './userprefs.ts'

/**
 * UserFormList::getFields() — the field paths of the user preference forms (group markers
 * included, as phpMyAdmin returns them), with or without the Developer tab.
 * pma: src/Config/Forms/User/UserFormList.php::getFields
 */
export function getUserFormFields(developerTab: boolean): readonly string[] {
  return developerTab ? userFormFields.developer : userFormFields.default
}
