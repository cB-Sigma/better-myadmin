/**
 * Option lists of the column definition form.
 *
 * pma: resources/templates/columns_definitions/column_attributes.twig,
 *      resources/templates/columns_definitions/table_fields_definitions.twig,
 *      src/Indexes/Index.php::getIndexTypes
 */

import * as php from './php.ts'
import {
  type ServerInfo,
  isUUIDSupported,
  isUUIDv4Supported,
  isUUIDv7Supported,
  isVirtualColumnsSupported,
  supportsStoredKeywordForVirtualColumns,
} from './server.ts'
import { getAttributes } from './types.ts'
import { convertBitDefaultValue, extractColumnSpec, getSupportedDatatypes } from './util.ts'

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

/** A column as DatabaseInterface::getColumns returns it (the change form's `fields_meta` entry). */
export interface ColumnMeta {
  Field: string
  Type: string
  Collation: string | null
  /** 'YES' | 'NO' */
  Null: string
  Key: string
  /** null: no default (Column::$default, 'NULL' already mapped to null) */
  Default: string | null
  Extra: string
  Comment: string
  /** Table::getColumnGenerationExpression for virtual columns */
  Expression?: string | null
}

/** What the change form shows (and posts when nothing is touched) for one column. */
export interface ColumnFormValues {
  name: string
  /** the selected option of the type dropdown */
  type: string
  length: string
  defaultType: string
  defaultValue: string
  /** '' when the column has no collation */
  collation: string
  attribute: string
  null: boolean
  autoIncrement: boolean
  comments: string
  virtuality: string
  expression: string
  moveTo: string
}

/** The `*_orig` hidden inputs (SaveController compares the posted values with them). */
export interface ColumnFormOrig {
  field: string
  type: string
  length: string
  defaultValue: string
  defaultType: string
  collation: string
  attribute: string
  null: string
  extra: string
  comments: string
  virtuality: string
  expression: string
}

/**
 * Default type and value of the form from a column's default.
 *
 * pma: src/Table/ColumnsDefinition.php::decorateColumnMetaDefault
 */
export function decorateColumnMetaDefault(
  defaultValue: string | null,
  isNull: boolean,
): { DefaultType: string; DefaultValue: string } {
  switch (defaultValue) {
    case null:
      return { DefaultType: isNull ? 'NULL' : 'NONE', DefaultValue: '' }
    case 'CURRENT_TIMESTAMP':
    case 'current_timestamp()':
      return { DefaultType: 'CURRENT_TIMESTAMP', DefaultValue: '' }
    case 'UUID':
    case 'uuid()':
      return { DefaultType: 'UUID', DefaultValue: '' }
    case 'UUID_v4':
    case 'uuid_v4()':
      return { DefaultType: 'UUID_v4', DefaultValue: '' }
    case 'UUID_v7':
    case 'uuid_v7()':
      return { DefaultType: 'UUID_v7', DefaultValue: '' }
    default:
      return { DefaultType: 'USER_DEFINED', DefaultValue: defaultValue }
  }
}

/**
 * The change-form row of an existing column: displayed values and `_orig` snapshot, as the
 * browser submits them (a `<select>` without a matching option submits its first option).
 *
 * pma: src/Table/ColumnsDefinition.php::displayForm (is_backup),
 *      resources/templates/columns_definitions/column_attributes.twig, column_attribute.twig
 */
export function columnFormRow(
  meta: ColumnMeta,
  server: ServerInfo,
): { values: ColumnFormValues; orig: ColumnFormOrig } {
  const decorated = decorateColumnMetaDefault(meta.Default, meta.Null === 'YES')
  const spec = extractColumnSpec(meta.Type)
  let defaultForOrig = meta.Default
  if (spec.type === 'bit') defaultForOrig = convertBitDefaultValue(meta.Default)
  // "longtext character set latin7" and "float unsigned" style types
  const type = php.rtrim(spec.type.replace(/[\s]character set[\s][\S]+/g, ''))
  const typeUpper = type.toUpperCase()
  const length = spec.spec_in_brackets

  let defaultValue = decorated.DefaultValue
  if (typeUpper === 'BIT') {
    defaultValue = php.truthy(decorated.DefaultValue) ? convertBitDefaultValue(decorated.DefaultValue) : ''
  } else if (typeUpper === 'BINARY' || typeUpper === 'VARBINARY') {
    defaultValue = php.bin2hex(decorated.DefaultValue)
  }

  // column_attribute.twig
  const extraLower = meta.Extra.toLowerCase()
  const attributeShown = extraLower.includes('on update current_timestamp')
    ? 'on update CURRENT_TIMESTAMP'
    : spec.attribute
  const attribute = getAttributes(server).find((a) => a.toUpperCase() === attributeShown.toUpperCase()) ?? ''

  const types = getSupportedDatatypes(server)
  const selectedType = types.includes(typeUpper) ? typeUpper : (types[0] ?? '')
  const virtualityOptions = getVirtualityOptions(server) ?? []
  const virtuality = virtualityOptions.find((k) => k !== '' && meta.Extra.slice(0, k.length) === k) ?? ''

  return {
    values: {
      name: meta.Field,
      type: selectedType,
      length,
      defaultType: getDefaultTypeOptions(server).includes(decorated.DefaultType)
        ? decorated.DefaultType
        : 'NONE',
      defaultValue,
      collation: meta.Collation ?? '',
      attribute,
      null: meta.Null !== '' && meta.Null !== 'NO' && meta.Null !== 'NOT NULL',
      autoIncrement: extraLower === 'auto_increment',
      comments: meta.Comment,
      virtuality,
      expression: meta.Expression ?? '',
      moveTo: '',
    },
    orig: {
      field: meta.Field,
      type: typeUpper,
      length,
      defaultValue: defaultForOrig ?? '',
      defaultType: decorated.DefaultType,
      collation: meta.Collation ?? '',
      attribute: php.trim(spec.attribute),
      null: meta.Null,
      extra: meta.Extra,
      comments: meta.Comment,
      virtuality: '',
      expression: meta.Expression ?? '',
    },
  }
}

/**
 * Options of the "Move column" select of a row: value, the column for "after %s", disabled state.
 *
 * pma: resources/templates/columns_definitions/column_attributes.twig (move column)
 */
export function moveColumnOptions(
  columnNames: readonly string[],
  field: string,
): Array<{ value: string; after: string | null; disabled: boolean }> {
  const found = columnNames.indexOf(field)
  const current = found < 0 ? 0 : found
  return [
    { value: '', after: null, disabled: false },
    { value: '-first', after: null, disabled: current === 0 },
    ...columnNames.map((name, i) => ({
      value: name,
      after: name,
      disabled: current === i || current === i + 1,
    })),
  ]
}
