#!/usr/bin/env tsx
/**
 * pnpm licenses:check — every production dependency must be usable in a GPL-2.0-only program.
 *
 * BetterMyAdmin is derived from phpMyAdmin, which is GPL version 2 only, so the dependencies that
 * ship in the Docker image or in the web bundle must have licences compatible with GPL v2. Apache-2.0
 * is not (it is compatible with GPL v3 only), so a new Apache-2.0 runtime dependency fails here. The
 * few that `pnpm licenses list --prod` reports but that never ship are listed below with the reason.
 */
import { execFileSync } from 'node:child_process'

/** Licences compatible with GPL-2.0-only (SPDX ids as npm packages declare them). */
const COMPATIBLE = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'LGPL-2.1',
  'LGPL-2.1-or-later',
  // MPL-2.0 allows the GPL as a secondary licence (section 3.3)
  'MPL-2.0',
])

/** Reported as production dependencies, but never shipped in the image or the web bundle. */
const NOT_SHIPPED: Record<string, string> = {
  typescript: 'used by tools/conventions and tools/parity only; the image installs the server alone',
  'baseline-browser-mapping': 'browser data for the Lingui Babel macro at build time',
  'caniuse-lite': 'browser data for the Lingui Babel macro at build time',
  lerc: "GeoTIFF decoding in OpenLayers' geotiff, which the web bundle does not include",
  'web-worker': "GeoTIFF decoding in OpenLayers' geotiff, which the web bundle does not include",
}

/** An SPDX expression is acceptable when every AND part, and at least one OR choice, is. */
function compatible(expr: string): boolean {
  const clean = expr.replace(/^\(|\)$/g, '').trim()
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => compatible(p))
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => compatible(p))
  return COMPATIBLE.has(clean)
}

function main() {
  const out = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const byLicense = JSON.parse(out) as Record<string, Array<{ name: string; versions: string[] }>>
  const bad: string[] = []
  for (const [license, pkgs] of Object.entries(byLicense)) {
    if (compatible(license)) continue
    for (const p of pkgs)
      if (!(p.name in NOT_SHIPPED)) bad.push(`${p.name}@${p.versions.join(',')}: ${license}`)
  }
  if (bad.length > 0) {
    console.error('Production dependencies whose licence is not compatible with GPL-2.0-only:')
    for (const b of bad.sort()) console.error(`  ${b}`)
    console.error('Replace them, or if they never ship, add them to NOT_SHIPPED with the reason.')
    process.exit(1)
  }
  console.log('licenses: every production dependency is compatible with GPL-2.0-only')
}

main()
