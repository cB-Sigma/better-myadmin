import type { Parser } from './Parser.ts'
import { type Token, TokenFlag, TokenType } from './Token.ts'
import type { TokensList } from './TokensList.ts'
/**
 * Port of vendor/phpmyadmin/sql-parser/src/Parsers/*.php: the clause/component
 * parsers. Every `parse()` keeps the PHP index juggling on `list.idx` exactly.
 */
import {
  AlterOperation,
  ArrayObj,
  CaseExpression,
  Condition,
  CreateDefinition,
  DataType,
  Expression,
  FunctionCall,
  GroupKeyword,
  IndexHint,
  IntoKeyword,
  JOINS,
  JoinKeyword,
  Key,
  type KeyColumn,
  Limit,
  LockExpression,
  type OptionEntry,
  type OptionWithValue,
  OptionsArray,
  OrderKeyword,
  type OrderSortKeyword,
  ParameterDefinition,
  PartitionDefinition,
  Reference,
  RenameOperation,
  SetOperation,
} from './components.ts'
import { empty, inArrayLoose, rtrim, str, strtoupper, trim } from './php.ts'
import {
  type ComponentParserName,
  type ParseOptions,
  STATEMENT_PARSERS,
  hasStatementParser,
} from './tables.ts'

/** Option kinds of `OptionsArrays::parse()` specs. */
export type OptionKind = 'var' | 'var=' | 'expr' | 'expr='
/** A single option specification: an id, or `[id, kind, expressionOptions?]`. */
export type OptionSpec = number | readonly [number, OptionKind] | readonly [number, OptionKind, ParseOptions]
/** Specification of the options accepted by `OptionsArrays::parse()`. */
export type OptionSpecs = Readonly<Record<string, OptionSpec | true>>

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/OptionsArrays.php::OptionsArrays
export const OptionsArrays = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/OptionsArrays.php::parse
  parse(parser: Parser, list: TokensList, options: OptionSpecs = {}): OptionsArray {
    const ret = new OptionsArray()
    // The ID that will be assigned to duplicate options.
    let lastAssignedId = Object.keys(options).length + 1
    // The option that was processed last time.
    let lastOption: OptionSpec | null = null
    // The index of the option that was processed last time.
    let lastOptionId = 0
    // Counts brackets.
    let brackets = 0
    // 0 -> option, 1 -> `=` (optional), 2 -> value
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Comment) continue
      if (token.type === TokenType.Whitespace && brackets === 0) continue

      if (lastOption === null) {
        const upper = strtoupper(token.token)
        const spec = Object.hasOwn(options, upper) ? options[upper] : undefined
        if (spec === undefined || spec === true) {
          // There is no option to be processed.
          break
        }

        lastOption = spec
        lastOptionId = Array.isArray(lastOption) ? (lastOption[0] as number) : (lastOption as number)
        state = 0

        // Checking for option conflicts.
        const existing = ret.options.get(lastOptionId)
        if (existing !== undefined) {
          parser.error(
            `This option conflicts with "${str(typeof existing === 'object' ? existing.name : existing)}".`,
            token,
          )
          lastOptionId = lastAssignedId++
        }
      }

      const lo = lastOption as OptionSpec
      if (state === 0) {
        if (!Array.isArray(lo)) {
          // This is a just keyword option without any value.
          ret.options.set(lastOptionId, token.value)
          lastOption = null
          state = 0
        } else if (lo[1] === 'var' || lo[1] === 'var=') {
          // This is a keyword that is followed by a value.
          ret.options.set(lastOptionId, { name: token.value, equals: lo[1] === 'var=', expr: '', value: '' })
          state = 1
        } else if (lo[1] === 'expr' || lo[1] === 'expr=') {
          // This is a keyword that is followed by an expression.
          ++list.idx
          ret.options.set(lastOptionId, {
            name: token.value,
            equals: lo[1] === 'expr=',
            expr: '',
            value: null,
          })
          state = 1
        }
      } else if (state === 1) {
        state = 2
        if (token.token === '=') {
          ;(ret.options.get(lastOptionId) as OptionWithValue).equals = true
          continue
        }
      }

      // This is outside the `elseif` group above because the change might
      // change this iteration.
      if (state !== 2) continue

      const tuple = lastOption as readonly [number, OptionKind, ParseOptions?]
      const opt = ret.options.get(lastOptionId) as OptionWithValue
      if (tuple[1] === 'expr' || tuple[1] === 'expr=') {
        const expression = Expressions.parse(parser, list, empty(tuple[2]) ? {} : (tuple[2] as ParseOptions))
        opt.expr = ''
        if (expression !== null) {
          opt.value = expression.expr
          opt.expr = expression
        }
        lastOption = null
        state = 0
      } else {
        if (token.token === '(') {
          ++brackets
        } else if (token.token === ')') {
          --brackets
        }

        opt.expr = str(opt.expr) + token.token

        if (!((token.token === '(' && brackets === 1) || (token.token === ')' && brackets === 0))) {
          // First pair of brackets is being skipped.
          opt.value = str(opt.value) + str(token.value)
        }

        // Checking if we finished parsing.
        if (brackets === 0) lastOption = null
      }
    }

    // We are trying to parse an option that has a value, but the value is missing.
    if (
      state === 1 &&
      lastOption !== null &&
      Array.isArray(lastOption) &&
      (lastOption[1] === 'expr' ||
        lastOption[1] === 'var' ||
        lastOption[1] === 'var=' ||
        lastOption[1] === 'expr=')
    ) {
      parser.error(
        `Value/Expression for the option ${str((ret.options.get(lastOptionId) as OptionWithValue).name)} was expected.`,
        list.at(list.idx - 1),
      )
    }

    if (empty(options._UNSORTED)) {
      ret.options = new Map([...ret.options.entries()].sort((a, b) => a[0] - b[0]))
    }

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

const EXPRESSION_ALLOWED_KEYWORDS = [
  'AND',
  'AS',
  'BETWEEN',
  'CASE',
  'DUAL',
  'DIV',
  'IS',
  'MOD',
  'NOT',
  'NOT NULL',
  'NULL',
  'OR',
  'OVER',
  'REGEXP',
  'RLIKE',
  'XOR',
]

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/Expressions.php::Expressions
export const Expressions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/Expressions.php::parse
  parse(parser: Parser, list: TokensList, opts: ParseOptions = {}): Expression | null {
    const options: ParseOptions = { ...opts }
    const ret = new Expression()
    const fields = ret as unknown as Record<string, unknown>

    // Whether current tokens make an expression or a table reference.
    let isExpr = false
    // Whether a period was previously found.
    let dot = false
    // Whether an alias is expected.
    let alias = false
    // Counts brackets.
    let brackets = 0
    // Keeps track of the last two previous tokens.
    const prev: [Token | null, Token | null] = [null, null]

    // When a field is parsed, no parentheses are expected.
    if (!empty(options.parseField)) {
      options.breakOnParentheses = true
      options.field = options.parseField as string
    }

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) {
        // White-spaces might be added only to the expression part, not to alias.
        if (isExpr && token.token !== '*/') ret.expr = str(ret.expr) + token.token
        continue
      }

      if (token.type === TokenType.Keyword) {
        if (brackets > 0 && empty(ret.subquery) && hasStatementParser(token.keyword)) {
          // A `(` was previously found and this keyword is the beginning of a statement, so this is a subquery.
          ret.subquery = token.keyword
        } else if (token.flags & TokenFlag.KEYWORD_FUNCTION && empty(options.parseField) && !alias) {
          isExpr = true
        } else if (token.flags & TokenFlag.KEYWORD_RESERVED && brackets === 0) {
          if (!EXPRESSION_ALLOWED_KEYWORDS.includes(token.keyword as string)) {
            // A reserved keyword that is not allowed in the expression was found so the
            // expression must have ended and a new clause is starting.
            break
          }

          if (token.keyword === 'AS') {
            if (!empty(options.breakOnAlias)) break
            if (alias) {
              parser.error('An alias was expected.', token)
              break
            }
            alias = true
            continue
          }

          if (token.keyword === 'CASE') {
            // For a use of CASE like 'SELECT a = CASE .... END, b=1, `id`, ... FROM ...'
            const tempCaseExpr = CaseExpressions.parse(parser, list)
            ret.expr = str(ret.expr) + tempCaseExpr.build()
            isExpr = true
            continue
          }

          isExpr = true
        } else if (
          brackets === 0 &&
          str(ret.expr).length > 0 &&
          !alias &&
          (ret.table === null || ret.table === '')
        ) {
          // An unreserved keyword right after a complete expression (no table part yet) ends the expression.
          break
        }
      }

      if (
        token.type === TokenType.Number ||
        token.type === TokenType.Bool ||
        (token.type === TokenType.Symbol && token.flags & TokenFlag.SYMBOL_VARIABLE) ||
        (token.type === TokenType.Symbol && token.flags & TokenFlag.SYMBOL_PARAMETER) ||
        (token.type === TokenType.Operator && token.value !== '.')
      ) {
        if (!empty(options.parseField)) break
        // Numbers, booleans and operators (except dot) are usually part of expressions.
        isExpr = true
      }

      if (token.type === TokenType.Operator) {
        if (!empty(options.breakOnParentheses) && (token.value === '(' || token.value === ')')) {
          // No brackets were expected.
          break
        }

        if (token.value === '(') {
          ++brackets
          if (
            empty(ret.function) &&
            prev[1] !== null &&
            (prev[1].type === TokenType.None ||
              prev[1].type === TokenType.Symbol ||
              (prev[1].type === TokenType.Keyword && prev[1].flags & TokenFlag.KEYWORD_FUNCTION))
          ) {
            ret.function = prev[1].value as string
          }
        } else if (token.value === ')') {
          if (brackets === 0) {
            // Not our bracket
            break
          }

          --brackets
          if (brackets === 0) {
            if (!empty(options.parenthesesDelimited)) {
              // The current token is the last bracket, the next one will be outside the expression.
              ret.expr = str(ret.expr) + token.token
              ++list.idx
              break
            }
          } else if (brackets < 0) {
            // parser.error('Unexpected closing bracket.', token)
            break
          }
        } else if (token.value === ',') {
          // Expressions are comma-delimited.
          if (brackets === 0) break
        }
      }

      // Saving the previous tokens.
      prev[0] = prev[1]
      prev[1] = token

      if (alias) {
        // An alias is expected (the keyword `AS` was previously found).
        if (!empty(ret.alias)) {
          parser.error('An alias was previously found.', token)
          break
        }
        ret.alias = token.value as string
        alias = false
      } else if (isExpr) {
        // Handling aliases.
        const p0 = prev[0]
        const p1 = prev[1]
        if (
          brackets === 0 &&
          (p0 === null ||
            ((p0.type !== TokenType.Operator || p0.token === ')') &&
              (p0.type !== TokenType.Keyword || !(p0.flags & TokenFlag.KEYWORD_RESERVED)))) &&
          (p1.type === TokenType.String ||
            (p1.type === TokenType.Symbol &&
              !(p1.flags & TokenFlag.SYMBOL_VARIABLE) &&
              !(p1.flags & TokenFlag.SYMBOL_PARAMETER)) ||
            (p1.type === TokenType.None && strtoupper(p1.token) !== 'OVER'))
        ) {
          if (!empty(ret.alias)) {
            parser.error('An alias was previously found.', token)
            break
          }
          ret.alias = p1.value as string
        } else {
          const currIdx = list.idx
          --list.idx
          const beforeToken = list.getPrevious()
          list.idx = currIdx

          if (
            ret.expr !== null &&
            beforeToken !== null &&
            (beforeToken.type === TokenType.None ||
              beforeToken.type === TokenType.Symbol ||
              beforeToken.type === TokenType.String) &&
            token.type === TokenType.Keyword
          ) {
            ret.expr = rtrim(ret.expr, ' ') + ' '
          }

          ret.expr = str(ret.expr) + token.token
        }
      } else {
        if (token.type === TokenType.Operator && token.value === '.') {
          // Found a `.` which means we expect a column name and
          // the column name we parsed is actually the table name
          // and the table name is actually a database name.
          if (!empty(ret.database) || dot) parser.error('Unexpected dot.', token)
          ret.database = ret.table
          ret.table = ret.column
          ret.column = null
          dot = true
          ret.expr = str(ret.expr) + token.token
        } else {
          const field = empty(options.field) ? 'column' : (options.field as string)
          if (empty(fields[field])) {
            fields[field] = token.value
            ret.expr = str(ret.expr) + token.token
            dot = false
          } else {
            // No alias is expected.
            if (!empty(options.breakOnAlias)) break
            if (!empty(ret.alias)) {
              parser.error('An alias was previously found.', token)
              break
            }
            ret.alias = token.value as string
          }
        }
      }
    }

    if (alias) parser.error('An alias was expected.', list.at(list.idx - 1))

    // White-spaces might be added at the end.
    ret.expr = trim(str(ret.expr))

    if (ret.expr === '') return null

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/ExpressionArray.php::ExpressionArray
export const ExpressionArray = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/ExpressionArray.php::parse
  parse(parser: Parser, list: TokensList, options: ParseOptions = {}): (Expression | CaseExpression)[] {
    const ret: (Expression | CaseExpression)[] = []
    // 0 -> expecting an expression, 1 -> expecting a comma
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (
        token.type === TokenType.Keyword &&
        token.flags & TokenFlag.KEYWORD_RESERVED &&
        ~token.flags & TokenFlag.KEYWORD_FUNCTION &&
        token.value !== 'DUAL' &&
        token.value !== 'NULL' &&
        token.value !== 'CASE' &&
        token.value !== 'NOT'
      ) {
        // No keyword is expected.
        break
      }

      if (state === 0) {
        const expr =
          token.type === TokenType.Keyword && token.value === 'CASE'
            ? CaseExpressions.parse(parser, list, options)
            : Expressions.parse(parser, list, options)

        if (expr === null) break

        ret.push(expr)
        state = 1
      } else if (state === 1) {
        if (token.value !== ',') break
        state = 0
      }
    }

    if (state === 0) parser.error('An expression was expected.', list.at(list.idx))

    --list.idx
    const last = ret[ret.length - 1]
    if (last !== undefined) {
      const expr = last.expr ?? ''
      const m = /[ \t\n\v\f\r]*--[ \t\n\v\f\r][^\n]*$/.exec(expr)
      if (m) last.expr = expr.slice(0, expr.length - m[0].length)
    }

    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/CaseExpressions.php::CaseExpressions
export const CaseExpressions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/CaseExpressions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): CaseExpression {
    const ret = new CaseExpression()
    // 0 -> beginning, 1 -> after value/condition, 2 -> after compare value, 3 -> END
    let state = 0
    // 0 -> `CASE value WHEN ...`, 1 -> `CASE WHEN condition ...`
    let type = 0

    ++list.idx // Skip 'CASE'

    loop: for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Keyword) {
          switch (token.keyword) {
            case 'WHEN': {
              ++list.idx // Skip 'WHEN'
              const newCondition = Conditions.parse(parser, list)
              type = 1
              state = 1
              ret.conditions.push(newCondition)
              break
            }
            case 'ELSE':
              ++list.idx // Skip 'ELSE'
              ret.elseResult = Expressions.parse(parser, list)
              state = 0 // last clause of CASE expression
              break
            case 'END':
              state = 3 // end of CASE expression
              ++list.idx
              break loop
            default:
              parser.error('Unexpected keyword.', token)
              break loop
          }
        } else {
          ret.value = Expressions.parse(parser, list)
          type = 0
          state = 1
        }
      } else if (state === 1) {
        if (type === 0) {
          if (token.type === TokenType.Keyword) {
            switch (token.keyword) {
              case 'WHEN': {
                ++list.idx // Skip 'WHEN'
                const newValue = Expressions.parse(parser, list)
                state = 2
                ret.compareValues.push(newValue)
                break
              }
              case 'ELSE':
                ++list.idx // Skip 'ELSE'
                ret.elseResult = Expressions.parse(parser, list)
                state = 0 // last clause of CASE expression
                break
              case 'END':
                state = 3 // end of CASE expression
                ++list.idx
                break loop
              default:
                parser.error('Unexpected keyword.', token)
                break loop
            }
          }
        } else if (token.type === TokenType.Keyword && token.keyword === 'THEN') {
          ++list.idx // Skip 'THEN'
          const newResult = Expressions.parse(parser, list)
          state = 0
          ret.results.push(newResult)
        } else if (token.type === TokenType.Keyword) {
          parser.error('Unexpected keyword.', token)
          break
        }
      } else if (state === 2) {
        if (type === 0) {
          if (token.type === TokenType.Keyword && token.keyword === 'THEN') {
            ++list.idx // Skip 'THEN'
            const newResult = Expressions.parse(parser, list)
            ret.results.push(newResult)
            state = 1
          } else if (token.type === TokenType.Keyword) {
            parser.error('Unexpected keyword.', token)
            break
          }
        }
      }
    }

    if (state !== 3) {
      parser.error('Unexpected end of CASE expression', list.at(list.idx - 1))
    } else {
      // Parse for alias of CASE expression
      let asFound = false
      for (; list.idx < list.count; ++list.idx) {
        const token = list.tokens[list.idx] as Token

        // End of statement.
        if (token.type === TokenType.Delimiter) break

        // Skipping whitespaces and comments.
        if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

        // Handle optional AS keyword before alias
        if (token.type === TokenType.Keyword && token.keyword === 'AS') {
          if (asFound || !empty(ret.alias)) {
            parser.error('Potential duplicate alias of CASE expression.', token)
            break
          }
          asFound = true
          continue
        }

        if (
          asFound &&
          token.type === TokenType.Keyword &&
          (token.flags & TokenFlag.KEYWORD_RESERVED || token.flags & TokenFlag.KEYWORD_FUNCTION)
        ) {
          parser.error('An alias expected after AS but got ' + str(token.value), token)
          asFound = false
          break
        }

        // PHP: `! $token->flags & Token::FLAG_SYMBOL_VARIABLE` is `(! flags) & 1`.
        if (
          asFound ||
          token.type === TokenType.String ||
          (token.type === TokenType.Symbol && Number(!token.flags) & TokenFlag.SYMBOL_VARIABLE) ||
          token.type === TokenType.None
        ) {
          // An alias is expected (the keyword `AS` was previously found).
          if (!empty(ret.alias)) {
            parser.error('An alias was previously found.', token)
            break
          }
          ret.alias = token.value as string
          asFound = false
          continue
        }

        break
      }

      if (asFound) parser.error('An alias was expected after AS.', list.at(list.idx - 1))

      ret.expr = ret.build()
    }

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

const CONDITION_DELIMITERS = ['&&', '||', 'AND', 'OR', 'XOR']

const CONDITION_ALLOWED_KEYWORDS = [
  'ALL',
  'AND',
  'BETWEEN',
  'COLLATE',
  'EXISTS',
  'IF',
  'IN',
  'INTERVAL',
  'IS',
  'LIKE',
  'MATCH',
  'NOT IN',
  'NOT NULL',
  'NOT',
  'NULL',
  'OR',
  'REGEXP',
  'RLIKE',
  'SOUNDS',
  'XOR',
]

const COMPARISON_OPERATORS = ['=', '>=', '>', '<=', '<', '<>', '!=']

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/Conditions.php::Conditions
export const Conditions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/Conditions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): Condition[] {
    const ret: Condition[] = []
    let expr = new Condition()
    // Counts brackets.
    let brackets = 0
    // Whether there was a `BETWEEN` keyword before or not.
    let betweenBefore = false

    let hasSubQuery = false
    let subQueryBracket = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping whitespaces and comments.
      if (token.type === TokenType.Comment) continue

      // Replacing all whitespaces (new lines, tabs, etc.) with a single space character.
      if (token.type === TokenType.Whitespace) {
        expr.expr += ' '
        if (expr.operator === '') expr.leftOperand += ' '
        else expr.rightOperand += ' '
        continue
      }

      if (
        !hasSubQuery &&
        token.keyword !== null &&
        token.type === TokenType.Keyword &&
        brackets > 0 &&
        (STATEMENT_PARSERS[token.keyword] ?? '') !== ''
      ) {
        hasSubQuery = true
        subQueryBracket = brackets
      }

      // Conditions are delimited by logical operators.
      if (
        (token.type === TokenType.Keyword || token.type === TokenType.Operator) &&
        CONDITION_DELIMITERS.includes(token.value as string)
      ) {
        if (betweenBefore && token.value === 'AND') {
          // The syntax of keyword `BETWEEN` is `BETWEEN expr AND expr`.
          betweenBefore = false
        } else {
          // The expression ended.
          expr.expr = trim(expr.expr)
          if (expr.expr !== '') {
            expr.leftOperand = trim(expr.leftOperand)
            expr.rightOperand = trim(expr.rightOperand)
            ret.push(expr)
          }

          // Adding the operator.
          expr = new Condition(str(token.value))
          expr.isOperator = true
          ret.push(expr)

          // Preparing to parse another condition.
          expr = new Condition()
          continue
        }
      }

      if (
        token.type === TokenType.Keyword &&
        token.flags & TokenFlag.KEYWORD_RESERVED &&
        !(token.flags & TokenFlag.KEYWORD_FUNCTION)
      ) {
        if (token.value === 'BETWEEN') betweenBefore = true

        if (brackets === 0 && !CONDITION_ALLOWED_KEYWORDS.includes(token.value as string)) break
      }

      if (token.type === TokenType.Operator) {
        if (token.value === '(') {
          ++brackets
        } else if (token.value === ')') {
          if (brackets === 0) break
          if (subQueryBracket === brackets) hasSubQuery = false
          --brackets
        } else if (!hasSubQuery && COMPARISON_OPERATORS.includes(token.value as string)) {
          expr.operator = token.value as string
        }
      }

      expr.expr += token.token
      if (expr.operator === '') {
        expr.leftOperand += token.token
      } else if (expr.rightOperand !== '' || expr.operator !== token.value) {
        expr.rightOperand += token.token
      }

      if (
        token.type !== TokenType.None &&
        (token.type !== TokenType.Keyword || token.flags & TokenFlag.KEYWORD_RESERVED) &&
        token.type !== TokenType.String &&
        (token.type !== TokenType.Symbol || token.flags & TokenFlag.SYMBOL_PARAMETER)
      ) {
        continue
      }

      if (inArrayLoose(token.value, expr.identifiers)) continue

      expr.identifiers.push(token.value)
    }

    // Last iteration was not processed.
    expr.expr = trim(expr.expr)
    if (expr.expr !== '') {
      expr.leftOperand = trim(expr.leftOperand)
      expr.rightOperand = trim(expr.rightOperand)
      ret.push(expr)
    }

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(' ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/ArrayObjs.php::ArrayObjs
export const ArrayObjs = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/ArrayObjs.php::parse
  parse(parser: Parser, list: TokensList, options: ParseOptions = {}): ArrayObj {
    return parseArrayObjs(parser, list, options) as ArrayObj
  },

  /** `ArrayObjs::parse()` with `['type' => PartitionDefinitions::class]`. */
  parsePartitions(parser: Parser, list: TokensList): PartitionDefinition[] {
    return parseArrayObjs(parser, list, { type: 'PartitionDefinitions' }) as PartitionDefinition[]
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

function parseArrayObjs(
  parser: Parser,
  list: TokensList,
  options: ParseOptions,
): ArrayObj | PartitionDefinition[] {
  const typed = !empty(options.type)
  const obj = new ArrayObj()
  const arr: PartitionDefinition[] = []

  // The last raw expression.
  let lastRaw = ''
  // The last value.
  let lastValue = ''
  // Counts brackets.
  let brackets = 0
  // Last separator (bracket or comma).
  let isCommaLast = false

  for (; list.idx < list.count; ++list.idx) {
    const token = list.tokens[list.idx] as Token

    // End of statement.
    if (token.type === TokenType.Delimiter) {
      if (brackets > 0) parser.error('A closing bracket was expected.', token)
      break
    }

    // Skipping whitespaces and comments.
    if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) {
      lastRaw += token.token
      lastValue = trim(lastValue) + ' '
      continue
    }

    if (brackets === 0 && (token.type !== TokenType.Operator || token.value !== '(')) {
      parser.error('An opening bracket was expected.', token)
      break
    }

    if (token.type === TokenType.Operator) {
      if (token.value === '(') {
        if (++brackets === 1) {
          // 1 is the base level.
          continue
        }
      } else if (token.value === ')') {
        if (--brackets === 0) {
          // Array ended.
          break
        }
      } else if (token.value === ',') {
        if (brackets === 1) {
          isCommaLast = true
          if (!typed) {
            obj.raw.push(trim(lastRaw))
            obj.values.push(trim(lastValue))
            lastRaw = lastValue = ''
          }
          continue
        }
      }
    }

    if (!typed) {
      lastRaw += token.token
      lastValue += str(token.value)
    } else {
      arr.push(PartitionDefinitions.parse(parser, list, options.typeOptions ?? {}))
    }
  }

  // Handling last element.
  // This is treated differently to treat the following cases:
  //           ()  -> []
  //          ( )  -> []
  //         (a,)  -> ['a', '']
  //          (a)  -> ['a']
  lastRaw = trim(lastRaw)
  if (!typed && (lastRaw.length > 0 || isCommaLast)) {
    obj.raw.push(lastRaw)
    obj.values.push(trim(lastValue))
  }

  return typed ? arr : obj
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/Array2d.php::Array2d
export const Array2d = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/Array2d.php::parse
  parse(parser: Parser, list: TokensList, options: ParseOptions = {}): ArrayObj[] {
    const ret: ArrayObj[] = []
    // The number of values in each set.
    let count = -1
    // 0 -> opening bracket, 1 -> comma or end
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      // No keyword is expected.
      if (token.type === TokenType.Keyword && token.flags & TokenFlag.KEYWORD_RESERVED) break

      if (state === 0) {
        if (token.value !== '(') break

        const arr = ArrayObjs.parse(parser, list, options)
        const arrCount = arr.values.length
        if (count === -1) {
          count = arrCount
        } else if (arrCount !== count) {
          parser.error(`${count} values were expected, but found ${arrCount}.`, token)
        }

        ret.push(arr)
        state = 1
      } else if (state === 1) {
        if (token.value !== ',') break
        state = 0
      }
    }

    if (state === 0) {
      parser.error('An opening bracket followed by a set of values was expected.', list.at(list.idx))
    }

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/FunctionCalls.php::FunctionCalls
export const FunctionCalls = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/FunctionCalls.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): FunctionCall {
    const ret = new FunctionCall()
    // 0 -> function name, 1 -> parameters
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) {
        --list.idx // Let last token to previous one to avoid "This type of clause was previously parsed."
        break
      }

      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Operator && token.value === '(') {
          --list.idx // ArrayObj needs to start with `(`.
          state = 1
          continue // Skipping this token.
        }
        ret.name = str(ret.name) + str(token.value)
      } else if (state === 1) {
        ret.parameters = ArrayObjs.parse(parser, list)
        break
      }
    }

    return ret
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/GroupKeywords.php::GroupKeywords
export const GroupKeywords = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/GroupKeywords.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): GroupKeyword[] {
    const ret: GroupKeyword[] = []
    let expr = new GroupKeyword()
    // 0 -> expression, 1 -> order type or comma
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        expr.expr = Expressions.parse(parser, list)
        state = 1
      } else if (token.type === TokenType.Keyword && (token.keyword === 'ASC' || token.keyword === 'DESC')) {
        expr.type = token.keyword as OrderSortKeyword
      } else if (token.type === TokenType.Operator && token.value === ',') {
        if (expr.expr !== null) ret.push(expr)
        expr = new GroupKeyword()
        state = 0
      } else {
        break
      }
    }

    // Last iteration was not processed.
    if (expr.expr !== null) ret.push(expr)

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/OrderKeywords.php::OrderKeywords
export const OrderKeywords = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/OrderKeywords.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): OrderKeyword[] {
    const ret: OrderKeyword[] = []
    let expr = new OrderKeyword()
    // 0 -> expression, 1 -> order type or comma
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        expr.expr = Expressions.parse(parser, list)
        state = 1
      } else if (token.type === TokenType.Keyword && (token.keyword === 'ASC' || token.keyword === 'DESC')) {
        expr.type = token.keyword as OrderSortKeyword
      } else if (token.type === TokenType.Operator && token.value === ',') {
        if (expr.expr !== null) ret.push(expr)
        expr = new OrderKeyword()
        state = 0
      } else {
        break
      }
    }

    // Last iteration was not processed.
    if (expr.expr !== null) ret.push(expr)

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/IndexHints.php::IndexHints
export const IndexHints = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/IndexHints.php::parse
  parse(parser: Parser, list: TokensList, options: Record<string, unknown> = {}): IndexHint[] {
    const ret: IndexHint[] = []
    let expr = new IndexHint()
    expr.type = (options.type as string | undefined) ?? ''
    // 0 -> USE/IGNORE/FORCE, 1 -> INDEX/KEY, 2 -> FOR or index list, 3 -> JOIN/GROUP BY/ORDER BY, 4 -> index list
    let state = 0

    // By design, the parser will parse first token after the keyword. So, we go back one position.
    if (list.idx > 0) --list.idx

    loop: for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      switch (state) {
        case 0:
          if (token.type === TokenType.Keyword) {
            if (token.keyword !== 'USE' && token.keyword !== 'IGNORE' && token.keyword !== 'FORCE') break loop
            expr.type = token.keyword
            state = 1
          }
          break
        case 1:
          if (token.type === TokenType.Keyword) {
            if (token.keyword === 'INDEX' || token.keyword === 'KEY') {
              expr.indexOrKey = token.keyword
            } else {
              parser.error('Unexpected keyword.', token)
            }
            state = 2
          } else {
            // we expect the token to be a keyword
            parser.error('Unexpected token.', token)
          }
          break
        case 2:
          if (token.type === TokenType.Keyword && token.keyword === 'FOR') {
            state = 3
          } else {
            expr.indexes = ExpressionArray.parse(parser, list) as Expression[]
            state = 0
            ret.push(expr)
            expr = new IndexHint()
          }
          break
        case 3:
          if (token.type === TokenType.Keyword) {
            if (token.keyword === 'JOIN' || token.keyword === 'GROUP BY' || token.keyword === 'ORDER BY') {
              expr.for = token.keyword
            } else {
              parser.error('Unexpected keyword.', token)
            }
            state = 4
          } else {
            // we expect the token to be a keyword
            parser.error('Unexpected token.', token)
          }
          break
        case 4:
          expr.indexes = ExpressionArray.parse(parser, list) as Expression[]
          state = 0
          ret.push(expr)
          expr = new IndexHint()
          break
      }
    }

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(' ')
  },
}

// ---------------------------------------------------------------------------

const INTO_FIELDS_OPTIONS: OptionSpecs = {
  'TERMINATED BY': [1, 'expr'],
  OPTIONALLY: 2,
  'ENCLOSED BY': [3, 'expr'],
  'ESCAPED BY': [4, 'expr'],
}

const INTO_LINES_OPTIONS: OptionSpecs = {
  'STARTING BY': [1, 'expr'],
  'TERMINATED BY': [2, 'expr'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Components/IntoKeyword.php::parseFileOptions
function intoParseFileOptions(
  ret: IntoKeyword,
  parser: Parser,
  list: TokensList,
  keyword: string | null,
): void {
  ++list.idx
  if (keyword === 'FIELDS' || keyword === 'COLUMNS') {
    // parse field options
    ret.fieldsOptions = OptionsArrays.parse(parser, list, INTO_FIELDS_OPTIONS)
    ret.fieldsKeyword = keyword === 'FIELDS'
  } else {
    // parse line options
    ret.linesOptions = OptionsArrays.parse(parser, list, INTO_LINES_OPTIONS)
  }
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/IntoKeywords.php::IntoKeywords
export const IntoKeywords = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/IntoKeywords.php::parse
  parse(parser: Parser, list: TokensList, options: ParseOptions = {}): IntoKeyword {
    const ret = new IntoKeyword()
    // 0 -> name of table or `OUTFILE`, 1 -> columns, 2 -> file, 3 -> FIELDS/COLUMNS/LINES, 4 -> options
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (token.type === TokenType.Keyword && token.flags & TokenFlag.KEYWORD_RESERVED) {
        if (state === 0 && token.keyword === 'OUTFILE') {
          ret.type = 'OUTFILE'
          state = 2
          continue
        }

        // No other keyword is expected except for $state = 4, which expects `LINES`
        if (state !== 4) break
      }

      if (state === 0) {
        if (options.fromInsert || options.fromReplace) {
          ret.dest = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
        } else {
          ret.values = ExpressionArray.parse(parser, list) as Expression[]
        }
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Operator && token.value === '(') {
          ret.columns = ArrayObjs.parse(parser, list).values
          ++list.idx
        }
        break
      } else if (state === 2) {
        ret.dest = token.value
        state = 3
      } else if (state === 3) {
        intoParseFileOptions(ret, parser, list, token.keyword)
        state = 4
      } else if (state === 4) {
        if (token.type === TokenType.Keyword && token.keyword !== 'LINES') break
        intoParseFileOptions(ret, parser, list, token.keyword)
        state = 5
      }
    }

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/JoinKeywords.php::JoinKeywords
export const JoinKeywords = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/JoinKeywords.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): JoinKeyword[] {
    const ret: JoinKeyword[] = []
    let expr = new JoinKeyword()
    // 0 -> JOIN keyword, 1 -> expression, 2 -> ON/USING/next join, 3 -> ON conditions, 4 -> USING columns
    let state = 0

    // By design, the parser will parse first token after the keyword. So, we go back one position.
    if (list.idx > 0) --list.idx

    loop: for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type !== TokenType.Keyword || empty(joinType(token.keyword))) break
        expr.type = joinType(token.keyword)
        state = 1
      } else if (state === 1) {
        expr.expr = Expressions.parse(parser, list, { field: 'table' })
        state = 2
      } else if (state === 2) {
        if (token.type === TokenType.Keyword) {
          switch (token.keyword) {
            case 'ON':
              state = 3
              break
            case 'USING':
              state = 4
              break
            case 'USE':
            case 'IGNORE':
            case 'FORCE':
              // Adding index hint on the JOIN clause.
              expr.indexHints = IndexHints.parse(parser, list)
              break
            default:
              if (empty(joinType(token.keyword))) {
                // Next clause is starting.
                break loop
              }
              ret.push(expr)
              expr = new JoinKeyword()
              expr.type = joinType(token.keyword)
              state = 1
              break
          }
        }
      } else if (state === 3) {
        expr.on = Conditions.parse(parser, list)
        ret.push(expr)
        expr = new JoinKeyword()
        state = 0
      } else {
        expr.using = ArrayObjs.parse(parser, list)
        ret.push(expr)
        expr = new JoinKeyword()
        state = 0
      }
    }

    if (!empty(expr.type)) ret.push(expr)

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(' ')
  },
}

function joinType(keyword: string | null): string | null {
  if (keyword === null || !Object.hasOwn(JOINS, keyword)) return null
  return JOINS[keyword] as string
}

// ---------------------------------------------------------------------------

const KEY_OPTIONS: OptionSpecs = {
  KEY_BLOCK_SIZE: [1, 'var='],
  USING: [2, 'var'],
  'WITH PARSER': [3, 'var'],
  COMMENT: [4, 'var'],
  // MariaDB options
  CLUSTERING: [4, 'var='],
  ENGINE_ATTRIBUTE: [5, 'var='],
  SECONDARY_ENGINE_ATTRIBUTE: [5, 'var='],
  // MariaDB & MySQL options
  VISIBLE: 6,
  INVISIBLE: 6,
  // MariaDB options
  IGNORED: 10,
  'NOT IGNORED': 10,
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/Keys.php::Keys
export const Keys = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/Keys.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): Key {
    const ret = new Key()
    // Last parsed column.
    let lastColumn: KeyColumn = {}
    let lastColumnEmpty = true
    // 0 -> type, 1 -> name or `(`, 2 -> columns, 3 -> column length, 4 -> options, 5 -> expression
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        ret.type = token.value
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Operator && token.value === '(') {
          const positionBeforeSearch = list.idx
          list.idx++ // Ignore the current token "(" or the next one would be "("
          const nextToken = list.getNext()
          list.idx = positionBeforeSearch
          state = nextToken !== null && nextToken.value === '(' ? 5 : 2
        } else {
          ret.name = token.value
        }
      } else if (state === 2) {
        if (token.type === TokenType.Operator) {
          if (token.value === '(') {
            state = 3
          } else if (token.value === ',' || token.value === ')') {
            state = token.value === ',' ? 2 : 4
            if (!lastColumnEmpty) {
              ret.columns.push(lastColumn)
              lastColumn = {}
              lastColumnEmpty = true
            }
          }
        } else if (
          token.type === TokenType.Keyword &&
          (token.keyword === 'ASC' || token.keyword === 'DESC')
        ) {
          lastColumn.order = token.keyword
          lastColumnEmpty = false
        } else {
          lastColumn.name = token.value
          lastColumnEmpty = false
        }
      } else if (state === 3) {
        if (token.type === TokenType.Operator && token.value === ')') {
          state = 2
        } else {
          lastColumn.length = token.value
          lastColumnEmpty = false
        }
      } else if (state === 4) {
        ret.options = OptionsArrays.parse(parser, list, KEY_OPTIONS)
        ++list.idx
        break
      } else if (state === 5) {
        if (token.type === TokenType.Operator) {
          // This got back to here and we reached the end of the expression
          if (token.value === ')') {
            state = 4 // go back to state 4 to fetch options
            continue
          }

          // The expression is not finished, adding a separator for the next expression
          if (token.value === ',') {
            ret.expr = str(ret.expr) + ', '
            continue
          }

          // Start of the expression
          if (token.value === '(') {
            // This is the first expression, set to empty
            if (ret.expr === null) ret.expr = ''
            ret.expr += str(Expressions.parse(parser, list, { parenthesesDelimited: true }))
            continue
          }
          // Another unexpected operator was found
        }

        // Something else than an operator was found
        parser.error('Unexpected token.', token)
      }
    }

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/Limits.php::Limits
export const Limits = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/Limits.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): Limit {
    const ret = new Limit()
    let offset = false

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (token.type === TokenType.Keyword && token.flags & TokenFlag.KEYWORD_RESERVED) break

      if (token.type === TokenType.Keyword && token.keyword === 'OFFSET') {
        if (offset) parser.error('An offset was expected.', token)
        offset = true
        continue
      }

      if (token.type === TokenType.Operator && token.value === ',') {
        ret.offset = ret.rowCount
        ret.rowCount = 0
        continue
      }

      // Skip if not a number or a bind parameter (?)
      if (
        !(
          token.type === TokenType.Number ||
          (token.type === TokenType.Symbol && token.flags & TokenFlag.SYMBOL_PARAMETER)
        )
      ) {
        break
      }

      if (offset) {
        ret.offset = token.value
        offset = false
      } else {
        ret.rowCount = token.value
      }
    }

    if (offset) parser.error('An offset was expected.', list.at(list.idx - 1))

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/LockExpressions.php::LockExpressions
export const LockExpressions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/LockExpressions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): LockExpression {
    const ret = new LockExpression()
    // 0 -> table name, 1 -> lock type
    let state = 0
    let prevToken: Token | null = null

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter || (token.type === TokenType.Operator && token.value === ','))
        break

      if (state === 0) {
        ret.table = Expressions.parse(parser, list, { parseField: 'table' })
        state = 1
      } else if (state === 1) {
        // parse lock type
        ret.type = parseLockType(parser, list)
        state = 2
      }

      prevToken = token
    }

    // 2 is the only valid end state
    if (state !== 2) parser.error('Unexpected end of LOCK expression.', prevToken)

    --list.idx
    return ret
  },
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/LockExpressions.php::parseLockType
function parseLockType(parser: Parser, list: TokensList): string {
  let lockType = ''
  // 0 -> READ/LOW_PRIORITY/WRITE, 1 -> LOCAL, 2 -> WRITE, 3 -> end
  let state = 0
  let prevToken: Token | null = null

  for (; list.idx < list.count; ++list.idx) {
    const token = list.tokens[list.idx] as Token

    if (token.type === TokenType.Delimiter || (token.type === TokenType.Operator && token.value === ',')) {
      --list.idx
      break
    }

    // Skipping whitespaces and comments.
    if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

    // We only expect keywords
    if (token.type !== TokenType.Keyword) {
      parser.error('Unexpected token.', token)
      break
    }

    if (state === 0) {
      if (token.keyword === 'READ') {
        state = 1
      } else if (token.keyword === 'LOW_PRIORITY') {
        state = 2
      } else if (token.keyword === 'WRITE') {
        state = 3
      } else {
        parser.error('Unexpected keyword.', token)
        break
      }
      lockType += str(token.keyword)
    } else if (state === 1) {
      if (token.keyword !== 'LOCAL') {
        parser.error('Unexpected keyword.', token)
        break
      }
      lockType += ' ' + token.keyword
      state = 3
    } else if (state === 2) {
      if (token.keyword !== 'WRITE') {
        parser.error('Unexpected keyword.', token)
        break
      }
      lockType += ' ' + token.keyword
      state = 3 // parsing over
    }

    prevToken = token
  }

  // Only  two possible end states
  if (state !== 1 && state !== 3) parser.error('Unexpected end of LOCK expression.', prevToken)

  return lockType
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/RenameOperations.php::RenameOperations
export const RenameOperations = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/RenameOperations.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): RenameOperation[] {
    const ret: RenameOperation[] = []
    let expr = new RenameOperation()
    // 0 -> old name, 1 -> TO, 2 -> new name, 3 -> comma
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        expr.old = Expressions.parse(parser, list, { breakOnAlias: true, parseField: 'table' })
        if (expr.old === null) parser.error('The old name of the table was expected.', token)
        state = 1
      } else if (state === 1) {
        if (token.type !== TokenType.Keyword || token.keyword !== 'TO') {
          parser.error('Keyword "TO" was expected.', token)
          break
        }
        state = 2
      } else if (state === 2) {
        expr.new = Expressions.parse(parser, list, { breakOnAlias: true, parseField: 'table' })
        if (expr.new === null) parser.error('The new name of the table was expected.', token)
        state = 3
      } else {
        if (token.type !== TokenType.Operator || token.value !== ',') break
        ret.push(expr)
        expr = new RenameOperation()
        state = 0
      }
    }

    if (state !== 3) parser.error('A rename operation was expected.', list.at(list.idx - 1))

    // Last iteration was not saved.
    if (expr.old !== null) ret.push(expr)

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/SetOperations.php::SetOperations
export const SetOperations = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/SetOperations.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): SetOperation[] {
    const ret: SetOperation[] = []
    let expr = new SetOperation()
    // 0 -> column name, 1 -> value
    let state = 0
    // Token when the parser has seen the latest comma
    let commaLastSeenAt: Token | null = null

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      // No keyword is expected.
      if (token.type === TokenType.Keyword && token.flags & TokenFlag.KEYWORD_RESERVED && state === 0) break

      if (state === 0) {
        if (token.token === '=' || token.token === ':=') {
          state = 1
        } else if (token.value !== ',') {
          expr.column += token.token
        } else if (token.value === ',') {
          commaLastSeenAt = token
        }
      } else {
        const tmp = Expressions.parse(parser, list, { breakOnAlias: true })
        if (tmp === null) {
          parser.error('Missing expression.', token)
          break
        }
        expr.column = trim(expr.column)
        expr.value = tmp.expr as string
        ret.push(expr)
        expr = new SetOperation()
        state = 0
        commaLastSeenAt = null
      }
    }

    --list.idx

    // We saw a comma, but didn't see a column-value pair after it
    if (commaLastSeenAt !== null) parser.error('Unexpected token.', commaLastSeenAt)

    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return component.map((c) => str(c)).join(', ')
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/UnionKeywords.php::UnionKeywords
export const UnionKeywords = {
  parse(_parser: Parser, _list: TokensList, _options: ParseOptions = {}): never {
    throw new Error('Not implemented yet.')
  },

  buildAll(component: readonly (readonly [string, unknown])[]): string {
    return component.map((c) => c[0] + ' ' + str(c[1])).join(' ')
  },
}

// ---------------------------------------------------------------------------

const DATA_TYPE_OPTIONS: OptionSpecs = {
  BINARY: 1,
  'CHARACTER SET': [2, 'var'],
  CHARSET: [2, 'var'],
  COLLATE: [3, 'var'],
  UNSIGNED: 4,
  ZEROFILL: 5,
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/DataTypes.php::DataTypes
export const DataTypes = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/DataTypes.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): DataType | null {
    const ret = new DataType()
    // 0 -> data type name, 1 -> parameters and options
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        ret.name = strtoupper(str(token.value))
        if (token.type !== TokenType.Keyword || !(token.flags & TokenFlag.KEYWORD_DATA_TYPE)) {
          parser.error('Unrecognized data type.', token)
        }
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Operator && token.value === '(') {
          const parameters = ArrayObjs.parse(parser, list)
          ++list.idx
          ret.parameters = ret.name === 'ENUM' || ret.name === 'SET' ? parameters.raw : parameters.values
        }
        ret.options = OptionsArrays.parse(parser, list, DATA_TYPE_OPTIONS)
        ++list.idx
        break
      }
    }

    if (empty(ret.name)) return null

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

const REFERENCES_OPTIONS: OptionSpecs = {
  MATCH: [1, 'var'],
  'ON DELETE': [2, 'var'],
  'ON UPDATE': [3, 'var'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/References.php::References
export const References = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/References.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): Reference {
    const ret = new Reference()
    // 0 -> table name, 1 -> columns, 2 -> options
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        ret.table = Expressions.parse(parser, list, { parseField: 'table', breakOnAlias: true })
        state = 1
      } else if (state === 1) {
        ret.columns = ArrayObjs.parse(parser, list).values
        state = 2
      } else {
        ret.options = OptionsArrays.parse(parser, list, REFERENCES_OPTIONS)
        ++list.idx
        break
      }
    }

    --list.idx
    return ret
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/CreateDefinitions.php::FIELD_OPTIONS
const FIELD_OPTIONS: OptionSpecs = {
  // Tells the `OptionsArray` to not sort the options.
  _UNSORTED: true,

  'NOT NULL': 1,
  NULL: 1,
  DEFAULT: [2, 'expr', { breakOnAlias: true }],
  // Following are not according to grammar, but MySQL happily accepts these at any location
  CHARSET: [2, 'var'],
  COLLATE: [3, 'var'],
  AUTO_INCREMENT: 3,
  KEY: 4,
  PRIMARY: 4,
  'PRIMARY KEY': 4,
  UNIQUE: 4,
  'UNIQUE KEY': 4,
  COMMENT: [5, 'var'],
  COLUMN_FORMAT: [6, 'var'],
  'ON UPDATE': [7, 'expr'],

  // Generated columns options.
  'GENERATED ALWAYS': 8,
  AS: [9, 'expr', { parenthesesDelimited: true }],
  VIRTUAL: 10,
  PERSISTENT: 11,
  STORED: 11,
  CHECK: [12, 'expr', { parenthesesDelimited: true }],
  INVISIBLE: 13,
  ENFORCED: 14,
  NOT: 15,
  COMPRESSED: 16,
  // Common entities.
  SRID: [17, 'var'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/CreateDefinitions.php::CreateDefinitions
export const CreateDefinitions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/CreateDefinitions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): CreateDefinition[] {
    const ret: CreateDefinition[] = []
    let expr = new CreateDefinition()
    // 0 -> `(`, 1 -> name/CONSTRAINT/key, 2 -> data type, 3 -> options, 4 -> REFERENCES, 5 -> `,` or `)`, 6 -> end
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type !== TokenType.Operator || token.value !== '(') {
          parser.error('An opening bracket was expected.', token)
          break
        }
        state = 1
      } else if (state === 1) {
        if (token.type === TokenType.Keyword && token.keyword === 'CONSTRAINT') {
          expr.isConstraint = true
        } else if (token.type === TokenType.Keyword && token.flags & TokenFlag.KEYWORD_KEY) {
          expr.key = Keys.parse(parser, list)
          state = 4
        } else if (token.type === TokenType.Symbol || token.type === TokenType.None) {
          expr.name = token.value
          if (!expr.isConstraint) state = 2
        } else if (token.type === TokenType.Keyword) {
          if (token.flags & TokenFlag.KEYWORD_RESERVED) {
            // Reserved keywords can't be used as field names without backquotes
            parser.error(
              'A symbol name was expected! A reserved keyword can not be used as a column name without backquotes.',
              token,
            )
            return ret
          }
          // Non-reserved keywords are allowed without backquotes
          expr.name = token.value
          state = 2
        } else {
          parser.error('A symbol name was expected!', token)
          return ret
        }
      } else if (state === 2) {
        expr.type = DataTypes.parse(parser, list)
        state = 3
      } else if (state === 3) {
        expr.options = OptionsArrays.parse(parser, list, FIELD_OPTIONS)
        state = 4
      } else if (state === 4) {
        if (token.type === TokenType.Keyword && token.keyword === 'REFERENCES') {
          ++list.idx // Skipping keyword 'REFERENCES'.
          expr.references = References.parse(parser, list)
        } else {
          --list.idx
        }
        state = 5
      } else {
        if (expr.type !== null || expr.key !== null) ret.push(expr)
        expr = new CreateDefinition()
        if (token.value === ',') {
          state = 1
        } else if (token.value === ')') {
          state = 6
          ++list.idx
          break
        } else {
          parser.error('A comma or a closing bracket was expected.', token)
          state = 0
          break
        }
      }
    }

    // Last iteration was not saved.
    if (expr.type !== null || expr.key !== null) ret.push(expr)

    if (state !== 0 && state !== 6) parser.error('A closing bracket was expected.', list.at(list.idx - 1))

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return '(\n  ' + component.map((c) => str(c)).join(',\n  ') + '\n)'
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/ParameterDefinitions.php::ParameterDefinitions
export const ParameterDefinitions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/ParameterDefinitions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): ParameterDefinition[] {
    const ret: ParameterDefinition[] = []
    let expr = new ParameterDefinition()
    // 0 -> `(`, 1 -> IN/OUT/INOUT or name or `)`, 2 -> data type, 3 -> `,` or `)`
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        if (token.type === TokenType.Operator && token.value === '(') state = 1
      } else if (state === 1) {
        if (token.value === 'IN' || token.value === 'OUT' || token.value === 'INOUT') {
          expr.inOut = token.value
          ++list.idx
        } else if (token.value === ')') {
          ++list.idx
          break
        } else {
          expr.name = token.value
          state = 2
        }
      } else if (state === 2) {
        expr.type = DataTypes.parse(parser, list)
        state = 3
      } else {
        ret.push(expr)
        expr = new ParameterDefinition()
        if (token.value === ',') {
          state = 1
        } else if (token.value === ')') {
          ++list.idx
          break
        }
      }
    }

    // Last iteration was not saved.
    if (expr.name !== null && expr.name !== '') ret.push(expr)

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return '(' + component.map((c) => str(c)).join(', ') + ')'
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/PartitionDefinitions.php::$partitionOptions
const PARTITION_OPTIONS: OptionSpecs = {
  'STORAGE ENGINE': [1, 'var'],
  ENGINE: [1, 'var'],
  COMMENT: [2, 'var'],
  'DATA DIRECTORY': [3, 'var'],
  'INDEX DIRECTORY': [4, 'var'],
  MAX_ROWS: [5, 'var'],
  MIN_ROWS: [6, 'var'],
  TABLESPACE: [7, 'var'],
  NODEGROUP: [8, 'var'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/PartitionDefinitions.php::PartitionDefinitions
export const PartitionDefinitions = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/PartitionDefinitions.php::parse
  parse(parser: Parser, list: TokensList, _options: ParseOptions = {}): PartitionDefinition {
    const ret = new PartitionDefinition()
    // 0 -> PARTITION/SUBPARTITION, 1 -> name, 2 -> VALUES, 3 -> LESS THAN/IN, 4 -> expression,
    // 5 -> options, 6 -> subpartitions
    let state = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      if (token.type === TokenType.Delimiter) break
      if (token.type === TokenType.Whitespace || token.type === TokenType.Comment) continue

      if (state === 0) {
        ret.isSubpartition = token.type === TokenType.Keyword && token.keyword === 'SUBPARTITION'
        state = 1
      } else if (state === 1) {
        ret.name = str(token.value)

        // Looking ahead for a 'VALUES' keyword.
        // Loop until the end of the partition name (delimited by a whitespace)
        for (;;) {
          const t = list.at(++list.idx)
          if (t === null || t.type !== TokenType.None) break
          ret.name += str(t.value)
        }

        let idx = list.idx--
        // Get the first token after the white space.
        const nextToken = list.at(++idx)

        state =
          nextToken !== null && nextToken.type === TokenType.Keyword && nextToken.value === 'VALUES' ? 2 : 5
      } else if (state === 2) {
        state = 3
      } else if (state === 3) {
        ret.type = token.value
        state = 4
      } else if (state === 4) {
        if (token.value === 'MAXVALUE') {
          ret.expr = token.value
        } else {
          ret.expr = Expressions.parse(parser, list, { parenthesesDelimited: true, breakOnAlias: true })
        }
        state = 5
      } else if (state === 5) {
        ret.options = OptionsArrays.parse(parser, list, PARTITION_OPTIONS)
        state = 6
      } else if (state === 6) {
        if (token.type === TokenType.Operator && token.value === '(') {
          ret.subpartitions = ArrayObjs.parsePartitions(parser, list)
          ++list.idx
        }
        break
      }
    }

    --list.idx
    return ret
  },

  buildAll(component: readonly unknown[]): string {
    return '(\n' + component.map((c) => str(c)).join(',\n') + '\n)'
  },
}

// ---------------------------------------------------------------------------

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::DATABASE_OPTIONS
export const ALTER_DATABASE_OPTIONS: OptionSpecs = {
  'CHARACTER SET': [1, 'var'],
  CHARSET: [1, 'var'],
  'DEFAULT CHARACTER SET': [1, 'var'],
  'DEFAULT CHARSET': [1, 'var'],
  UPGRADE: [1, 'var'],
  COLLATE: [2, 'var'],
  'DEFAULT COLLATE': [2, 'var'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::TABLE_OPTIONS
export const ALTER_TABLE_OPTIONS: OptionSpecs = {
  ENGINE: [1, 'var='],
  ALGORITHM: [1, 'var='],
  AUTO_INCREMENT: [1, 'var='],
  AVG_ROW_LENGTH: [1, 'var'],
  'COALESCE PARTITION': [1, 'var'],
  LOCK: [1, 'var='],
  MAX_ROWS: [1, 'var'],
  ROW_FORMAT: [1, 'var'],
  COMMENT: [1, 'var'],
  ADD: 1,
  ALTER: 1,
  ANALYZE: 1,
  CHANGE: 1,
  CHARSET: 1,
  CHECK: 1,
  CONVERT: 1,
  'DEFAULT CHARSET': 1,
  DISABLE: 1,
  DISCARD: 1,
  DROP: 1,
  ENABLE: 1,
  IMPORT: 1,
  MODIFY: 1,
  OPTIMIZE: 1,
  ORDER: 1,
  REBUILD: 1,
  REMOVE: 1,
  RENAME: 1,
  REORGANIZE: 1,
  REPAIR: 1,
  UPGRADE: 1,

  COLUMN: 2,
  CONSTRAINT: 2,
  DEFAULT: 2,
  BY: 2,
  FOREIGN: 2,
  FULLTEXT: 2,
  KEY: [2, 'var'],
  KEYS: 2,
  PARTITION: 2,
  'PARTITION BY': 2,
  PARTITIONING: 2,
  'PRIMARY KEY': 2,
  SPATIAL: 2,
  TABLESPACE: 2,
  INDEX: [2, 'var'],
  UNIQUE: 2,
  'UNIQUE KEY': 2,

  'CHARACTER SET': 3,
  TO: [3, 'var'],
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::USER_OPTIONS
export const ALTER_USER_OPTIONS: OptionSpecs = {
  ATTRIBUTE: [1, 'var'],
  COMMENT: [1, 'var'],
  REQUIRE: [1, 'var'],

  'IDENTIFIED VIA': [2, 'var'],
  'IDENTIFIED WITH': [2, 'var'],
  PASSWORD: [2, 'var'],
  WITH: [2, 'var'],

  BY: [4, 'expr'],

  ACCOUNT: 1,
  DEFAULT: 1,

  LOCK: 2,
  UNLOCK: 2,

  IDENTIFIED: 3,
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::VIEW_OPTIONS
export const ALTER_VIEW_OPTIONS: OptionSpecs = { AS: 1 }

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::EVENT_OPTIONS
export const ALTER_EVENT_OPTIONS: OptionSpecs = {
  'ON SCHEDULE': 1,
  EVERY: [2, 'expr'],
  AT: [2, 'expr'],
  STARTS: [3, 'expr'],
  ENDS: [4, 'expr'],
  'ON COMPLETION PRESERVE': 5,
  'ON COMPLETION NOT PRESERVE': 5,
  RENAME: 6,
  TO: [7, 'expr', { parseField: 'table', breakOnAlias: true }],
  ENABLE: 8,
  DISABLE: 8,
  'DISABLE ON SLAVE': 8,
  COMMENT: [9, 'var'],
  DO: 10,
}

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::ROUTINE_OPTIONS
export const ALTER_ROUTINE_OPTIONS: OptionSpecs = {
  COMMENT: [1, 'var'],
  'LANGUAGE SQL': 2,
  'CONTAINS SQL': 3,
  'NO SQL': 3,
  'READS SQL DATA': 3,
  'MODIFIES SQL DATA': 3,
  'SQL SECURITY': 4,
  DEFINER: 5,
  INVOKER: 5,
}

const COLUMN_DEFINITION_KEYWORDS = [
  'AUTO_INCREMENT',
  'COMMENT',
  'DEFAULT',
  'CHARACTER SET',
  'COLLATE',
  'PRIMARY',
  'UNIQUE',
  'PRIMARY KEY',
  'UNIQUE KEY',
]

// pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::AlterOperations
export const AlterOperations = {
  // pma: vendor/phpmyadmin/sql-parser/src/Parsers/AlterOperations.php::parse
  parse(parser: Parser, list: TokensList, options: OptionSpecs = {}): AlterOperation {
    const ret = new AlterOperation()
    // Counts brackets.
    let brackets = 0
    // 0 -> options, 1 -> field, 2 -> unknown tokens, 3 -> partitions
    let state = 0
    // partitionState = 1 -> PARTITION BY, 2 -> partition definitions
    let partitionState = 0

    for (; list.idx < list.count; ++list.idx) {
      const token = list.tokens[list.idx] as Token

      // End of statement.
      if (token.type === TokenType.Delimiter) break

      // Skipping comments.
      if (token.type === TokenType.Comment) continue

      // Skipping whitespaces.
      if (token.type === TokenType.Whitespace) {
        if (state === 2) {
          // When parsing the unknown part, the whitespaces are included to not break anything.
          ret.unknown.push(token)
          continue
        }
      }

      if (state === 0) {
        ret.options = OptionsArrays.parse(parser, list, options)

        // Not only when aliasing but also when parsing the body of an event, we just list the tokens of the
        // body in the unknown tokens list, as they define their own statements.
        if (ret.options.has('AS') || ret.options.has('DO')) {
          for (; list.idx < list.count; ++list.idx) {
            if ((list.tokens[list.idx] as Token).type === TokenType.Delimiter) break
            ret.unknown.push(list.tokens[list.idx] as Token)
          }
          break
        }

        state = 1
        if (ret.options.has('PARTITION') || token.value === 'PARTITION BY') {
          state = 3
          list.getPrevious() // in order to check whether it's partition or partition by.
        }
      } else if (state === 1) {
        ret.field = Expressions.parse(parser, list, { breakOnAlias: true, parseField: 'column' })
        if (ret.field === null) {
          // No field was read. We go back one token so the next
          // iteration will parse the same token, but in state 2.
          --list.idx
        }

        // If the operation is a RENAME COLUMN, now we have detected the field to rename, we need to parse
        // again the options to get the new name of the column.
        if ((ret.options as OptionsArray).has('RENAME') && (ret.options as OptionsArray).has('COLUMN')) {
          const nextOptions = OptionsArrays.parse(parser, list, options)
          ;(ret.options as OptionsArray).merge(nextOptions)
        }

        state = 2
      } else if (state === 2) {
        const arrayKey =
          typeof token.value === 'string' ||
          (typeof token.value === 'number' && Number.isInteger(token.value))
            ? str(token.value)
            : token.token

        if (token.type === TokenType.Operator) {
          if (token.value === '(') {
            ++brackets
          } else if (token.value === ')') {
            --brackets
          } else if (token.value === ',' && brackets === 0) {
            break
          }
        } else if (!checkIfTokenQuotedSymbol(token) && token.type !== TokenType.String) {
          if (hasStatementParser(arrayKey)) {
            list.idx++ // Ignore the current token
            const nextToken = list.getNext()

            if (token.value === 'SET' && nextToken !== null && nextToken.value === '(') {
              // To avoid adding the tokens between the SET() parentheses to the unknown tokens
              list.getNextOfTypeAndValue(TokenType.Operator, ')')
            } else if (token.value === 'SET' && nextToken !== null && nextToken.value === 'DEFAULT') {
              // to avoid adding the `DEFAULT` token to the unknown tokens.
              ++list.idx
            } else {
              // We have reached the end of ALTER operation and suddenly found
              // a start to new statement, but have not found a delimiter between them
              parser.error(
                'A new statement was found, but no delimiter between it and the previous one.',
                token,
              )
              break
            }
          } else if (
            (Object.hasOwn(ALTER_DATABASE_OPTIONS, arrayKey) ||
              Object.hasOwn(ALTER_TABLE_OPTIONS, arrayKey)) &&
            !COLUMN_DEFINITION_KEYWORDS.includes(arrayKey)
          ) {
            // This alter operation has finished, which means a comma
            // was missing before start of new alter operation
            parser.error('Missing comma before start of a new alter operation.', token)
            break
          }
        }

        ret.unknown.push(token)
      } else if (state === 3) {
        if (partitionState === 0) {
          list.idx++ // Ignore the current token
          const nextToken = list.getNext()
          if (
            token.type === TokenType.Keyword &&
            (token.keyword === 'PARTITION BY' ||
              (token.keyword === 'PARTITION' && nextToken !== null && nextToken.value !== '('))
          ) {
            partitionState = 1
          } else if (token.type === TokenType.Keyword && token.keyword === 'PARTITION') {
            partitionState = 2
          }

          --list.idx // to decrease the idx by one, because the last getNext returned and increased it.

          // reverting the effect of the getNext
          list.getPrevious()
          list.getPrevious()

          ++list.idx // to index the idx by one, because the last getPrevious returned and decreased it.
        } else if (partitionState === 1) {
          // Fetch the next token in a way the current index is reset to manage whitespaces in "field".
          const currIdx = list.idx
          ++list.idx
          const nextToken = list.getNext()
          list.idx = currIdx
          // Building the expression used for partitioning.
          if (empty(ret.field)) ret.field = ''

          if (
            token.type === TokenType.Operator &&
            token.value === '(' &&
            nextToken !== null &&
            nextToken.keyword === 'PARTITION'
          ) {
            partitionState = 2
            --list.idx // Current idx is on "(". We need a step back for ArrayObjs::parse incoming.
          } else {
            ret.field = str(ret.field) + (token.type === TokenType.Whitespace ? ' ' : token.token)
          }
        } else if (partitionState === 2) {
          ret.partitions = ArrayObjs.parsePartitions(parser, list)
        }
      }
    }

    if ((ret.options as OptionsArray).isEmpty()) {
      parser.error('Unrecognized alter operation.', list.at(list.idx))
    }

    --list.idx
    return ret
  },
}

function checkIfTokenQuotedSymbol(token: Token): boolean {
  return token.type === TokenType.Symbol && token.flags === TokenFlag.SYMBOL_BACKTICK
}

// ---------------------------------------------------------------------------

/** Registry used by `Statement::parse()` (`Parser::KEYWORD_PARSERS[...]['class']`). */
export interface ComponentParser {
  parse(parser: Parser, list: TokensList, options?: ParseOptions): unknown
  buildAll?(component: readonly never[]): string
}

export const COMPONENT_PARSERS: Readonly<Record<ComponentParserName, ComponentParser>> = {
  OptionsArrays: OptionsArrays as unknown as ComponentParser,
  UnionKeywords: UnionKeywords as unknown as ComponentParser,
  Expressions,
  ExpressionArray,
  FunctionCalls,
  JoinKeywords,
  IndexHints: IndexHints as unknown as ComponentParser,
  GroupKeywords,
  Conditions,
  IntoKeywords,
  Limits,
  OrderKeywords,
  ArrayObjs,
  RenameOperations,
  SetOperations,
  Array2d,
}

export type { OptionEntry }
