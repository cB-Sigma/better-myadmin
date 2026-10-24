import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { PmaImportError, formatIssue, importPmaConfig, validateConfig } from '@bettermyadmin/config'

/**
 * `bettermyadmin import-pma-config <config.inc.php> [-o file] [--force]`: a phpMyAdmin
 * `config.inc.php` as BetterMyAdmin's `bettermyadmin.config.json` (parity exception X6).
 *
 * The PHP file is evaluated by the configuration importer (no PHP runtime: the subset of PHP that
 * configuration files use, `getenv()` read from this process's environment), the result is checked
 * the way the server would load it, and written as JSON: to `-o` (refusing to overwrite without
 * `--force`), else to standard output. Exit status 1 on a file that cannot be read, evaluated or
 * validated, with the reason on standard error.
 */
export const USAGE = `Usage: bettermyadmin import-pma-config <config.inc.php> [-o bettermyadmin.config.json] [--force]

Converts a phpMyAdmin config.inc.php into a BetterMyAdmin configuration file (JSON).
Without -o the JSON is written to standard output.`

export interface CliIo {
  out: (s: string) => void
  err: (s: string) => void
  env: Readonly<Record<string, string | undefined>>
}

const processIo: CliIo = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  env: process.env,
}

/** Runs the command; returns the exit status. */
export function importPmaConfigCommand(args: string[], io: CliIo = processIo): number {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(args)
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${USAGE}\n`)
    return 1
  }
  const { values, positionals } = parsed
  if (values.help === true) {
    io.out(`${USAGE}\n`)
    return 0
  }
  if (positionals.length !== 1) {
    io.err(`${USAGE}\n`)
    return 1
  }
  const input = resolve(positionals[0] as string)
  let source: string
  try {
    source = readFileSync(input, 'utf8')
  } catch (e) {
    io.err(`Cannot read ${input}: ${(e as Error).message}\n`)
    return 1
  }

  let config: Record<string, unknown>
  let warnings: string[]
  try {
    ;({ config, warnings } = importPmaConfig(source, { env: io.env, dir: dirname(input), file: input }))
  } catch (e) {
    if (e instanceof PmaImportError) {
      io.err(`${input}: ${e.message}\n`)
      return 1
    }
    throw e
  }
  for (const w of warnings) io.err(`warning: ${w}\n`)

  // the same checks as loading the file: unknown directives (with the closest name) and bad values
  const checked = validateConfig(config)
  if (!checked.ok) {
    io.err(`${input} does not convert to a valid configuration:\n`)
    for (const issue of checked.issues) io.err(`  ${formatIssue(issue)}\n`)
    return 1
  }
  for (const w of checked.warnings) io.err(`warning: ${w}\n`)

  const json = `${JSON.stringify(config, null, 2)}\n`
  if (values.output === undefined) {
    io.out(json)
    return 0
  }
  const output = resolve(values.output)
  if (existsSync(output) && values.force !== true) {
    io.err(`${output} already exists; pass --force to overwrite it\n`)
    return 1
  }
  // the file can hold passwords (controlpass, config auth): readable by its owner only
  writeFileSync(output, json, { mode: 0o600 })
  io.err(`Wrote ${output}\n`)
  return 0
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
}
