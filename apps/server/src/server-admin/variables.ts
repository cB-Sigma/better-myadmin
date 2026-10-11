import type {
  GetVariableResponse,
  ServerVariable,
  ServerVariableValue,
  ServerVariablesResponse,
  SetVariableResponse,
} from '@bettermyadmin/contracts'
import { formatByteDown, formatNumber } from '@bettermyadmin/i18n'
import { phpFloatToString } from '@bettermyadmin/i18n/php'
import { getStaticVariables, getVariableType } from '@bettermyadmin/kbs'
import { quoteString } from '@bettermyadmin/sql-gen'
import { type AdminCtx, isSuperUser, keyPairs, mysqlDocuUrl, varDocUrl } from './context.ts'

const isNumeric = (s: string) =>
  /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)

/**
 * VariablesController::formatVariable — byte-typed numbers as formatByteDown(3, 3) with the full
 * number as tooltip, other numbers formatNumber(0), anything else as is.
 */
export function formatVariable(ctx: AdminCtx, name: string, value: string): ServerVariableValue {
  if (!isNumeric(value)) return { text: value }
  if (getVariableType(name) === 'byte') {
    return { text: formatByteDown(ctx.tr, value, 3, 3)!.join(' '), title: formatNumber(ctx.tr, value, 0) }
  }
  return { text: formatNumber(ctx.tr, value, 0) }
}

/**
 * Global (and differing session) values of every system variable.
 * pma: src/Controllers/Server/VariablesController.php, templates/server/variables/index.twig
 */
export async function variablesPage(ctx: AdminCtx): Promise<ServerVariablesResponse> {
  const variables: ServerVariable[] = []
  const session = await keyPairs(ctx.dbi, 'SHOW SESSION VARIABLES;')
  if (session !== null) {
    const global = (await keyPairs(ctx.dbi, 'SHOW GLOBAL VARIABLES;')) ?? {}
    const staticVariables = getStaticVariables()
    for (const [name, value] of Object.entries(global)) {
      const hasSessionValue = Object.hasOwn(session, name) && session[name] !== value
      variables.push({
        name,
        isEditable: !staticVariables.includes(name.toLowerCase()),
        docUrl: varDocUrl(name, ctx),
        value: formatVariable(ctx, name, value),
        sessionValue: hasSessionValue ? formatVariable(ctx, name, session[name]!) : null,
      })
    }
  }
  return {
    variables,
    isSuperUser: await isSuperUser(ctx.dbi),
    isMariaDb: ctx.isMariaDb,
    docUrl: mysqlDocuUrl('server_system_variables', '', ctx.versionInt),
    noPrivilegeDocUrl: variables.length === 0 ? varDocUrl('show_compatibility_56', ctx) : null,
  }
}

/** pma: src/Controllers/Server/Variables/GetVariableController.php */
export async function getVariable(ctx: AdminCtx, name: string): Promise<GetVariableResponse> {
  const r = await ctx.dbi.tryQuery(`SHOW GLOBAL VARIABLES WHERE Variable_name=${quoteString(name)};`)
  const value = r?.rows[0]?.[1] ?? null
  if (value !== null && getVariableType(name) === 'byte') {
    return { message: formatByteDown(ctx.tr, value, 3, 3)!.join(' ') }
  }
  return { message: value ?? '' }
}

const UNIT_EXP: Record<string, number> = { kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3 }

/** (int) $string */
function intCast(s: string): string {
  const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(s)
  if (m === null) return '0'
  if (/^[+-]?\d+$/.test(m[1]!)) {
    const b = BigInt(m[1]!)
    const max = 2n ** 63n - 1n
    return (b > max ? max : b < -max - 1n ? -max - 1n : b).toString()
  }
  const f = Number(m[1])
  return Number.isFinite(f) ? BigInt.asIntN(64, BigInt(Math.trunc(f))).toString() : '0'
}

/** The SQL value of SET GLOBAL for the variable type (SetVariableController::__invoke). */
export function setVariableValue(type: string | null, input: string): string {
  const m = type === 'byte' ? /^\s*(\d+(\.\d+)?)\s*(mb|kb|mib|kib|gb|gib)\s*$/i.exec(input) : null
  if (m !== null) return phpFloatToString(Number(m[1]) * 1024 ** UNIT_EXP[m[3]!.toLowerCase()]!)
  if (type === 'integer') return intCast(input)
  return quoteString(input)
}

/**
 * SET GLOBAL with phpMyAdmin's value handling: byte variables accept kb/kib/mb/mib/gb/gib units,
 * integer variables are cast, anything else is quoted; the value is read back (servers round).
 * pma: src/Controllers/Server/Variables/SetVariableController.php
 */
export async function setVariable(ctx: AdminCtx, name: string, input: string): Promise<SetVariableResponse> {
  const value = setVariableValue(getVariableType(name), input)
  if (/[^a-zA-Z0-9_]+/.test(name)) {
    return { success: false, error: ctx.tr.gettext('Setting variable failed') }
  }
  await ctx.conn.query(`SET GLOBAL ${name} = ${value}`, 'variables.set')
  // Some values are rounded down etc.
  const r = await ctx.dbi.tryQuery(`SHOW GLOBAL VARIABLES WHERE Variable_name=${quoteString(name)};`)
  return { success: true, variable: formatVariable(ctx, name, r?.rows[0]?.[1] ?? '') }
}
