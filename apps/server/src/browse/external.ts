import { spawnSync } from 'node:child_process'
import {
  DEFAULT_TRANSFORMATIONS,
  type DefaultTransformations,
  withDefaults,
} from '@bettermyadmin/mysql-types'
import { requestScope } from '../db/request-scope.ts'

/**
 * Text_Plain_External with `$allowedPrograms` configured (TransformationsExternalPrograms): the
 * cell's value fed to the program's standard input, its standard output shown (escaped when the
 * third option is 1 or 2). The program is chosen by the first option (the first one otherwise) and
 * runs without a shell: its fixed arguments come from the configuration, the deprecated second
 * option adds arguments (never shell syntax) and raises phpMyAdmin's deprecation notice.
 * pma: src/Plugins/Transformations/Abs/ExternalTransformationsPlugin.php::applyTransformation
 */
export function runExternalTransformation(
  programs: readonly string[],
  options: readonly string[],
  buffer: Buffer,
  /** $cfg['DefaultTransformations']['External'] */
  defaults: readonly unknown[] = DEFAULT_TRANSFORMATIONS.External,
): string {
  const o = withDefaults(options, defaults).map((v) => String(v ?? ''))
  const chosen = programs[Number(o[0])] ?? programs[0]
  if (chosen === undefined) return buffer.toString('utf8')
  const extra = o[1] ?? ''
  if (extra !== '') requestScope()?.userErrors.push({ kind: 'external-options' })
  const [command = '', ...fixed] = chosen.trim().split(/\s+/)
  const args = [
    ...fixed,
    ...extra
      .trim()
      .split(/\s+/)
      .filter((a) => a !== ''),
  ]
  // proc_open failing leaves the output empty
  const r = spawnSync(command, args, {
    input: buffer,
    shell: false,
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  const output = r.error !== undefined || r.stdout === null ? '' : r.stdout.toString('utf8')
  // `$options[2] == 1 || $options[2] == '2'`
  const escaped = o[2] !== undefined && (Number(o[2]) === 1 || o[2] === '2')
  return escaped
    ? output
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    : output
}
