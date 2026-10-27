import { isIPv4, isIPv6 } from 'node:net'

/**
 * Port of phpMyAdmin's IP based allow/deny rules, quirks included (octet ranges compare
 * numerically, IPv6 compares hex strings).
 *
 * pma: src/IpAllowDeny.php
 */

/** bin2hex(inet_pton(ip)); '' when inet_pton fails. */
function inetPtonHex(ip: string): string {
  if (isIPv4(ip)) {
    return ip
      .split('.')
      .map((p) => Number.parseInt(p, 10).toString(16).padStart(2, '0'))
      .join('')
  }
  if (!isIPv6(ip)) return ''
  let head = ip
  let tailV4 = ''
  const v4 = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) {
    tailV4 = inetPtonHex(v4[1]!)
    head = ip.slice(0, -v4[1]!.length)
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1)
  }
  const groupsWanted = tailV4 === '' ? 8 : 6
  const [l, r] = head.includes('::') ? head.split('::') : [head, undefined]
  const left = l === '' || l === undefined ? [] : l.split(':')
  const right = r === undefined || r === '' ? [] : r.split(':')
  const fill = r === undefined ? [] : Array(groupsWanted - left.length - right.length).fill('0')
  return [...left, ...fill, ...right].map((g) => g.padStart(4, '0')).join('') + tailV4
}

/** PHP numeric-string comparison for octets. */
function phpNum(s: string | undefined): number {
  if (s === undefined) return 0
  const m = s.match(/^\s*[+-]?\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}

export function ipv4MaskTest(testRange: string, ipToTest: string): boolean {
  const cidr = testRange.match(/^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\/([0-9]+)$/)
  if (cidr) return cidrMatch(cidr[1]!, Number(cidr[2]), ipToTest)
  const maskocts = testRange.split('.')
  const ipocts = ipToTest.split('.')
  let result = true
  for (let i = 0; i < 4; i++) {
    const m = maskocts[i]
    const range = m?.match(/\[([0-9]+)-([0-9]+)\]/)
    if (range) {
      const ip = phpNum(ipocts[i])
      if (ip > Number(range[2]) || ip < Number(range[1])) result = false
    } else if (m === undefined || ipocts[i] === undefined || m !== ipocts[i]) {
      result = false
    }
  }
  return result
}

/**
 * The first `prefix` bits of the subnet and the address (their inet_pton() bytes) are equal; an
 * invalid address never matches, a prefix longer than the address is the whole address.
 * pma: IpAllowDeny::cidrMatch (upstream d27d4c465e, which fixed the 31-bit mask: 10.0.0.0/8 also
 * matched 138.0.0.0/8)
 */
function cidrMatch(subnet: string, prefixIn: number, ipToTest: string): boolean {
  const a = inetPtonHex(subnet)
  const b = inetPtonHex(ipToTest)
  if (a === '' || b === '' || a.length !== b.length) return false
  const prefix = Math.min(prefixIn, a.length * 4)
  const fullBytes = Math.floor(prefix / 8)
  if (a.slice(0, fullBytes * 2) !== b.slice(0, fullBytes * 2)) return false
  const remaining = prefix % 8
  if (remaining === 0) return true
  const mask = (0xff << (8 - remaining)) & 0xff
  const byte = (h: string) => Number.parseInt(h.slice(fullBytes * 2, fullBytes * 2 + 2), 16)
  return (byte(a) & mask) === (byte(b) & mask)
}

export function ipv6MaskTest(testRangeIn: string, ipToTestIn: string): boolean {
  const testRange = testRangeIn.toLowerCase()
  const ipToTest = ipToTestIn.toLowerCase()
  const isCidr = testRange.includes('/')
  const isRange = testRange.includes('[')
  const ipHex = inetPtonHex(ipToTest)

  if (!isCidr && !isRange) return ipHex === inetPtonHex(testRange)

  if (isRange) {
    const m = testRange.match(/\[([0-9a-f]+)-([0-9a-f]+)\]/)
    if (!m) return true
    const firstHex = inetPtonHex(testRange.replace(m[0], m[1]!))
    const lastHex = inetPtonHex(testRange.replace(m[0], m[2]!))
    return ipHex >= firstHex && ipHex <= lastHex
  }

  const [firstIp = '', subnet = ''] = testRange.split('/')
  const firstHex = inetPtonHex(firstIp)
  let flexbits = 128 - (Number.parseInt(subnet, 10) || 0)
  const last = firstHex.split('')
  let pos = 31
  while (flexbits > 0) {
    const orig = Number.parseInt(last[pos] ?? '0', 16) || 0
    last[pos] = (orig | (2 ** Math.min(4, flexbits) - 1)).toString(16)
    flexbits -= 4
    pos--
  }
  const lastHex = last.join('')
  return ipHex >= firstHex && ipHex <= lastHex
}

export function ipMaskTest(testRange: string, ipToTest: string): boolean {
  if (testRange.includes(':') || ipToTest.includes(':')) return ipv6MaskTest(testRange, ipToTest)
  return ipv4MaskTest(testRange, ipToTest)
}

export interface AllowDenyContext {
  remoteIp: string | false
  username: string
  rules: string[]
  /** SERVER_ADDR, used for the localnetA/B/C shortcuts. */
  serverAddr?: string
}

function allowDeny(type: 'allow' | 'deny', ctx: AllowDenyContext): boolean {
  if (ctx.remoteIp === false || ctx.remoteIp === '') return false
  const shortcuts: Record<string, string> = { all: '0.0.0.0/0', localhost: '127.0.0.1/8' }
  if (ctx.serverAddr !== undefined && ctx.serverAddr !== '') {
    shortcuts.localnetA = `${ctx.serverAddr}/8`
    shortcuts.localnetB = `${ctx.serverAddr}/16`
    shortcuts.localnetC = `${ctx.serverAddr}/24`
  }
  for (const rule of ctx.rules) {
    const data = rule.split(' ')
    if (data[0] !== type) continue
    if (data[1] !== '%' && data[1] !== ctx.username) continue
    if (data[2] === 'from') data[2] = data[3] ?? ''
    let range = data[2] ?? ''
    if (Object.hasOwn(shortcuts, range)) range = shortcuts[range]!
    if (ipMaskTest(range, ctx.remoteIp)) return true
  }
  return false
}

export const allow = (ctx: AllowDenyContext) => allowDeny('allow', ctx)
export const deny = (ctx: AllowDenyContext) => allowDeny('deny', ctx)

/**
 * The `allow-denied` decision of AuthenticationPlugin::checkRules.
 * pma: src/Plugins/AuthenticationPlugin.php::checkRules
 */
export function isForbiddenByRules(order: string, ctx: AllowDenyContext): boolean {
  if (order === 'allow,deny' || order === 'explicit') return !(allow(ctx) && !deny(ctx))
  if (order === 'deny,allow') return deny(ctx) && !allow(ctx)
  return false
}

/**
 * Client IP, honouring TrustedProxies (`{proxyIp: 'HTTP_X_FORWARDED_FOR'}`).
 * pma: src/Core.php::getIp
 */
export function getClientIp(
  remoteAddr: string | undefined,
  trustedProxies: Record<string, string>,
  header: (name: string) => string | undefined,
): string | false {
  if (remoteAddr === undefined || remoteAddr === '') return false
  const headerVar = trustedProxies[remoteAddr]
  if (headerVar === undefined) return remoteAddr
  const name = headerVar
    .replace(/^HTTP_/, '')
    .replace(/_/g, '-')
    .toLowerCase()
  const first = (header(name) ?? '').split(',')[0] ?? ''
  return isIPv4(first) || isIPv6(first) ? first : false
}
