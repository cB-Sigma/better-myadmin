/**
 * Port of vendor/phpmyadmin/sql-parser/src/Components/*.php: the building blocks
 * of parsed statements. Each class keeps the PHP property names and `build()`.
 */
import { Context } from './Context.ts'
import type { Parser } from './Parser.ts'
import type { Token, TokenValue } from './Token.ts'
import { TokensList } from './TokensList.ts'
import { empty, str, strcaseeq, strtolower, trim } from './php.ts'

/** Anything with a PHP `build()`/`__toString()`. */
export interface Component {
  build(): string
  toString(): string
}

function implode(glue: string, list: readonly unknown[]): string {
  return list.map((x) => str(x)).join(glue)
}

/** `PartitionDefinitions::buildAll()` */
export function buildPartitionDefinitions(list: readonly PartitionDefinition[]): string {
  return '(\n' + implode(',\n', list) + '\n)'
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/Expression.php::Expression
export class Expression implements Component {
  /** PHP dynamic property used by `Expressions::parse()` with the `field` option (e.g. `file`). */
  [extra: string]: unknown
  database: string | null = null
  table: string | null = null
  column: string | null = null
  expr: string | null = ''
  alias: string | null = null
  function: string | null = null
  subquery: string | null = null

  constructor(
    database: string | null = null,
    table: string | null = null,
    column: string | null = null,
    alias: string | null = null,
  ) {
    if (column === null && alias === null) {
      this.expr = database
      this.alias = table
    } else {
      this.database = database
      this.table = table
      this.column = column
      this.alias = alias
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/Expression.php::build
  build(): string {
    let ret: string
    if (this.expr !== '' && this.expr !== null) {
      ret = this.expr
    } else {
      const fields: string[] = []
      if (this.database !== null && this.database !== '') fields.push(this.database)
      if (this.table !== null && this.table !== '') fields.push(this.table)
      if (this.column !== null && this.column !== '') fields.push(this.column)
      ret = Context.current.escapeAll(fields).join('.')
    }
    if (!empty(this.alias)) ret += ' AS ' + Context.current.escape(this.alias as string)
    return ret
  }

  toString(): string {
    return this.build()
  }
}

/** One entry of {@link OptionsArray.options} for options with a value (`var`, `var=`, `expr`, `expr=`). */
export interface OptionWithValue {
  name: TokenValue
  equals: boolean
  expr: string | Expression
  value: string | null
}

export type OptionEntry = TokenValue | OptionWithValue

function isOptionWithValue(o: OptionEntry): o is OptionWithValue {
  return typeof o === 'object'
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::OptionsArray
export class OptionsArray implements Component {
  /** PHP array keyed by option id; insertion order is the PHP array order. */
  options: Map<number, OptionEntry>

  constructor(options: Map<number, OptionEntry> = new Map()) {
    this.options = options
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::build
  build(): string {
    if (this.options.size === 0) return ''
    const options: string[] = []
    for (const option of this.options.values()) {
      if (!isOptionWithValue(option)) {
        options.push(str(option))
      } else {
        options.push(
          str(option.name) +
            (option.equals ? '=' : ' ') +
            (option.expr !== '' ? str(option.expr) : (option.value ?? '')),
        )
      }
    }
    return options.join(' ')
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::has
  has(key: string): boolean {
    for (const option of this.options.values()) {
      if (isOptionWithValue(option)) {
        if (strcaseeq(key, str(option.name))) return (option.value ?? '') !== ''
      } else if (strcaseeq(key, str(option))) {
        return true
      }
    }
    return false
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::get
  get(key: string, getExpr = false): string | Expression | TokenValue {
    for (const option of this.options.values()) {
      if (isOptionWithValue(option)) {
        if (strcaseeq(key, str(option.name))) return getExpr ? option.expr : (option.value ?? '')
      } else if (strcaseeq(key, str(option))) {
        return option
      }
    }
    return ''
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::remove
  remove(key: string): boolean {
    for (const [idx, option] of this.options) {
      if (isOptionWithValue(option)) {
        if (strcaseeq(key, str(option.name))) {
          this.options.delete(idx)
          return true
        }
      } else if (strcaseeq(key, str(option))) {
        this.options.delete(idx)
        return true
      }
    }
    return false
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Components/OptionsArray.php::merge
  merge(options: OptionsArray): void {
    // array_merge_recursive() renumbers integer keys.
    const merged = new Map<number, OptionEntry>()
    let i = 0
    for (const v of this.options.values()) merged.set(i++, v)
    for (const v of options.options.values()) merged.set(i++, v)
    this.options = merged
  }

  isEmpty(): boolean {
    return this.options.size === 0
  }

  clone(): OptionsArray {
    return new OptionsArray(new Map(this.options))
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/ArrayObj.php::ArrayObj
export class ArrayObj implements Component {
  raw: string[]
  values: string[]

  constructor(raw: string[] = [], values: string[] = []) {
    this.raw = raw
    this.values = values
  }

  build(): string {
    if (this.raw.length > 0) return '(' + this.raw.join(', ') + ')'
    return '(' + this.values.join(', ') + ')'
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/Condition.php::Condition
export class Condition implements Component {
  identifiers: TokenValue[] = []
  isOperator = false
  expr: string
  leftOperand = ''
  operator = ''
  rightOperand = ''

  constructor(expr: string | null = null) {
    this.expr = trim(expr ?? '')
  }

  build(): string {
    return this.expr
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/CaseExpression.php::CaseExpression
export class CaseExpression implements Component {
  value: Expression | null = null
  conditions: Condition[][] = []
  results: (Expression | null)[] = []
  compareValues: (Expression | null)[] = []
  elseResult: Expression | null = null
  alias: string | null = null
  expr = ''

  build(): string {
    let ret = 'CASE '
    if (this.value !== null) {
      // Syntax type 0
      ret += str(this.value) + ' '
      const valuesCount = this.compareValues.length
      const resultsCount = this.results.length
      for (let i = 0; i < valuesCount && i < resultsCount; ++i) {
        ret += 'WHEN ' + str(this.compareValues[i]) + ' '
        ret += 'THEN ' + str(this.results[i]) + ' '
      }
    } else {
      // Syntax type 1
      const valuesCount = this.conditions.length
      const resultsCount = this.results.length
      for (let i = 0; i < valuesCount && i < resultsCount; ++i) {
        ret += 'WHEN ' + implode(' ', this.conditions[i] ?? []) + ' '
        ret += 'THEN ' + str(this.results[i]) + ' '
      }
    }
    if (this.elseResult !== null) ret += 'ELSE ' + str(this.elseResult) + ' '
    ret += 'END'
    if (this.alias) ret += ' AS ' + Context.current.escape(this.alias)
    return ret
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/DataType.php::DataType
export class DataType implements Component {
  lowercase = false

  name: string | null
  parameters: string[]
  options: OptionsArray | null

  constructor(name: string | null = null, parameters: string[] = [], options: OptionsArray | null = null) {
    this.name = name
    this.parameters = parameters
    this.options = options
  }

  build(): string {
    const name = this.lowercase ? strtolower(this.name ?? '') : (this.name ?? '')
    let parameters = ''
    if (this.parameters.length > 0) parameters = '(' + this.parameters.join(',') + ')'
    return trim(name + parameters + ' ' + str(this.options))
  }

  toString(): string {
    return this.build()
  }
}

export interface KeyColumn {
  name?: TokenValue
  length?: TokenValue
  order?: string | null
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/Key.php::Key
export class Key implements Component {
  expr: string | null = null

  name: TokenValue | null
  columns: KeyColumn[]
  type: TokenValue | null
  options: OptionsArray | null

  constructor(
    name: TokenValue | null = null,
    columns: KeyColumn[] = [],
    type: TokenValue | null = null,
    options: OptionsArray | null = null,
  ) {
    this.name = name
    this.columns = columns
    this.type = type
    this.options = options
  }

  build(): string {
    let ret = str(this.type) + ' '
    if (!empty(this.name)) ret += Context.current.escape(str(this.name)) + ' '
    if (this.expr !== null) return ret + '(' + this.expr + ') ' + str(this.options)
    const columns: string[] = []
    for (const column of this.columns) {
      let tmp = ''
      if (column.name !== undefined) {
        // PHP: `Context::escape()` of a non-string (e.g. a number token) is a TypeError (strict_types).
        if (typeof column.name !== 'string')
          throw new TypeError('Context::escape(): Argument #1 ($str) must be of type string')
        tmp += Context.current.escape(column.name)
      }
      if (column.length !== undefined) tmp += '(' + str(column.length) + ')'
      if (column.order !== undefined && column.order !== null) tmp += ' ' + column.order
      columns.push(tmp)
    }
    ret += '(' + columns.join(',') + ') ' + str(this.options)
    return trim(ret)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/Reference.php::Reference
export class Reference implements Component {
  table: Expression | null
  columns: string[]
  options: OptionsArray | null

  constructor(table: Expression | null = null, columns: string[] = [], options: OptionsArray | null = null) {
    this.table = table
    this.columns = columns
    this.options = options
  }

  build(): string {
    return trim(
      str(this.table) + ' (' + Context.current.escapeAll(this.columns).join(', ') + ') ' + str(this.options),
    )
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/CreateDefinition.php::CreateDefinition
export class CreateDefinition implements Component {
  name: TokenValue | null = null
  isConstraint: boolean | null = null
  type: DataType | null = null
  key: Key | null = null
  references: Reference | null = null
  options: OptionsArray | null = null

  build(): string {
    let tmp = ''
    if (this.isConstraint) tmp += 'CONSTRAINT '
    if (this.name !== null && this.name !== '') tmp += Context.current.escape(str(this.name)) + ' '
    if (this.type !== null) {
      this.type.lowercase = true
      tmp += this.type.build() + ' '
    }
    if (this.key !== null) tmp += str(this.key) + ' '
    if (this.references !== null) tmp += 'REFERENCES ' + str(this.references) + ' '
    tmp += str(this.options)
    return trim(tmp)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/FunctionCall.php::FunctionCall
export class FunctionCall implements Component {
  parameters: ArrayObj | null = null

  name: string | null

  constructor(name: string | null = null, parameters: string[] | ArrayObj | null = null) {
    this.name = name
    if (Array.isArray(parameters)) this.parameters = new ArrayObj(parameters)
    else if (parameters instanceof ArrayObj) this.parameters = parameters
  }

  build(): string {
    return str(this.name) + str(this.parameters)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/OrderSortKeyword.php::OrderSortKeyword
export type OrderSortKeyword = 'ASC' | 'DESC'

// pma: vendor/phpmyadmin/sql-parser/src/Components/GroupKeyword.php::GroupKeyword
export class GroupKeyword implements Component {
  type: OrderSortKeyword | null = null

  expr: Expression | null

  constructor(expr: Expression | null = null) {
    this.expr = expr
  }

  build(): string {
    return trim(str(this.expr))
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/OrderKeyword.php::OrderKeyword
export class OrderKeyword implements Component {
  expr: Expression | null
  type: OrderSortKeyword

  constructor(expr: Expression | null = null, type: OrderSortKeyword = 'ASC') {
    this.expr = expr
    this.type = type
  }

  build(): string {
    return str(this.expr) + ' ' + this.type
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/IndexHint.php::IndexHint
export class IndexHint implements Component {
  type = ''
  indexOrKey = ''
  for: string | null = null
  indexes: Expression[] = []

  build(): string {
    let ret = this.type + ' ' + this.indexOrKey + ' '
    if (this.for !== null) ret += 'FOR ' + this.for + ' '
    return ret + implode(', ', this.indexes)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/IntoKeyword.php::IntoKeyword
export class IntoKeyword implements Component {
  type: string | null = null
  dest: TokenValue | Expression | null = null
  columns: string[] | null = null
  values: Expression[] | null = null
  fieldsOptions: OptionsArray | null = null
  fieldsKeyword: boolean | null = null
  linesOptions: OptionsArray | null = null

  build(): string {
    if (this.dest instanceof Expression) {
      const columns = !empty(this.columns) ? '(`' + (this.columns as string[]).join('`, `') + '`)' : ''
      return str(this.dest) + columns
    }
    if (this.values !== null) return implode(', ', this.values)
    let ret = 'OUTFILE "' + str(this.dest) + '"'
    const fieldsOptionsString = this.fieldsOptions?.build() ?? ''
    if (trim(fieldsOptionsString) !== '') {
      ret += this.fieldsKeyword ? ' FIELDS' : ' COLUMNS'
      ret += ' ' + fieldsOptionsString
    }
    const linesOptionsString = this.linesOptions?.build() ?? ''
    if (trim(linesOptionsString) !== '') ret += ' LINES ' + linesOptionsString
    return ret
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/JoinKeyword.php::JOINS
export const JOINS: Readonly<Record<string, string>> = {
  'CROSS JOIN': 'CROSS',
  'FULL JOIN': 'FULL',
  'FULL OUTER JOIN': 'FULL',
  'INNER JOIN': 'INNER',
  JOIN: 'JOIN',
  'LEFT JOIN': 'LEFT',
  'LEFT OUTER JOIN': 'LEFT',
  'RIGHT JOIN': 'RIGHT',
  'RIGHT OUTER JOIN': 'RIGHT',
  'NATURAL JOIN': 'NATURAL',
  'NATURAL LEFT JOIN': 'NATURAL LEFT',
  'NATURAL RIGHT JOIN': 'NATURAL RIGHT',
  'NATURAL LEFT OUTER JOIN': 'NATURAL LEFT OUTER',
  'NATURAL RIGHT OUTER JOIN': 'NATURAL RIGHT OUTER',
  STRAIGHT_JOIN: 'STRAIGHT',
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/JoinKeyword.php::JoinKeyword
export class JoinKeyword implements Component {
  type: string | null = null
  expr: Expression | null = null
  on: Condition[] | null = null
  using: ArrayObj | null = null
  indexHints: IndexHint[] = []

  build(): string {
    const key = Object.keys(JOINS).find((k) => JOINS[k] === this.type) ?? ''
    return (
      key +
      ' ' +
      str(this.expr) +
      (this.indexHints.length > 0 ? ' ' + implode(' ', this.indexHints) : '') +
      (!empty(this.on) ? ' ON ' + implode(' ', this.on as Condition[]) : '') +
      (this.using !== null ? ' USING ' + this.using.build() : '')
    )
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/Limit.php::Limit
export class Limit implements Component {
  rowCount: TokenValue
  offset: TokenValue

  constructor(rowCount: TokenValue = 0, offset: TokenValue = 0) {
    this.rowCount = rowCount
    this.offset = offset
  }

  build(): string {
    return str(this.offset) + ', ' + str(this.rowCount)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/LockExpression.php::LockExpression
export class LockExpression implements Component {
  table: Expression | null = null
  type: string | null = null

  build(): string {
    return str(this.table) + ' ' + str(this.type)
  }

  static buildAll(list: readonly LockExpression[]): string {
    return implode(', ', list)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/ParameterDefinition.php::ParameterDefinition
export class ParameterDefinition implements Component {
  name: TokenValue | null
  inOut: TokenValue | null
  type: DataType | null

  constructor(name: TokenValue | null = null, inOut: TokenValue | null = null, type: DataType | null = null) {
    this.name = name
    this.inOut = inOut
    this.type = type
  }

  build(): string {
    let tmp = ''
    if (!empty(this.inOut)) tmp += str(this.inOut) + ' '
    // PHP: `Context::escape(null)` is a TypeError (strict_types).
    if (this.name === null)
      throw new TypeError('Context::escape(): Argument #1 ($str) must be of type string, null given')
    return trim(tmp + Context.current.escape(str(this.name)) + ' ' + str(this.type))
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/PartitionDefinition.php::PartitionDefinition
export class PartitionDefinition implements Component {
  isSubpartition: boolean | null = null
  name: string | null = null
  type: TokenValue | null = null
  expr: Expression | TokenValue | null = null
  subpartitions: PartitionDefinition[] | null = null
  options: OptionsArray | null = null

  build(): string {
    if (this.isSubpartition) return trim('SUBPARTITION ' + str(this.name) + ' ' + str(this.options))
    const subpartitions = empty(this.subpartitions)
      ? ''
      : ' ' + buildPartitionDefinitions(this.subpartitions as PartitionDefinition[])
    return trim(
      'PARTITION ' +
        str(this.name) +
        (empty(this.type) ? '' : ' VALUES ' + str(this.type) + ' ' + str(this.expr) + ' ') +
        (this.options !== null && !empty(this.type) ? '' : ' ') +
        str(this.options) +
        subpartitions,
    )
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/RenameOperation.php::RenameOperation
export class RenameOperation implements Component {
  old: Expression | null = null
  new: Expression | null = null

  build(): string {
    return str(this.old) + ' TO ' + str(this.new)
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/SetOperation.php::SetOperation
export class SetOperation implements Component {
  column: string
  value: string

  constructor(column = '', value = '') {
    this.column = column
    this.value = value
  }

  build(): string {
    return this.column + ' = ' + this.value
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/WithKeyword.php::WithKeyword
export class WithKeyword implements Component {
  columns: ArrayObj[] = []
  statement: Parser | null = null

  name: TokenValue

  constructor(name: TokenValue) {
    this.name = name
  }

  build(): string {
    if (this.statement === null) throw new Error('No statement inside WITH')
    let s = str(this.name)
    if (this.columns.length > 0) s += implode(', ', this.columns)
    s += ' AS ('
    for (const statement of this.statement.statements) s += statement.build()
    s += ')'
    return s
  }

  toString(): string {
    return this.build()
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/AlterOperation.php::AlterOperation
export class AlterOperation implements Component {
  options: OptionsArray | null
  field: Expression | string | null
  partitions: PartitionDefinition[] | null
  unknown: Token[]

  constructor(
    options: OptionsArray | null = null,
    field: Expression | string | null = null,
    partitions: PartitionDefinition[] | null = null,
    unknown: Token[] = [],
  ) {
    this.options = options
    this.field = field
    this.partitions = partitions
    this.unknown = unknown
  }

  build(): string {
    const options = this.options as OptionsArray
    let afterFieldsOptions = new OptionsArray()
    if (options.has('RENAME') && options.has('COLUMN')) {
      afterFieldsOptions = options.clone()
      afterFieldsOptions.remove('RENAME')
      afterFieldsOptions.remove('COLUMN')
      options.remove('TO')
    }
    let ret = str(options) + ' '
    if (this.field !== null && this.field !== '') ret += str(this.field) + ' '
    ret += str(afterFieldsOptions) + TokensList.buildFromArray(this.unknown)
    if (this.partitions !== null) ret += buildPartitionDefinitions(this.partitions)
    return trim(ret)
  }

  toString(): string {
    return this.build()
  }
}
