import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PmaImportError, importPmaConfig } from '../src/pma-import.ts'
import { resolveLayers } from '../src/resolve.ts'
import { FIXTURES, phpJsonShape, readFixture, stripBma } from './helpers.ts'

/** Golden output: each pma-configs/*.inc.php evaluated by PHP 8.3 (scripts/dump-pma-configs.php). */
const golden = readFixture<Record<string, { cfg: unknown; settings: unknown }>>('pma-configs.json')
const source = (name: string): string => readFileSync(join(FIXTURES, 'pma-configs', name), 'utf8')
const cfgOf = (php: string): Record<string, unknown> => importPmaConfig(php).config

describe('importPmaConfig vs the PHP runtime', () => {
  for (const name of Object.keys(golden)) {
    it(`${name}: $cfg equals what PHP evaluates`, () => {
      expect(phpJsonShape(cfgOf(source(name)))).toStrictEqual(golden[name]?.cfg)
    })

    it(`${name}: loaded config equals phpMyAdmin Settings::asArray()`, () => {
      const { config } = resolveLayers([{ value: cfgOf(source(name)), label: name }])
      expect(phpJsonShape(stripBma(config))).toStrictEqual(golden[name]?.settings)
    })
  }

  it('covers config.sample.inc.php from phpMyAdmin', () => {
    expect(cfgOf(source('config.sample.inc.php'))).toStrictEqual({
      blowfish_secret: '',
      Servers: { 1: { auth_type: 'cookie', host: 'localhost', compress: false, AllowNoPassword: false } },
      UploadDir: '',
      SaveDir: '',
    })
  })
})

describe('importPmaConfig syntax', () => {
  it('handles $i = 0; $i++ server blocks as 1-based keys', () => {
    const cfg = cfgOf(`<?php
      $i = 0;
      $i++;
      $cfg['Servers'][$i]['host'] = 'a';
      $i++;
      $cfg['Servers'][$i]['host'] = 'b';
    `)
    expect(cfg).toStrictEqual({ Servers: { 1: { host: 'a' }, 2: { host: 'b' } } })
  })

  it('appends with [] after the highest integer key, like PHP', () => {
    expect(
      cfgOf(`<?php $cfg['Servers'][] = ['host' => 'x']; $cfg['Servers'][] = ['host' => 'y'];`),
    ).toStrictEqual({
      Servers: [{ host: 'x' }, { host: 'y' }],
    })
    expect(
      cfgOf(`<?php $cfg['L'][5] = 'a'; $cfg['L'][] = 'b'; $cfg['L']['x'] = 'c'; $cfg['L'][] = 'd';`),
    ).toStrictEqual({
      L: { 5: 'a', 6: 'b', x: 'c', 7: 'd' },
    })
  })

  it('parses strings with escapes', () => {
    const cfg = cfgOf(String.raw`<?php
      $cfg['a'] = 'it\'s \\ \n raw';
      $cfg['b'] = "tab\there \"q\" \$x \x41\101\u{1F600} \q";
      $cfg['c'] = 'multi
line';
    `)
    expect(cfg.a).toBe("it's \\ \\n raw")
    expect(cfg.b).toBe('tab\there "q" $x AA\u{1F600} \\q')
    expect(cfg.c).toBe('multi\nline')
  })

  it('interpolates variables in double-quoted strings', () => {
    const cfg = cfgOf(`<?php $n = 'db'; $a = ['k' => 'v']; $i = 3;
      $cfg['x'] = "$n-{$a['k']}-\${n}-$a[k]-$i";`)
    expect(cfg.x).toBe('db-v-db-v-3')
  })

  it('parses numbers, booleans and null', () => {
    const cfg = cfgOf(`<?php
      $cfg['ints'] = [42, -7, 0x1F, 0b101, 017, 0o17, 1_000_000];
      $cfg['floats'] = [1.5, .25, 1e3, -2.5E-1];
      $cfg['b'] = [true, FALSE, True, NULL, null];
    `)
    expect(cfg.ints).toStrictEqual([42, -7, 31, 5, 15, 15, 1000000])
    expect(cfg.floats).toStrictEqual([1.5, 0.25, 1000, -0.25])
    expect(cfg.b).toStrictEqual([true, false, true, null, null])
  })

  it('parses array() and [] with nesting, keys and trailing commas', () => {
    const cfg = cfgOf(`<?php
      $cfg['A'] = array('x' => array(1, 2,), 'y' => [ 'z' => [] ], 3, '7' => 'seven', 'k');
    `)
    expect(cfg.A).toStrictEqual({ x: [1, 2], y: { z: [] }, 0: 3, 7: 'seven', 8: 'k' })
  })

  it('ignores comments, declare, namespace/use and the closing tag', () => {
    const cfg = cfgOf(`<?php
      declare(strict_types=1);
      /** docblock with $cfg['Fake'] = 1; */
      // $cfg['Fake'] = 2;
      # $cfg['Fake'] = 3;
      $cfg['Real'] = 1; // trailing
      $cfg['Url'] = 'http://x/#y'; # hash
    ?>
    trailing html is output, not code`)
    expect(cfg).toStrictEqual({ Real: 1, Url: 'http://x/#y' })
  })

  it('supports foreach over a host list (examples/config.manyhosts.inc.php)', () => {
    const cfg = cfgOf(source('config.manyhosts.inc.php'))
    expect(Object.keys(cfg.Servers as object)).toStrictEqual(['1', '2', '3', '4'])
    expect((cfg.Servers as Record<string, { host: string }>)['4']?.host).toBe('quux.example.com')
  })

  it('supports foreach with keys, if/elseif/else, getenv, isset, ternaries and ??', () => {
    const php = `<?php
      $hosts = ['primary' => 'db1', 'replica' => 'db2'];
      $i = 0;
      foreach ($hosts as $name => $host) {
        $i++;
        $cfg['Servers'][$i]['host'] = $host;
        $cfg['Servers'][$i]['verbose'] = ucwords_free($name);
      }
    `
    expect(() => cfgOf(php)).toThrow(/function ucwords_free\(\) is not supported/)

    const cfg = importPmaConfig(
      `<?php
      $hosts = ['primary' => 'db1', 'replica' => 'db2'];
      $i = 0;
      foreach ($hosts as $name => $host) {
        $i++;
        $cfg['Servers'][$i]['host'] = $host;
        $cfg['Servers'][$i]['verbose'] = strtoupper($name);
      }
      if (getenv('PMA_ARBITRARY') === '1') {
        $cfg['AllowArbitraryServer'] = true;
      } elseif (getenv('NOPE') !== false) {
        $cfg['AllowArbitraryServer'] = 'never';
      } else {
        $cfg['AllowArbitraryServer'] = false;
      }
      $cfg['MaxRows'] = isset($cfg['MaxRows']) ? $cfg['MaxRows'] : 50;
      $cfg['UploadDir'] = getenv('UPLOAD') ?: '';
      $cfg['SaveDir'] = $cfg['Missing'] ?? '/save';
      $cfg['TempDir'] = __DIR__ . DIRECTORY_SEPARATOR . 'tmp';
    `,
      { env: { PMA_ARBITRARY: '1' }, dir: '/etc/phpmyadmin' },
    ).config
    expect(cfg).toStrictEqual({
      Servers: { 1: { host: 'db1', verbose: 'PRIMARY' }, 2: { host: 'db2', verbose: 'REPLICA' } },
      AllowArbitraryServer: true,
      MaxRows: 50,
      UploadDir: '',
      SaveDir: '/save',
      TempDir: '/etc/phpmyadmin/tmp',
    })
  })

  it('has copy-on-assign array semantics', () => {
    const cfg = cfgOf(`<?php
      $base = ['host' => 'a', 'port' => '1'];
      $cfg['Servers'][1] = $base;
      $base['host'] = 'changed';
      $cfg['Servers'][2] = $base;
      $cfg['Servers'][2]['port'] .= '0';
    `)
    expect(cfg.Servers).toStrictEqual({ 1: { host: 'a', port: '1' }, 2: { host: 'changed', port: '10' } })
  })

  it('keeps sodium_hex2bin() secrets as hex text with a warning', () => {
    const hex = 'f16ce59f45714194371b48fe362072dc3b019da7861558cd4ad29e4d6fb13851'
    const r = importPmaConfig(`<?php $cfg['blowfish_secret'] = \\sodium_hex2bin('${hex}');`)
    expect(r.config.blowfish_secret).toBe(hex)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).not.toContain(hex)
  })

  it('accepts a file without <?php as plain code', () => {
    expect(cfgOf(`$cfg['MaxRows'] = 100;`)).toStrictEqual({ MaxRows: 100 })
  })

  it('reports unsupported syntax with line and column', () => {
    const cases: [string, RegExp][] = [
      [`<?php\n$cfg['a'] = 1;\nrequire 'other.php';`, /:3:1: require is not supported/],
      [`<?php\n$cfg['a'] = <<<EOT\nx\nEOT;`, /:2:13: heredoc/],
      [`<?php\n$cfg['a'] = 'unterminated;`, /:2:13: unterminated string/],
      [`<?php\n$cfg['a'] = [1, 2;`, /expected "," or "\]" in array/],
      [`<?php\n$cfg['a'] = FOO;`, /:2:13: undefined constant FOO/],
      [`<?php\n$cfg['a'] = new Foo();`, /objects are not supported/],
      ['<?php\nfunction f() {}', /"function" is not supported/],
      [`<?php\n$cfg['a'] = 1`, /expected ";"/],
    ]
    for (const [php, re] of cases) {
      let e: unknown
      try {
        importPmaConfig(php)
      } catch (x) {
        e = x
      }
      expect(e, php).toBeInstanceOf(PmaImportError)
      expect((e as Error).message, php).toMatch(re)
    }
  })

  it('normalises PHP array keys ("1" -> 1, true -> 1, null -> "")', () => {
    const cfg = cfgOf(`<?php $cfg['K'] = ['1' => 'a', true => 'b', null => 'c', '01' => 'd', 2.7 => 'e'];`)
    expect(cfg.K).toStrictEqual({ 1: 'b', '': 'c', '01': 'd', 2: 'e' })
  })
})
