import { backquote } from '@bettermyadmin/sql-gen'
import { htmlspecialcharsCompat } from '../bytes.ts'
import type { Params } from '../params.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import { type PluginProperties, hidden, main, select } from '../properties.ts'

const ucfirst = (s: string) =>
  s === '' ? s : (s[0] as string).replace(/[a-z]/, (c) => c.toUpperCase()) + s.slice(1)
const trim = (s: string) => s.replace(/^[ \n\r\t\v\0]+|[ \n\r\t\v\0]+$/g, '')

/** ExportCodegen::cgMakeIdentifier */
export function cgMakeIdentifier(str0: string, uc = true): string {
  // remove unsafe characters
  let str = str0.replace(/[^\p{L}\p{Nl}_]/gu, '')
  // make sure first character is a letter or _
  if (!/^\p{L}/u.test(str)) str = `_${str}`
  return uc ? ucfirst(str) : str
}

const PRIMITIVE: Array<[string, string, string]> = [
  ['int', 'int', 'Int32'],
  ['longtext', 'string', 'String'],
  ['long', 'long', 'Long'],
  ['char', 'string', 'String'],
  ['varchar', 'string', 'String'],
  ['text', 'string', 'String'],
  ['tinyint', 'bool', 'Boolean'],
  ['datetime', 'DateTime', 'DateTime'],
]

/** pma: src/Plugins/Export/Helpers/TableProperty.php */
class TableProperty {
  name: string
  type: string
  nullable: string
  key: string

  constructor(row: Array<string | null>) {
    this.name = trim(row[0] ?? '')
    this.type = trim(row[1] ?? '')
    this.nullable = trim(row[2] ?? '')
    this.key = trim(row[3] ?? '')
  }

  pureType(): string {
    const pos = this.type.indexOf('(')
    return pos > 0 ? this.type.slice(0, pos) : this.type
  }

  #types(): [string, string] {
    for (const [p, a, b] of PRIMITIVE) if (this.type.startsWith(p)) return [a, b]
    return ['unknown', 'Unknown']
  }

  isPK(): boolean {
    return this.key === 'PRI'
  }

  indexName(): string {
    return this.key !== '' ? `index="${htmlspecialcharsCompat(this.name)}"` : ''
  }

  formatCs(text: string): string {
    return this.format(text.replaceAll('#name#', cgMakeIdentifier(this.name, false)))
  }

  formatXml(text: string): string {
    return this.format(
      text
        .replaceAll('#name#', htmlspecialcharsCompat(this.name))
        .replaceAll('#indexName#', this.indexName()),
    )
  }

  format(text: string): string {
    const [prim, obj] = this.#types()
    return text
      .replaceAll('#ucfirstName#', cgMakeIdentifier(this.name))
      .replaceAll('#dotNetPrimitiveType#', prim)
      .replaceAll('#dotNetObjectType#', obj)
      .replaceAll('#type#', this.pureType())
      .replaceAll('#notNull#', this.nullable === 'NO' ? 'true' : 'false')
      .replaceAll('#unique#', this.key === 'PRI' || this.key === 'UNI' ? 'true' : 'false')
  }
}

/**
 * Handles the export for the CodeGen class.
 * pma: src/Plugins/Export/ExportCodegen.php
 */
export class ExportCodegen extends ExportPlugin {
  format = 0

  get name(): string {
    return 'codegen'
  }

  protected setProperties(): PluginProperties {
    return {
      name: 'codegen',
      text: 'CodeGen',
      extension: 'cs',
      mimeType: 'text/cs',
      forceFile: false,
      options: [
        main('codegen_general_opts', '', [
          hidden('codegen_structure_or_data'),
          select('codegen_format', this.__('Format:'), [
            ['0', 'NHibernate C# DO'],
            ['1', 'NHibernate XML'],
          ]),
        ]),
      ],
    }
  }

  async #properties(db: string, table: string, aliases: Aliases): Promise<TableProperty[]> {
    const result = await this.query(`DESC ${backquote(db)}.${backquote(table)}`, false)
    const out: TableProperty[] = []
    for await (const row of result.rows) {
      const r = [...row]
      r[0] = this.getColumnAlias(aliases, db, table, r[0] ?? '')
      out.push(new TableProperty(r))
    }
    return out
  }

  override async exportData(
    db: string,
    table: string,
    _sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    if (this.format === 1) {
      await this.addLine(await this.#xmlBody(db, table, aliases))
      return
    }
    await this.addLine(await this.#csBody(db, table, aliases))
  }

  async #csBody(db: string, table: string, aliases: Aliases): Promise<string> {
    const dbAlias = this.getDbAlias(aliases, db)
    const tableAlias = this.getTableAlias(aliases, db, table)
    const props = await this.#properties(db, table, aliases)
    const cls = cgMakeIdentifier(tableAlias)
    const lines: string[] = [
      'using System;',
      'using System.Collections;',
      'using System.Collections.Generic;',
      'using System.Text;',
      `namespace ${cgMakeIdentifier(dbAlias)}`,
      '{',
      `    #region ${cls}`,
      `    public class ${cls}`,
      '    {',
      '        #region Member Variables',
    ]
    for (const p of props) lines.push(p.formatCs('        protected #dotNetPrimitiveType# _#name#;'))
    lines.push('        #endregion', '        #region Constructors', `        public ${cls}() { }`)
    const temp = props.filter((p) => !p.isPK()).map((p) => p.formatCs('#dotNetPrimitiveType# #name#'))
    lines.push(`        public ${cls}(${temp.join(', ')})`, '        {')
    for (const p of props) if (!p.isPK()) lines.push(p.formatCs('            this._#name#=#name#;'))
    lines.push('        }', '        #endregion', '        #region Public Properties')
    for (const p of props) {
      lines.push(
        p.formatCs(
          '        public virtual #dotNetPrimitiveType# #ucfirstName#\n        {\n            get {return _#name#;}\n            set {_#name#=value;}\n        }',
        ),
      )
    }
    lines.push('        #endregion', '    }', '    #endregion', '}')
    return lines.join('\n')
  }

  async #xmlBody(db: string, table: string, aliases: Aliases): Promise<string> {
    const dbAlias = cgMakeIdentifier(this.getDbAlias(aliases, db))
    const tableAlias = cgMakeIdentifier(this.getTableAlias(aliases, db, table))
    const lines: string[] = [
      '<?xml version="1.0" encoding="utf-8" ?>',
      `<hibernate-mapping xmlns="urn:nhibernate-mapping-2.2" namespace="${dbAlias}" assembly="${dbAlias}">`,
      `    <class name="${tableAlias}" table="${tableAlias}">`,
    ]
    for (const p of await this.#properties(db, table, aliases)) {
      lines.push(
        p.isPK()
          ? p.formatXml(
              '        <id name="#ucfirstName#" type="#dotNetObjectType#" unsaved-value="0">\n            <column name="#name#" sql-type="#type#" not-null="#notNull#" unique="#unique#" index="PRIMARY"/>\n            <generator class="native" />\n        </id>',
            )
          : p.formatXml(
              '        <property name="#ucfirstName#" type="#dotNetObjectType#">\n            <column name="#name#" sql-type="#type#" not-null="#notNull#" #indexName#/>\n        </property>',
            ),
      )
    }
    lines.push('    </class>', '</hibernate-mapping>')
    return lines.join('\n')
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('codegen_structure_or_data'),
      cfg.codegen_structure_or_data,
      'data',
    )
    const r = request.get('codegen_format')
    const value =
      r !== undefined && /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(r)
        ? Math.trunc(Number(r))
        : Number(cfg.codegen_format ?? 0)
    this.format = value === 1 ? 1 : 0
  }
}
