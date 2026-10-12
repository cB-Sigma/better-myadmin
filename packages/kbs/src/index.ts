export {
  KB_ANY,
  KB_AURORA_MYSQL,
  KB_MARIADB,
  KB_MYSQL,
  getDocLinkByName,
  getStaticVariables,
  getVariableType,
} from './kbs.ts'
export {
  Advisor,
  type AdvisorInput,
  type AdvisorOptions,
  type AdvisorResult,
  type AdvisorRule,
  type AdvisorRuleResult,
  BEFORE_MYSQL_80003_RULES,
  GENERIC_RULES,
  byTime,
  vsprintf,
} from './advisor/advisor.ts'
export { ExpressionLanguage, tokenize } from './advisor/expression.ts'
export { type PhpValue, PhpError, pcreToRegExp } from './advisor/php.ts'
export { default as statusVariables } from './generated/status-variables.json' with { type: 'json' }
export { default as engineData } from './generated/engines.json' with { type: 'json' }
