/**
 * Option lists of the column definition form.
 *
 * pma: resources/templates/columns_definitions/column_attributes.twig,
 *      resources/templates/columns_definitions/table_fields_definitions.twig,
 *      src/Indexes/Index.php::getIndexTypes
 */

import {
  type ServerInfo,
  isUUIDSupported,
  isUUIDv4Supported,
  isUUIDv7Supported,
  isVirtualColumnsSupported,
  supportsStoredKeywordForVirtualColumns,
} from './server.ts'

/** Values of the default-type dropdown: NONE, USER_DEFINED, NULL, CURRENT_TIMESTAMP, UUID*, in order. */
export function getDefaultTypeOptions(server: ServerInfo): string[] {
  const out = ['NONE', 'USER_DEFINED', 'NULL', 'CURRENT_TIMESTAMP']
  if (isUUIDSupported(server)) out.push('UUID')
  if (isUUIDv4Supported(server)) out.push('UUID_v4')
  if (isUUIDv7Supported(server)) out.push('UUID_v7')
  return out
}

/**
 * Values of the virtuality dropdown ('' first), or null when the server does
 * not support generated columns (the column is not rendered).
 */
export function getVirtualityOptions(server: ServerInfo): string[] | null {
  if (!isVirtualColumnsSupported(server)) return null
  return ['', 'VIRTUAL', supportsStoredKeywordForVirtualColumns(server) ? 'STORED' : 'PERSISTENT']
}

/** pma: Index::getIndexTypes */
export const getIndexTypes = (): string[] => ['BTREE', 'HASH']

/** Index choices of the index editor / column form */
export const INDEX_CHOICES: readonly string[] = ['PRIMARY', 'INDEX', 'UNIQUE', 'SPATIAL', 'FULLTEXT']
