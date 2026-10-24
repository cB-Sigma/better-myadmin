import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@bettermyadmin/config'
import { describe, expect, it } from 'vitest'
import { importPmaConfigCommand } from '../../src/cli/import-pma-config.ts'

function run(args: string[], env: Record<string, string> = {}) {
  let out = ''
  let err = ''
  const status = importPmaConfigCommand(args, {
    out: (s) => {
      out += s
    },
    err: (s) => {
      err += s
    },
    env,
  })
  return { status, out, err }
}

const PHP = `<?php
$i = 0;
$i++;
$cfg['Servers'][$i]['host'] = getenv('DB_HOST') ?: 'localhost';
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['MaxRows'] = 50;
`

describe('bettermyadmin import-pma-config (X6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bma-import-'))
  const input = join(dir, 'config.inc.php')
  writeFileSync(input, PHP)

  it('prints the configuration as JSON, getenv() from the environment', () => {
    const r = run([input], { DB_HOST: 'db.example.org' })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.out)).toEqual({
      Servers: { 1: { host: 'db.example.org', auth_type: 'cookie' } },
      MaxRows: 50,
    })
  })

  it('writes a file the server loads, owner-readable only, and does not overwrite it without --force', async () => {
    const output = join(dir, 'bettermyadmin.config.json')
    expect(run([input, '-o', output]).status).toBe(0)
    expect(statSync(output).mode & 0o777).toBe(0o600)
    const loaded = await loadConfig({ file: output, env: {} })
    expect(loaded.config.MaxRows).toBe(50)
    expect(loaded.config.Servers[1]?.host).toBe('localhost')
    const again = run([input, '-o', output])
    expect(again.status).toBe(1)
    expect(again.err).toContain('already exists; pass --force')
    expect(run([input, '-o', output, '--force']).status).toBe(0)
    expect(JSON.parse(readFileSync(output, 'utf8')).MaxRows).toBe(50)
  })

  it('refuses an invalid configuration with the closest directive, and PHP it cannot evaluate', () => {
    const bad = join(dir, 'bad.php')
    writeFileSync(bad, "<?php\n$cfg['MaxRowz'] = 5;\n")
    const r = run([bad])
    expect(r.status).toBe(1)
    expect(r.err).toContain('Did you mean "MaxRows"?')
    writeFileSync(bad, '<?php\n$cfg["X"] = exec("id");\n')
    const php = run([bad])
    expect(php.status).toBe(1)
    expect(php.err).toContain('is not supported by the importer')
  })

  it('usage errors', () => {
    expect(run([]).status).toBe(1)
    expect(run(['--help']).out).toContain('Usage: bettermyadmin import-pma-config')
    expect(run([join(dir, 'missing.php')]).err).toContain('Cannot read')
  })
})
