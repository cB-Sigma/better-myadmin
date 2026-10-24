import { defaults } from '@bettermyadmin/config'
import type { PluginInfo, PluginOptionItem } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * Every `$cfg['Export']`, `$cfg['Import']` and `$cfg['Schema']` directive has its effect: the page
 * options and settings show a non-default configured value (Plugins::getDefault /
 * checkboxCheck read `$cfg[type][option name]`; Export / Import Options read the page
 * settings). One configuration changes every directive at once, so a directive the pages ignore
 * shows its default and fails. Directives without an effect in phpMyAdmin are listed as such.
 */
const DB = 'f01a_dir_exp'
type Json = Record<string, unknown>
const flat = (items: PluginOptionItem[] = []): PluginOptionItem[] =>
  items.flatMap((i) => (i.kind === 'subgroup' ? [...(i.header ? [i.header] : []), ...flat(i.items)] : [i]))
const optionsOf = (plugins: PluginInfo[]) =>
  new Map(plugins.flatMap((p) => (p.options ?? []).flatMap((g) => flat(g.items))).map((i) => [i.name, i]))

/** A valid other value of a directive, from its default and the option's choices. */
function other(key: string, def: unknown, item: PluginOptionItem | undefined): unknown {
  if (typeof def === 'boolean') return !def
  // enums the pages show as tables or hidden fields
  if (key.endsWith('_structure_or_data')) return def === 'structure' ? 'data' : 'structure'
  if (key === 'method') return 'custom'
  if (key === 'ldi_local_option') return true
  if (typeof def === 'number') return def + 1
  const choices = (item?.values ?? []).map(([v]) => v)
  if (choices.length > 1) return choices.find((v) => v !== String(def ?? ''))
  return `${String(def ?? '')}~f01a`
}

/** pma reads these directives nowhere (Settings only) or only in the PDF plugin it does not offer. */
const NO_EFFECT: Record<string, string> = {
  // not page settings: tests of their own
  'Export/remove_definer_from_definitions': 'Copy / Move table (table-def.ts)',
  'Export/csv_escape_formulas': 'BetterMyAdmin addition (X3)',
  'Import/MaxDecompressedSize': 'BetterMyAdmin addition',
  'Export/xml_export_struc': 'no reader in phpMyAdmin',
  'Export/pdf_report_title': 'ExportPdf needs TCPDF (not in the reference build)',
  'Export/pdf_structure_or_data': 'ExportPdf needs TCPDF (not in the reference build)',
  'Import/sql_read_as_multibytes': 'no reader in phpMyAdmin (Q12)',
}

let root: mysql.Connection
beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; CREATE TABLE ${DB}.t (id INT PRIMARY KEY);`,
  )
})
afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root?.end()
})

async function pages(o: Json = {}) {
  const t = testApp(testConfig(o))
  try {
    await t.login()
    const exp = (await t.req('GET', `/api/servers/1/export/page?db=${DB}`)).json
    const tbl = (await t.req('GET', `/api/servers/1/export/page?db=${DB}&table=t&single_table=1`)).json
    const srv = (await t.req('GET', '/api/servers/1/export/page')).json
    const imp = (await t.req('GET', `/api/servers/1/import/page?db=${DB}`)).json
    // ImportLdi is offered for a table only
    const impTbl = (await t.req('GET', `/api/servers/1/import/page?db=${DB}&table=t`)).json
    const schema = (await t.req('GET', `/api/servers/1/databases/${DB}/designer/export?page=0`)).json
    return { exp, tbl, srv, imp, impTbl, schema }
  } finally {
    await t.close()
  }
}

describe('Export / Import / Schema directives', () => {
  it('every directive changes what the export, import and schema pages show', async () => {
    const base = await pages()
    const expOf = (p: typeof base) =>
      optionsOf([
        ...(p.srv.plugins as PluginInfo[]),
        ...(p.exp.plugins as PluginInfo[]),
        ...(p.tbl.plugins as PluginInfo[]),
      ])
    const impOf = (p: typeof base) =>
      optionsOf([...(p.imp.plugins as PluginInfo[]), ...(p.impTbl.plugins as PluginInfo[])])
    const expOpts = expOf(base)
    const impOpts = impOf(base)
    const schemaOpts = optionsOf(base.schema.plugins as PluginInfo[])
    const groups = {
      Export: { defs: defaults.Export as unknown as Json, opts: expOpts },
      Import: { defs: defaults.Import as unknown as Json, opts: impOpts },
      Schema: { defs: defaults.Schema as unknown as Json, opts: schemaOpts },
    }
    const cfg: Record<string, Json> = { Export: {}, Import: {}, Schema: {} }
    for (const [g, { defs, opts }] of Object.entries(groups))
      for (const [k, def] of Object.entries(defs)) {
        if (NO_EFFECT[`${g}/${k}`] !== undefined || k.startsWith('pdf_')) continue
        const v = other(k, def, opts.get(k))
        if (v !== undefined) (cfg[g] as Json)[k] = v
      }
    // a format that exists on each page, and the compression the zip switch forces
    ;(cfg.Export as Json).format = 'csv'
    ;(cfg.Export as Json).compression = 'gzip'
    ;(cfg.Export as Json).as_separate_files = false
    ;(cfg.Import as Json).format = 'csv'
    ;(cfg.Schema as Json).format = 'svg'
    const got = await pages(cfg)

    const shown = (opts: Map<string, PluginOptionItem>, k: string): unknown => {
      const i = opts.get(k)
      if (i === undefined) return undefined
      if (i.kind === 'bool') return i.checked
      return i.dbDefault ?? i.value
    }
    const gotExp = expOf(got)
    const gotImp = impOf(got)
    const gotSchema = optionsOf(got.schema.plugins as PluginInfo[])
    // the page settings that are not plugin options
    const page: Record<string, unknown> = {
      'Export/format': got.exp.selectedPlugin,
      'Export/method': got.exp.exportMethod,
      'Export/compression': got.exp.compression,
      'Export/charset': got.exp.charset,
      'Export/asfile': got.exp.asFile,
      'Export/onserver': got.exp.onServer,
      'Export/onserver_overwrite': got.exp.onServerOverwrite,
      'Export/quick_export_onserver': got.exp.quickExportOnServer,
      'Export/quick_export_onserver_overwrite': got.exp.quickExportOnServerOverwrite,
      'Export/lock_tables': got.exp.lockTables,
      'Export/remember_file_template': got.exp.rememberTemplate,
      'Export/file_template_database': got.exp.filenameTemplate,
      'Export/file_template_table': got.tbl.filenameTemplate,
      'Export/file_template_server': got.srv.filenameTemplate,
      'Export/as_separate_files': got.exp.asSeparateFiles,
      'Import/format': got.imp.selectedPlugin,
      'Import/charset': got.imp.importCharset,
      'Import/skip_queries': got.imp.skipQueries,
      'Import/allow_interrupt': got.imp.allowInterrupt,
      'Schema/format': got.schema.choice,
    }
    const mismatched: string[] = []
    for (const [g, gotOpts] of [
      ['Export', gotExp],
      ['Import', gotImp],
      ['Schema', gotSchema],
    ] as const) {
      for (const [k, want] of Object.entries(cfg[g] as Json)) {
        const key = `${g}/${k}`
        // phpMyAdmin's PHP array format is not offered (X57): its directive shows nowhere
        if (key === 'Export/phparray_structure_or_data') continue
        const v = key in page ? page[key] : shown(gotOpts, k)
        const norm = (x: unknown) => (typeof x === 'boolean' ? x : String(x))
        // a text value is shown translated (the LaTeX captions are msgids): the change must show
        const ok =
          typeof want === 'string' && want.endsWith('~f01a')
            ? String(v).endsWith('~f01a')
            : v !== undefined && norm(v) === norm(want)
        if (!ok) mismatched.push(`${key}: want ${String(want)}, got ${String(v)}`)
      }
    }
    expect(mismatched).toEqual([])
  })
})
