import { localisedDate, sprintf } from '@bettermyadmin/i18n'
import { extractColumnSpec, printableBitValue } from '@bettermyadmin/mysql-types'
import { backquote, backquoteCompat, getUniqueCondition } from '@bettermyadmin/sql-gen'
import {
  Context,
  type CreateDefinition,
  type CreateStatement,
  Parser,
  SqlMode,
  type Statement,
  TokenFlag,
  TokenType,
} from '@bettermyadmin/sql-lexer'
import { encodeBytes, hexBytes, mbStrlen } from '../bytes.ts'
import { MYSQL_CHARSET_MAP } from '../charset.ts'
import { ExportError } from '../errors.ts'
import type { Params } from '../params.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import {
  type OptionItem,
  type PluginProperties,
  boolItem,
  main,
  message,
  numberItem,
  radio,
  select,
  subgroup,
  textItem,
} from '../properties.ts'

type Compat = 'NONE' | 'ANSI' | 'DB2' | 'MAXDB' | 'MYSQL323' | 'MYSQL40' | 'MSSQL' | 'ORACLE' | 'TRADITIONAL'

/** MySQL DATETIME text → epoch seconds as PHP's `new DateTimeImmutable($s)` in `tz` would read it. */
export function wallTimeToEpoch(s: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (m === null) return Math.floor(Date.parse(s) / 1000)
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, se) / 1000
  if (tz === 'UTC') return asUtc
  // offset of `tz` at that instant (two passes for DST edges)
  const offsetAt = (epoch: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(epoch * 1000))
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) / 1000 - epoch
  }
  let epoch = asUtc - offsetAt(asUtc)
  epoch = asUtc - offsetAt(epoch)
  return epoch
}

/**
 * Handles the export for the SQL class.
 * pma: src/Plugins/Export/ExportSql.php
 */
export class ExportSql extends ExportPlugin {
  /** Whether charset header was sent. */
  #sentCharset = false
  doComments = false
  doDates = false
  doMime = false
  doRelation = false
  headerComment = ''
  sqlAutoIncrements: string | null = null
  sqlConstraints: string | null = null
  sqlConstraintsQuery = ''
  sqlIndexes: string | null = null
  #sqlViews = ''
  useSqlBackquotes = false
  useTransaction = false
  disableForeignKey = false
  compatibility: Compat = 'NONE'
  createDatabase = false
  dropTable = false
  hasCreateProcedureFunction = false
  hasCreateTable = false
  type: 'INSERT' | 'UPDATE' | 'REPLACE' = 'INSERT'
  hasCreateView = false
  hasCreateTrigger = false
  viewCurrentUser = false
  simpleViewExport = false
  ifNotExists = false
  orReplaceView = false
  autoIncrement = false
  truncate = false
  delayed = false
  ignore = false
  insertSyntax: 'complete' | 'extended' | 'both' | 'none' = 'both'
  maxQuerySize = 50000
  hexForBinary = false
  utcTime = false
  dropDatabase = false
  viewsAsTables = false
  hasMetadata = false

  static oldTimezone = ''
  static noConstraintsComments = false
  static #exportingMetadata = false

  get name(): string {
    return 'sql'
  }

  // ------------------------------------------------------------------ parser helpers

  /** A context with the connection's keywords and mode (PHP's global Context). */
  #context(extraMode = 0): Context {
    const base = this.ctx.parserContext
    const c = new Context(base.loadedContext, base.mode | extraMode)
    return c
  }

  #parse(sql: string, extraMode = 0): { statement: Statement | undefined; ctx: Context } {
    const ctx = this.#context(extraMode)
    const parser = new Parser(sql, { context: ctx })
    return { statement: parser.statements[0], ctx }
  }

  /** Util::backquoteCompat */
  #bqc(identifier: string, compat: string, doIt: boolean): string {
    const ctx = this.ctx.parserContext
    return backquoteCompat(identifier, compat, doIt, (w) => {
      const flags = ctx.isKeyword(w)
      return flags !== null && (flags & TokenFlag.KEYWORD_RESERVED) !== 0
    })
  }

  // ------------------------------------------------------------------ properties

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    const hideSql = this.ctx.exportType === 'table' && !this.ctx.singleTable
    const props: PluginProperties = {
      name: 'sql',
      text: 'SQL',
      extension: 'sql',
      mimeType: 'text/x-sql',
      forceFile: false,
      options: null,
    }
    if (hideSql && !this.ctx.rawQuery) return props

    const commentItems: OptionItem[] = [
      textItem('sql_header_comment', __('Additional custom header comment (\\n splits lines):')),
      boolItem(
        'sql_dates',
        __('Include a timestamp of when databases were created, last updated, and last checked'),
      ),
    ]
    if (this.ctx.relation.relationFeature) {
      commentItems.push(boolItem('sql_relation', __('Display foreign key relationships')))
    }
    if (this.ctx.relation.browserTransformationFeature) {
      commentItems.push(boolItem('sql_mime', __('Display media types')))
    }
    const general: OptionItem[] = [
      subgroup(
        {
          kind: 'bool',
          name: 'sql_include_comments',
          text: __(
            'Display comments <i>(includes info such as export timestamp, PHP version, and server version)</i>',
          ),
        },
        commentItems,
        'sql_include_comments',
      ),
      boolItem('sql_use_transaction', __('Enclose export in a transaction'), [
        'mysqldump',
        'option_mysqldump_single-transaction',
      ]),
      boolItem('sql_disable_fk', __('Disable foreign key checks'), [
        'server-system-variables',
        'sysvar_foreign_key_checks',
      ]),
      boolItem('sql_views_as_tables', __('Export views as tables')),
      boolItem('sql_metadata', __('Export metadata')),
    ]
    const compats = this.ctx.compatibilities
    if (compats.length > 0) {
      general.push(
        select(
          'sql_compatibility',
          __('Database system or older MySQL server to maximize output compatibility with:'),
          compats.map((c) => [c, c]),
          ['sql-mode'],
        ),
      )
    }
    general.push(
      subgroup(
        {
          kind: 'radio',
          name: 'sql_structure_or_data',
          text: '',
          values: [
            ['structure', __('structure')],
            ['data', __('data')],
            ['structure_and_data', __('structure and data')],
          ],
        },
        [],
        'sql_dump_table',
        __('Dump table'),
      ),
    )

    const addStatements: OptionItem[] = []
    if (this.ctx.exportType === 'server') {
      addStatements.push(
        boolItem(
          'sql_drop_database',
          sprintf(__('Add %s statement'), '<code>DROP DATABASE IF EXISTS</code>'),
        ),
      )
    }
    if (this.ctx.exportType === 'database') {
      addStatements.push(
        boolItem(
          'sql_create_database',
          sprintf(__('Add %s statement'), '<code>CREATE DATABASE / USE</code>'),
        ),
      )
    }
    let dropClause =
      this.ctx.exportType === 'table'
        ? this.ctx.currentTableIsView
          ? '<code>DROP VIEW</code>'
          : '<code>DROP TABLE</code>'
        : '<code>DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT</code>'
    dropClause += '<code> / TRIGGER</code>'
    addStatements.push(boolItem('sql_drop_table', sprintf(__('Add %s statement'), dropClause)))
    addStatements.push(
      subgroup(
        {
          kind: 'bool',
          name: 'sql_create_table',
          text: sprintf(__('Add %s statement'), '<code>CREATE TABLE</code>'),
        },
        [
          boolItem(
            'sql_if_not_exists',
            `<code>IF NOT EXISTS</code> ${__('(less efficient as indexes will be generated during table creation)')}`,
          ),
          boolItem('sql_auto_increment', sprintf(__('%s value'), '<code>AUTO_INCREMENT</code>')),
        ],
      ),
    )
    addStatements.push(
      subgroup(
        {
          kind: 'bool',
          name: 'sql_create_view',
          text: sprintf(__('Add %s statement'), '<code>CREATE VIEW</code>'),
        },
        [
          boolItem('sql_simple_view_export', __('Use simple view export')),
          boolItem('sql_view_current_user', __('Exclude definition of current user')),
          boolItem('sql_or_replace_view', sprintf(__('%s view'), '<code>OR REPLACE</code>')),
        ],
      ),
    )
    addStatements.push(
      boolItem(
        'sql_procedure_function',
        sprintf(__('Add %s statement'), '<code>CREATE PROCEDURE / FUNCTION / EVENT</code>'),
      ),
    )
    addStatements.push(
      boolItem('sql_create_trigger', sprintf(__('Add %s statement'), '<code>CREATE TRIGGER</code>')),
    )

    const structure: OptionItem[] = [
      subgroup(message('sql_add_statements', __('Add statements:')), addStatements),
      boolItem(
        'sql_backquotes',
        __(
          'Enclose table and column names with backquotes <i>(Protects column and table names formed with special characters or keywords)</i>',
        ),
      ),
    ]

    const data: OptionItem[] = [
      boolItem('sql_truncate', __('Truncate table before insert')),
      subgroup(message('sql_insert_alternatives', __('Instead of <code>INSERT</code> statements, use:')), [
        boolItem('sql_delayed', __('<code>INSERT DELAYED</code> statements'), ['insert_delayed']),
        boolItem('sql_ignore', __('<code>INSERT IGNORE</code> statements'), ['insert']),
      ]),
      select('sql_type', __('Function to use when dumping data:'), [
        ['INSERT', 'INSERT'],
        ['UPDATE', 'UPDATE'],
        ['REPLACE', 'REPLACE'],
      ]),
      subgroup(message('', __('Syntax to use when inserting data:')), [
        radio('sql_insert_syntax', __('<code>INSERT IGNORE</code> statements'), [
          [
            'complete',
            __(
              'include column names in every <code>INSERT</code> statement <br> &nbsp; &nbsp; &nbsp; Example: <code>INSERT INTO tbl_name (col_A,col_B,col_C) VALUES (1,2,3)</code>',
            ),
          ],
          [
            'extended',
            __(
              'insert multiple rows in every <code>INSERT</code> statement<br> &nbsp; &nbsp; &nbsp; Example: <code>INSERT INTO tbl_name VALUES (1,2,3), (4,5,6), (7,8,9)</code>',
            ),
          ],
          [
            'both',
            __(
              'both of the above<br> &nbsp; &nbsp; &nbsp; Example: <code>INSERT INTO tbl_name (col_A,col_B,col_C) VALUES (1,2,3), (4,5,6), (7,8,9)</code>',
            ),
          ],
          [
            'none',
            __(
              'neither of the above<br> &nbsp; &nbsp; &nbsp; Example: <code>INSERT INTO tbl_name VALUES (1,2,3)</code>',
            ),
          ],
        ]),
      ]),
      numberItem('sql_max_query_size', __('Maximal length of created query')),
      boolItem(
        'sql_hex_for_binary',
        __('Dump binary columns in hexadecimal notation <i>(for example, "abc" becomes 0x616263)</i>'),
      ),
      boolItem(
        'sql_utc_time',
        __(
          'Dump TIMESTAMP columns in UTC <i>(enables TIMESTAMP columns to be dumped and reloaded between servers in different time zones)</i>',
        ),
      ),
    ]

    props.options = [
      main('sql_general_opts', '', general),
      main('sql_structure', __('Object creation options'), structure),
      main('sql_data', __('Data creation options'), data),
    ]
    return props
  }

  // ------------------------------------------------------------------ comments

  /** Possibly outputs comment */
  #exportComment(text = ''): string {
    if (!this.doComments) return ''
    // see https://dev.mysql.com/doc/refman/5.0/en/ansi-diff-comments.html
    if (text === '') return '--\n'
    return text
      .split(/\r\n|\r|\n/)
      .map((line) => `-- ${line}\n`)
      .join('')
  }

  /** Possibly outputs CRLF */
  #possibleCRLF(): string {
    return this.doComments ? '\n' : ''
  }

  // ------------------------------------------------------------------ routines / events

  async #exportRoutineSQL(
    db: string,
    aliases: Aliases,
    type: 'FUNCTION' | 'PROCEDURE',
    name: string,
    routines: string[],
    delimiter: string,
  ): Promise<string> {
    let text = this.#exportComment() + this.#exportComment(name) + this.#exportComment()
    let usedAlias = false
    let procQuery = ''
    for (const routine of routines) {
      if (this.dropTable) procQuery += `DROP ${type} IF EXISTS ${backquote(routine)}${delimiter}\n`
      const definition = await this.ctx.dbi.fetchValue(
        `SHOW CREATE ${type} ${backquote(db)}.${backquote(routine)}`,
        type === 'FUNCTION' ? 'Create Function' : 'Create Procedure',
      )
      const flag = { value: false }
      let createQuery = this.replaceWithAliases(
        delimiter,
        typeof definition === 'string' ? definition : '',
        aliases,
        db,
        flag,
      )
      if (createQuery !== '' && this.ctx.settings.remove_definer_from_definitions === true) {
        createQuery = this.#removeDefiner(`DELIMITER ${delimiter}\n${createQuery}`)
      }
      // One warning per database
      if (flag.value) usedAlias = true
      procQuery += `${createQuery}${delimiter}\n\n`
    }
    if (usedAlias) {
      text +=
        this.#exportComment(this.__('It appears your database uses routines;')) +
        this.#exportComment(this.__('alias export may not work reliably in all cases.')) +
        this.#exportComment()
    }
    return text + procQuery
  }

  #removeDefiner(sql: string): string {
    const { statement, ctx } = this.#parse(sql)
    if (statement === undefined) return ''
    return Context.run(ctx, () => {
      statement.options?.remove('DEFINER')
      return statement.build()
    })
  }

  override async exportRoutines(db: string, aliases: Aliases = {}): Promise<void> {
    if (!this.hasCreateProcedureFunction) return
    let text = ''
    const delimiter = '$$'
    const names = (type: string) =>
      this.ctx.dbi.fetchSingleColumn(
        `SELECT SPECIFIC_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${this.ctx.dbi.quoteString(db)} AND ROUTINE_TYPE = '${type}' AND SPECIFIC_NAME != ''`,
      )
    const procedureNames = await names('PROCEDURE')
    const functionNames = await names('FUNCTION')
    if (procedureNames.length > 0 || functionNames.length > 0) {
      text += `\nDELIMITER ${delimiter}\n`
      if (procedureNames.length > 0) {
        text += await this.#exportRoutineSQL(
          db,
          aliases,
          'PROCEDURE',
          this.__('Procedures'),
          procedureNames,
          delimiter,
        )
      }
      if (functionNames.length > 0) {
        text += await this.#exportRoutineSQL(
          db,
          aliases,
          'FUNCTION',
          this.__('Functions'),
          functionNames,
          delimiter,
        )
      }
      text += 'DELIMITER ;\n'
    }
    if (text === '') return
    await this.addLine(text)
  }

  override async exportEvents(db: string): Promise<void> {
    if (!this.hasCreateProcedureFunction) return
    let text = ''
    const delimiter = '$$'
    const eventNames = await this.ctx.dbi.fetchSingleColumn(
      `SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA= ${this.ctx.dbi.quoteString(db)}`,
    )
    if (eventNames.length > 0) {
      text += `\nDELIMITER ${delimiter}\n`
      text += this.#exportComment() + this.#exportComment(this.__('Events')) + this.#exportComment()
      for (const eventName of eventNames) {
        if (this.dropTable) text += `DROP EVENT IF EXISTS ${backquote(eventName)}${delimiter}\n`
        const v = await this.ctx.dbi.fetchValue(
          `SHOW CREATE EVENT ${backquote(db)}.${backquote(eventName)}`,
          'Create Event',
        )
        let eventDef = typeof v === 'string' ? v : ''
        if (eventDef !== '' && this.ctx.settings.remove_definer_from_definitions === true) {
          eventDef = this.#removeDefiner(`DELIMITER ${delimiter}\n${eventDef}`)
        }
        text += `${eventDef}${delimiter}\n\n`
      }
      text += 'DELIMITER ;\n'
    }
    if (text === '') return
    await this.addLine(text)
  }

  // ------------------------------------------------------------------ header / footer

  override async exportFooter(): Promise<void> {
    let foot = ''
    if (this.disableForeignKey) foot += 'SET FOREIGN_KEY_CHECKS=1;\n'
    if (this.useTransaction) foot += 'COMMIT;\n'
    // restore connection settings
    if (this.#sentCharset) {
      foot +=
        '\n/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;\n' +
        '/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;\n' +
        '/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;\n'
      this.#sentCharset = false
    }
    /* Restore timezone */
    if (this.utcTime) await this.ctx.dbi.query(`SET time_zone = "${ExportSql.oldTimezone}"`)
    await this.addLine(foot)
  }

  override async exportHeader(): Promise<void> {
    await this.ctx.dbi.tryQuery(`SET SQL_MODE="${this.compatibility !== 'NONE' ? this.compatibility : ''}"`)
    const { tool } = this.ctx
    let head =
      this.#exportComment(`${tool.name} SQL Dump`) +
      this.#exportComment(`version ${tool.version}`) +
      this.#exportComment(tool.url) +
      this.#exportComment()
    let hostString = `${this.__('Host:')} ${this.ctx.host}`
    if (this.ctx.port !== '' && this.ctx.port !== '0') hostString += `:${this.ctx.port}`
    head += this.#exportComment(hostString)
    head +=
      this.#exportComment(
        `${this.__('Generation Time:')} ${localisedDate(this.ctx.tr, Math.floor(this.ctx.now.getTime() / 1000), '', this.ctx.timeZone)}`,
      ) +
      this.#exportComment(`${this.__('Server version:')} ${this.ctx.dbi.versionString}`) +
      this.#exportComment(`${tool.runtimeLabel} ${tool.runtime}`) +
      this.#possibleCRLF()

    if (this.headerComment !== '') {
      // '\n' is not a newline (like "\n" would be), it's the characters
      // backslash and n, as explained on the export interface
      head += this.#exportComment()
      for (const oneLine of this.headerComment.split('\\n')) head += this.#exportComment(oneLine)
      head += this.#exportComment()
    }
    if (this.disableForeignKey) head += 'SET FOREIGN_KEY_CHECKS=0;\n'
    // We want exported AUTO_INCREMENT columns to have still same value,
    // do this only for recent MySQL exports
    if (this.compatibility === 'NONE') head += 'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n'
    if (this.useTransaction) head += 'START TRANSACTION;\n'
    /* Change timezone if we should export timestamps in UTC */
    if (this.utcTime) {
      head += 'SET time_zone = "+00:00";\n'
      const tz = await this.ctx.dbi.fetchValue('SELECT @@session.time_zone')
      ExportSql.oldTimezone = typeof tz === 'string' ? tz : ''
      await this.ctx.dbi.query('SET time_zone = "+00:00"')
    }
    head += this.#possibleCRLF()

    if (this.ctx.out.asFile) {
      // we are saving as file, therefore we provide charset information
      // so that a utility like the mysql client can interpret
      // the file correctly
      const cs = this.ctx.charset
      let setNames =
        cs !== null && MYSQL_CHARSET_MAP[cs] !== undefined
          ? (MYSQL_CHARSET_MAP[cs] as string)
          : (MYSQL_CHARSET_MAP['utf-8'] as string)
      if (setNames === 'utf8') setNames = this.ctx.dbi.versionInt > 50503 ? 'utf8mb4' : 'utf8'
      head +=
        '\n/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n' +
        '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;\n' +
        '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;\n' +
        `/*!40101 SET NAMES ${setNames} */;\n\n`
      this.#sentCharset = true
    }
    await this.addLine(head)
  }

  override async exportDBCreate(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    if (this.includeStructure() && this.dropDatabase) {
      await this.addLine(
        `DROP DATABASE IF EXISTS ${this.#bqc(dbAlias, this.compatibility, this.useSqlBackquotes)};\n`,
      )
    }
    if (this.ctx.exportType === 'database' && !this.createDatabase) return
    // Skip CREATE DATABASE when only exporting data
    if (!this.includeStructure()) {
      await this.#exportUseStatement(dbAlias, this.compatibility)
      return
    }
    let createQuery = `CREATE DATABASE IF NOT EXISTS ${this.#bqc(dbAlias, this.compatibility, this.useSqlBackquotes)}`
    const collation = await this.ctx.tables.getDbCollation(db)
    if (collation.includes('_')) {
      createQuery += ` DEFAULT CHARACTER SET ${collation.slice(0, collation.indexOf('_'))} COLLATE ${collation}`
    } else {
      createQuery += ` DEFAULT CHARACTER SET ${collation}`
    }
    createQuery += ';\n'
    await this.addLine(createQuery)
    await this.#exportUseStatement(dbAlias, this.compatibility)
  }

  async #exportUseStatement(db: string, compat: string): Promise<void> {
    if (compat === 'NONE') {
      await this.addLine(`USE ${this.#bqc(db, compat, this.useSqlBackquotes)};\n`)
      return
    }
    await this.addLine(`USE ${db};\n`)
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    const head =
      this.#exportComment() +
      this.#exportComment(
        `${this.__('Database:')} ${this.#bqc(dbAlias, this.compatibility, this.useSqlBackquotes)}`,
      ) +
      this.#exportComment()
    await this.addLine(head)
  }

  override async exportDBFooter(_db: string): Promise<void> {
    //add indexes to the sql dump file
    if (this.sqlIndexes !== null) {
      await this.addLine(this.sqlIndexes)
      this.sqlIndexes = null
    }
    //add auto increments to the sql dump file
    if (this.sqlAutoIncrements !== null) {
      await this.addLine(this.sqlAutoIncrements)
      this.sqlAutoIncrements = null
    }
    //add views to the sql dump file
    if (this.#sqlViews !== '') {
      await this.addLine(this.#sqlViews)
      this.#sqlViews = ''
    }
    //add constraints to the sql dump file
    if (this.sqlConstraints === null) return
    await this.addLine(this.sqlConstraints)
    this.sqlConstraints = null
  }

  // ------------------------------------------------------------------ metadata

  override async exportMetadata(
    db: string,
    tables: string | string[],
    metadataTypes: string[],
  ): Promise<void> {
    if (!this.hasMetadata) return
    const rel = this.ctx.relation
    if (rel.pmadb === null) return
    const comment =
      this.#possibleCRLF() +
      this.#possibleCRLF() +
      this.#exportComment() +
      this.#exportComment(this.__('Metadata')) +
      this.#exportComment()
    await this.addLine(comment)
    await this.#exportUseStatement(rel.pmadb, this.compatibility)
    if (Array.isArray(tables)) {
      for (const table of tables) await this.#exportConfigurationMetadata(db, table, metadataTypes)
      // export metadata for the database
      await this.#exportConfigurationMetadata(db, null, metadataTypes)
      return
    }
    // export metadata for single table
    await this.#exportConfigurationMetadata(db, tables, metadataTypes)
  }

  async #exportConfigurationMetadata(
    db: string,
    table: string | null,
    metadataTypes: string[],
  ): Promise<void> {
    const rel = this.ctx.relation
    const pmadb = rel.pmadb as string
    const q = (s: string) => this.ctx.dbi.quoteString(s)
    const types: Array<[string, string]> =
      table !== null
        ? [
            ['column_info', 'db_name'],
            ['table_uiprefs', 'db_name'],
            ['tracking', 'db_name'],
          ]
        : [
            ['bookmark', 'dbase'],
            ['relation', 'master_db'],
            ['pdf_pages', 'db_name'],
            ['savedsearches', 'db_name'],
            ['central_columns', 'db_name'],
          ]
    const aliases: Aliases = {}
    let comment = this.#possibleCRLF() + this.#exportComment()
    comment +=
      table !== null
        ? this.#exportComment(sprintf(this.__('Metadata for table %s'), table))
        : this.#exportComment(sprintf(this.__('Metadata for database %s'), db))
    comment += this.#exportComment()
    await this.addLine(comment)

    for (const [type, dbNameColumn] of types) {
      const tableName = rel.tables[type]
      if (!metadataTypes.includes(type) || tableName === null || tableName === undefined) continue
      // special case, designer pages and their coordinates
      if (type === 'pdf_pages') {
        const pdf = rel.pdfFeature
        if (pdf === null) continue
        const pages = await this.ctx.dbi.fetchResultSimple(
          `SELECT \`page_nr\`, \`page_descr\` FROM ${backquote(pmadb)}.${backquote(pdf.pdfPages)} WHERE \`db_name\` = ${q(db)}`,
        )
        for (const pageRow of pages) {
          const page = pageRow.page_nr ?? ''
          // insert row for pdf_page
          const sqlQueryRow = `SELECT \`db_name\`, \`page_descr\` FROM ${backquote(pmadb)}.${backquote(pdf.pdfPages)} WHERE \`db_name\` = ${q(db)} AND \`page_nr\` = ${Number.parseInt(page, 10) || 0}`
          await this.exportData(pmadb, pdf.pdfPages, sqlQueryRow, aliases)
          await this.addLine('\nSET @LAST_PAGE = LAST_INSERT_ID();\n')
          const sqlQueryCoords = `SELECT \`db_name\`, \`table_name\`, '@LAST_PAGE' AS \`pdf_page_number\`, \`x\`, \`y\` FROM ${backquote(pmadb)}.${backquote(pdf.tableCoords)} WHERE \`pdf_page_number\` = '${page}'`
          ExportSql.#exportingMetadata = true
          await this.exportData(pmadb, pdf.tableCoords, sqlQueryCoords, aliases)
          ExportSql.#exportingMetadata = false
        }
        continue
      }
      // remove auto_incrementing id field for some tables
      let sqlQuery =
        type === 'bookmark'
          ? 'SELECT `dbase`, `user`, `label`, `query` FROM '
          : type === 'column_info'
            ? 'SELECT `db_name`, `table_name`, `column_name`, `comment`, `mimetype`, `transformation`, `transformation_options`, `input_transformation`, `input_transformation_options` FROM '
            : type === 'savedsearches'
              ? 'SELECT `username`, `db_name`, `search_name`, `search_data` FROM '
              : 'SELECT * FROM '
      sqlQuery += `${backquote(pmadb)}.${backquote(tableName)} WHERE ${backquote(dbNameColumn)} = ${q(db)}`
      if (table !== null) sqlQuery += ` AND \`table_name\` = ${q(table)}`
      await this.exportData(pmadb, tableName, sqlQuery, aliases)
    }
  }

  // ------------------------------------------------------------------ structure

  /** Returns a stand-in CREATE definition to resolve view dependencies */
  async getTableDefStandIn(db: string, view: string, aliases: Aliases = {}): Promise<string> {
    const viewAlias = this.getTableAlias(aliases, db, view)
    let createQuery = ''
    if (this.dropTable) createQuery += `DROP VIEW IF EXISTS ${backquote(viewAlias)};\n`
    createQuery += 'CREATE TABLE '
    if (this.ifNotExists) createQuery += 'IF NOT EXISTS '
    createQuery += `${backquote(viewAlias)} (\n`
    const tmp: string[] = []
    for (const column of await this.ctx.tables.getColumns(db, view)) {
      const colAlias = this.getColumnAlias(aliases, db, view, column.field)
      tmp.push(`${backquote(colAlias)} ${column.type}\n`)
    }
    return `${createQuery}${tmp.join(',')});\n`
  }

  /** Returns CREATE definition that matches $view's structure */
  async #getTableDefForView(db: string, view: string, aliases: Aliases = {}): Promise<string> {
    const viewAlias = this.getTableAlias(aliases, db, view)
    let createQuery = 'CREATE TABLE'
    if (this.ifNotExists) createQuery += ' IF NOT EXISTS '
    createQuery += `${backquote(viewAlias)}(\n`
    let firstCol = true
    for (const column of await this.ctx.tables.getColumns(db, view)) {
      const colAlias = this.getColumnAlias(aliases, db, view, column.field)
      const spec = extractColumnSpec(column.type)
      if (!firstCol) createQuery += ',\n'
      createQuery += `    ${backquote(colAlias)}`
      createQuery += ` ${column.type}`
      if (spec.can_contain_collation && column.collation !== null && column.collation !== '') {
        createQuery += ` COLLATE ${column.collation}`
      }
      if (!column.isNull) createQuery += ' NOT NULL'
      if (column.default !== null) createQuery += ` DEFAULT ${this.ctx.dbi.quoteString(column.default)}`
      else if (column.isNull) createQuery += ' DEFAULT NULL'
      if (column.comment !== '') createQuery += ` COMMENT ${this.ctx.dbi.quoteString(column.comment)}`
      firstCol = false
    }
    createQuery += '\n);\n'
    if (this.compatibility === 'MSSQL') return this.#makeCreateTableMSSQLCompatible(createQuery)
    return createQuery
  }

  /** Returns $table's CREATE definition */
  async getTableDef(
    db: string,
    table: string,
    addSemicolon = true,
    view = false,
    updateIndexesIncrements = true,
    aliases: Aliases = {},
  ): Promise<string> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    let schemaCreate = await this.#getTableStatus(db, table)
    const isView = await this.ctx.tables.isView(db, table)
    if (this.dropTable && isView) {
      schemaCreate += `DROP VIEW IF EXISTS ${this.#bqc(tableAlias, 'NONE', this.useSqlBackquotes)};\n`
    }
    // no need to generate a DROP VIEW here, it was done earlier
    if (this.dropTable && !isView) {
      schemaCreate += `DROP TABLE IF EXISTS ${this.#bqc(tableAlias, 'NONE', this.useSqlBackquotes)};\n`
    }
    // Complete table dump,
    // Whether to quote table and column names or not
    await this.ctx.dbi.query(`SET SQL_QUOTE_SHOW_CREATE = ${this.useSqlBackquotes ? 1 : 0}`)
    await this.ctx.dbi.tryQuery(`USE ${backquote(db)}`)
    const result = await this.ctx.dbi.select(`SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`, false)
    // an error can happen, for example the table is crashed
    const tmpError = this.ctx.dbi.getError()
    if (tmpError !== '') {
      throw new ExportError(
        `${sprintf(this.__('Error reading structure for table %s:'), `${db}.${table}`)} ${tmpError}`,
      )
    }
    let warning = ''
    let row: Array<string | null> | null = null
    if (result !== null) {
      for await (const r of result.rows) {
        row ??= r
      }
    }
    if (row !== null) {
      let createQuery = row[1] ?? ''
      // Convert end of line chars to one that we want (note that MySQL
      // doesn't return query it will accept in all cases)
      if (createQuery.includes('(\r\n ')) createQuery = createQuery.replaceAll('\r\n', '\n')
      else if (createQuery.includes('(\r ')) createQuery = createQuery.replaceAll('\r', '\n')

      /**
       * Drop database name from VIEW creation.
       *
       * This is a bit tricky, but we need to issue SHOW CREATE TABLE with
       * database name, but we don't want name to show up in CREATE VIEW
       * statement.
       */
      if (view) {
        createQuery = createQuery.split(`${backquote(db)}.`).join('')
        const { statement, ctx } = this.#parse(createQuery)
        createQuery = Context.run(ctx, () => {
          const st = statement as CreateStatement
          // exclude definition of current user
          if (this.ctx.settings.remove_definer_from_definitions === true || this.viewCurrentUser) {
            st.options?.remove('DEFINER')
          }
          if (this.simpleViewExport) {
            st.options?.remove('SQL SECURITY')
            st.options?.remove('INVOKER')
            st.options?.remove('ALGORITHM')
            st.options?.remove('DEFINER')
          }
          return st.build()
        })
        // whether to replace existing view or not
        if (this.orReplaceView) createQuery = createQuery.replace(/^CREATE/, 'CREATE OR REPLACE')
      }

      // Substitute aliases in `CREATE` query.
      const flag = { value: false }
      createQuery = this.replaceWithAliases('', createQuery, aliases, db, flag)
      // One warning per view.
      if (flag.value && view) {
        warning =
          this.#exportComment() +
          this.#exportComment(this.__('It appears your database uses views;')) +
          this.#exportComment(this.__('alias export may not work reliably in all cases.')) +
          this.#exportComment()
      }
      // Adding IF NOT EXISTS, if required.
      if (this.ifNotExists) createQuery = createQuery.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS')
      // Making the query MSSQL compatible.
      if (this.compatibility === 'MSSQL') createQuery = this.#makeCreateTableMSSQLCompatible(createQuery)

      // Views have no constraints, indexes, etc. They do not require any analysis.
      let extraMode = 0
      if (!view) {
        // Option "Enclose table and column names with backquotes" was checked.
        if (!this.useSqlBackquotes) extraMode |= SqlMode.NO_ENCLOSING_QUOTES
        // Using appropriate quotes.
        if (this.compatibility === 'MSSQL') extraMode |= SqlMode.ANSI_QUOTES
      }

      // Parser used for analysis.
      const { statement: st0, ctx } = this.#parse(createQuery, extraMode)
      const statement = st0 as CreateStatement
      createQuery = Context.run(ctx, () => {
        const engine = statement.entityOptions !== null ? String(statement.entityOptions.get('ENGINE')) : ''
        /* Avoid operation on ARCHIVE tables as those can not be altered */
        if (
          Array.isArray(statement.fields) &&
          statement.fields.length > 0 &&
          (engine === '' || engine.toUpperCase() !== 'ARCHIVE')
        ) {
          /** Fragments containing definition of each constraint. */
          const constraints: string[] = []
          /** Fragments containing definition of each index. */
          const indexes: string[] = []
          /** Fragments containing definition of each FULLTEXT index. */
          const indexesFulltext: string[] = []
          /** Fragment containing definition of the `AUTO_INCREMENT`. */
          const autoIncrement: string[] = []
          const removed = new Set<CreateDefinition>()

          // Scanning each field of the `CREATE` statement to fill the arrays above.
          // If the field is used in any of the arrays above, it is removed
          // from the original definition.
          // Also, AUTO_INCREMENT attribute is removed.
          for (const field of statement.fields) {
            if (field.isConstraint) {
              // Creating the parts that add constraints.
              constraints.push(field.build())
              removed.add(field)
            } else if (field.key !== null) {
              // Creating the parts that add indexes (must not be constraints).
              if (field.key.type === 'FULLTEXT KEY') {
                indexesFulltext.push(field.build())
                removed.add(field)
              } else if (!this.ifNotExists) {
                indexes.push(field.build().replaceAll("COMMENT='", "COMMENT '"))
                removed.add(field)
              }
            }
            // Creating the parts that drop foreign keys.
            if (field.key !== null && field.key.type === 'FOREIGN KEY' && field.name !== null) {
              removed.add(field)
            }
            // Dropping AUTO_INCREMENT.
            if (field.options === null) continue
            if (!field.options.has('AUTO_INCREMENT') || this.ifNotExists) continue
            autoIncrement.push(field.build())
            field.options.remove('AUTO_INCREMENT')
          }
          statement.fields = statement.fields.filter((f) => !removed.has(f))

          /** The header of the `ALTER` statement (`ALTER TABLE tbl`). */
          const alterHeader = `ALTER TABLE ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)}`
          /** The footer of the `ALTER` statement (usually ';') */
          const alterFooter = ';\n'

          // Generating constraints-related query.
          if (constraints.length > 0) {
            this.sqlConstraintsQuery = `${alterHeader}\n  ADD ${constraints.join(',\n  ADD ')}${alterFooter}`
            this.sqlConstraints =
              this.#generateComment(
                this.sqlConstraints,
                this.__('Constraints for dumped tables'),
                this.__('Constraints for table'),
                tableAlias,
                this.compatibility,
              ) + this.sqlConstraintsQuery
          }
          // Generating indexes-related query.
          let indexesQuery = ''
          if (indexes.length > 0) {
            indexesQuery += `${alterHeader}\n  ADD ${indexes.join(',\n  ADD ')}${alterFooter}`
          }
          if (indexesFulltext.length > 0) {
            // InnoDB supports one FULLTEXT index creation at a time.
            // So FULLTEXT indexes are created one-by-one after other
            // indexes where created.
            indexesQuery += `${alterHeader} ADD ${indexesFulltext.join(`${alterFooter}${alterHeader} ADD `)}${alterFooter}`
          }
          if (indexes.length > 0 || indexesFulltext.length > 0) {
            this.sqlIndexes =
              this.#generateComment(
                this.sqlIndexes,
                this.__('Indexes for dumped tables'),
                this.__('Indexes for table'),
                tableAlias,
                this.compatibility,
              ) + indexesQuery
          }
          // Generating auto-increment-related query.
          if (autoIncrement.length > 0 && updateIndexesIncrements) {
            let sqlAutoIncrementsQuery = `${alterHeader}\n  MODIFY ${autoIncrement.join(',\n  MODIFY ')}`
            if (
              this.autoIncrement &&
              statement.entityOptions?.has('AUTO_INCREMENT') === true &&
              (this.ctx.tableData.length === 0 || this.ctx.tableData.includes(table))
            ) {
              sqlAutoIncrementsQuery += `, AUTO_INCREMENT=${String(statement.entityOptions.get('AUTO_INCREMENT'))}`
            }
            sqlAutoIncrementsQuery += ';\n'
            this.sqlAutoIncrements =
              this.#generateComment(
                this.sqlAutoIncrements,
                this.__('AUTO_INCREMENT for dumped tables'),
                this.__('AUTO_INCREMENT for table'),
                tableAlias,
                this.compatibility,
              ) + sqlAutoIncrementsQuery
          }
          // Removing the `AUTO_INCREMENT` attribute from the `CREATE TABLE` too.
          if (statement.entityOptions !== null && (!this.ifNotExists || !this.autoIncrement)) {
            statement.entityOptions.remove('AUTO_INCREMENT')
          }
          // Rebuilding the query.
          return statement.build()
        }
        return createQuery
      })
      schemaCreate += createQuery
    }
    return warning + schemaCreate + (addSemicolon ? ';\n' : '')
  }

  /** Returns $table's comments, relations etc. */
  async #getTableComments(db: string, table: string, aliases: Aliases = {}): Promise<string> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    const rel = this.ctx.relation
    let schemaCreate = ''
    let mimeMap: Record<string, { mimetype: string }> | null = null
    if (this.doMime && rel.browserTransformationFeature) mimeMap = await rel.getMime(db, table)
    if (mimeMap !== null && Object.keys(mimeMap).length > 0) {
      schemaCreate +=
        this.#possibleCRLF() +
        this.#exportComment() +
        this.#exportComment(
          `${this.__('MEDIA TYPES FOR TABLE')} ${this.#bqc(table, 'NONE', this.useSqlBackquotes)}:`,
        )
      for (const [mimeField, mime] of Object.entries(mimeMap)) {
        schemaCreate +=
          this.#exportComment(`  ${this.#bqc(mimeField, 'NONE', this.useSqlBackquotes)}`) +
          this.#exportComment(`      ${this.#bqc(mime.mimetype, 'NONE', this.useSqlBackquotes)}`)
      }
      schemaCreate += this.#exportComment()
    }
    // Check if we can use Relations
    const foreigners =
      this.doRelation && rel.relationFeature ? await rel.getForeignersInternal(db, table) : {}
    if (Object.keys(foreigners).length > 0) {
      schemaCreate +=
        this.#possibleCRLF() +
        this.#exportComment() +
        this.#exportComment(
          `${this.__('RELATIONSHIPS FOR TABLE')} ${this.#bqc(tableAlias, 'NONE', this.useSqlBackquotes)}:`,
        )
      for (const [relField, r] of Object.entries(foreigners)) {
        const relFieldAlias = this.getColumnAlias(aliases, db, table, relField)
        schemaCreate +=
          this.#exportComment(`  ${this.#bqc(relFieldAlias, 'NONE', this.useSqlBackquotes)}`) +
          this.#exportComment(
            `      ${this.#bqc(r.foreign_table, 'NONE', this.useSqlBackquotes)} -> ${this.#bqc(r.foreign_field, 'NONE', this.useSqlBackquotes)}`,
          )
      }
      for (const oneKey of await rel.getForeignKeysData(db, table)) {
        oneKey.indexList.forEach((field, index) => {
          const relFieldAlias = this.getColumnAlias(aliases, db, table, field)
          schemaCreate +=
            this.#exportComment(`  ${this.#bqc(relFieldAlias, 'NONE', this.useSqlBackquotes)}`) +
            this.#exportComment(
              `      ${this.#bqc(oneKey.refTableName, 'NONE', this.useSqlBackquotes)} -> ${this.#bqc(oneKey.refIndexList[index] ?? '', 'NONE', this.useSqlBackquotes)}`,
            )
        })
      }
      schemaCreate += this.#exportComment()
    }
    return schemaCreate
  }

  override async exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    if (db !== '') await this.ctx.dbi.selectDb(db)
    await this.exportData(db, '', sqlQuery)
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    const formattedTableName = this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)
    let dump =
      this.#possibleCRLF() +
      this.#exportComment('-'.repeat(56)) +
      this.#possibleCRLF() +
      this.#exportComment()

    switch (exportMode) {
      case 'create_table':
        if (!this.hasCreateTable) return
        dump += this.#exportComment(`${this.__('Table structure for table')} ${formattedTableName}`)
        dump += this.#exportComment()
        dump += await this.getTableDef(db, table, true, false, true, aliases)
        dump += await this.#getTableComments(db, table, aliases)
        break
      case 'triggers': {
        if (!this.hasCreateTrigger) return
        dump = ''
        const delimiter = '$$'
        const triggers = await this.ctx.tables.getTriggers(db, table)
        if (triggers.length > 0) {
          dump +=
            this.#possibleCRLF() +
            this.#exportComment() +
            this.#exportComment(`${this.__('Triggers')} ${formattedTableName}`) +
            this.#exportComment()
          let usedAlias = false
          let triggerQuery = ''
          for (const trigger of triggers) {
            if (this.dropTable) triggerQuery += `DROP TRIGGER IF EXISTS ${backquote(trigger.name)};\n`
            const flag = { value: false }
            triggerQuery += `DELIMITER ${delimiter}\n`
            triggerQuery += this.replaceWithAliases(
              delimiter,
              `CREATE TRIGGER ${backquote(trigger.name)} ${trigger.timing} ${trigger.event} ON ${backquote(trigger.table)}\n FOR EACH ROW ${trigger.statement}\n${delimiter}\n`,
              aliases,
              db,
              flag,
            )
            if (flag.value) usedAlias = true
            triggerQuery += `${delimiter}\nDELIMITER ;\n`
          }
          // One warning per table.
          if (usedAlias) {
            dump +=
              this.#exportComment(this.__('It appears your table uses triggers;')) +
              this.#exportComment(this.__('alias export may not work reliably in all cases.')) +
              this.#exportComment()
          }
          dump += triggerQuery
        }
        break
      }
      case 'create_view':
        if (!this.hasCreateView) return
        if (!this.viewsAsTables) {
          dump +=
            this.#exportComment(`${this.__('Structure for view')} ${formattedTableName}`) +
            this.#exportComment()
          // delete the stand-in table previously created (if any)
          if (this.ctx.exportType !== 'table') dump += `DROP TABLE IF EXISTS ${backquote(tableAlias)};\n`
          dump += await this.getTableDef(db, table, true, true, true, aliases)
        } else {
          dump +=
            this.#exportComment(
              sprintf(this.__('Structure for view %s exported as a table'), formattedTableName),
            ) + this.#exportComment()
          // delete the stand-in table previously created (if any)
          if (this.ctx.exportType !== 'table') dump += `DROP TABLE IF EXISTS ${backquote(tableAlias)};\n`
          dump += await this.#getTableDefForView(db, table, aliases)
        }
        if (!this.viewsAsTables) {
          // Save views, to be inserted after indexes
          // in case the view uses USE INDEX syntax
          this.#sqlViews += dump
          dump = ''
        }
        break
      case 'stand_in':
        if (!this.hasCreateView) return
        dump +=
          this.#exportComment(`${this.__('Stand-in structure for view')} ${formattedTableName}`) +
          this.#exportComment(this.__('(See below for the actual view)')) +
          this.#exportComment()
        // export a stand-in definition to resolve view dependencies
        dump += await this.getTableDefStandIn(db, table, aliases)
    }
    // this one is built by getTableDef() to use in table copy/move
    // but not in the case of export
    this.sqlConstraintsQuery = ''
    await this.addLine(dump)
  }

  // ------------------------------------------------------------------ data

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    // Do not export data for merge tables
    if (await this.ctx.tables.isMerge(db, table)) return
    const tableAlias = this.getTableAlias(aliases, db, table)
    const formattedTableName = this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)

    // Do not export data for a VIEW, unless asked to export the view as a table
    // (For a VIEW, this is called only when exporting a single VIEW)
    if ((await this.ctx.tables.isView(db, table)) && !this.viewsAsTables) {
      const head =
        this.#possibleCRLF() +
        this.#exportComment() +
        this.#exportComment(`VIEW ${formattedTableName}`) +
        this.#exportComment(`${this.__('Data:')} ${this.__('None')}`) +
        this.#exportComment() +
        this.#possibleCRLF()
      await this.addLine(head)
      return
    }

    const result = await this.ctx.dbi.select(sqlQuery, true)
    // a possible error: the table has crashed
    const tmpError = this.ctx.dbi.getError()
    if (tmpError !== '') {
      throw new ExportError(
        `${sprintf(this.__('Error reading data for table %s:'), `${db}.${table}`)} ${tmpError}`,
      )
    }
    if (result === null) return

    const fieldsMeta = result.fields
    const fieldsCnt = fieldsMeta.length
    const fieldSet = fieldsMeta.map((f) =>
      this.#bqc(this.getColumnAlias(aliases, db, table, f.name), this.compatibility, this.useSqlBackquotes),
    )

    let schemaInsert: string
    if (this.type === 'UPDATE') {
      // update
      schemaInsert = 'UPDATE '
      if (this.ignore) schemaInsert += 'IGNORE '
      // avoid EOL blank
      schemaInsert += `${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)} SET`
    } else {
      // insert or replace
      const sqlCommand = this.type === 'REPLACE' ? 'REPLACE' : 'INSERT'
      // delayed inserts?
      let insertDelayed = this.delayed ? ' DELAYED' : ''
      // insert ignore?
      if (this.ignore && this.type === 'INSERT') insertDelayed += ' IGNORE'
      //truncate table before insert
      if (this.truncate && sqlCommand === 'INSERT') {
        const truncate = `TRUNCATE TABLE ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)};`
        const truncatehead =
          this.#possibleCRLF() +
          this.#exportComment() +
          this.#exportComment(`${this.__('Truncate table before insert')} ${formattedTableName}`) +
          this.#exportComment() +
          '\n'
        await this.addLine(truncatehead)
        await this.addLine(truncate)
      }
      // scheme for inserting fields
      if (this.insertSyntax === 'complete' || this.insertSyntax === 'both') {
        const fields = fieldSet.join(', ')
        schemaInsert = `${sqlCommand}${insertDelayed} INTO ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)} (${fields}) VALUES`
      } else {
        schemaInsert = `${sqlCommand}${insertDelayed} INTO ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)} VALUES`
      }
    }

    let currentRow = 0
    let querySize = 0
    let separator: string
    if ((this.insertSyntax === 'extended' || this.insertSyntax === 'both') && this.type !== 'UPDATE') {
      separator = ','
      schemaInsert += '\n'
    } else {
      separator = ';'
    }

    for await (const row of result.rows) {
      if (currentRow === 0) {
        const head =
          this.#possibleCRLF() +
          this.#exportComment() +
          this.#exportComment(`${this.__('Dumping data for table')} ${formattedTableName}`) +
          this.#exportComment() +
          '\n'
        await this.addLine(head)
      }
      // We need to SET IDENTITY_INSERT ON for MSSQL
      if (currentRow === 0 && this.compatibility === 'MSSQL') {
        await this.addLine(
          `SET IDENTITY_INSERT ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)} ON ;\n`,
        )
      }
      currentRow++
      const values: string[] = []
      fieldsMeta.forEach((metaInfo, j) => {
        const v = row[j] ?? null
        if (v === null) values.push('NULL')
        else if (metaInfo.isNumeric) values.push(v)
        else if (metaInfo.isBinary && this.hexForBinary) {
          // empty blobs need to be different, but '0' is also empty :-(
          values.push(v === '' ? "''" : `0x${hexBytes(v)}`)
        } else if (metaInfo.isMappedTypeBit) {
          // detection of 'bit' works only on mysqli extension
          values.push(`b'${printableBitValue(v, metaInfo.length)}'`)
        } else if (metaInfo.isMappedTypeGeometry) {
          // export GIS types as hex
          values.push(`0x${hexBytes(v)}`)
        } else if (ExportSql.#exportingMetadata && v === '@LAST_PAGE') {
          values.push('@LAST_PAGE')
        } else if (v === '') {
          values.push("''")
        } else {
          // something else -> treat as a string
          values.push(this.ctx.dbi.quoteString(v))
        }
      })

      let insertLine: string
      // should we make update?
      if (this.type === 'UPDATE') {
        insertLine = schemaInsert
        for (let i = 0; i < fieldsCnt; i++) {
          if (i === 0) insertLine += ' '
          // avoid EOL blank
          if (i > 0) insertLine += ','
          insertLine += `${fieldSet[i]} = ${values[i]}`
        }
        const cells = row.map((c, i) =>
          c === null ? null : fieldsMeta[i]?.isMappedTypeBit === true ? c : encodeBytes(c),
        )
        insertLine += ` WHERE ${getUniqueCondition(fieldsMeta, cells).condition}`
      } else if (this.insertSyntax === 'extended' || this.insertSyntax === 'both') {
        // Extended inserts case
        if (currentRow === 1) {
          insertLine = `${schemaInsert}(${values.join(', ')})`
        } else {
          insertLine = `(${values.join(', ')})`
          const insertLineSize = mbStrlen(insertLine)
          if (this.maxQuerySize > 0 && querySize + insertLineSize > this.maxQuerySize) {
            await this.addLine(';\n')
            querySize = 0
            currentRow = 1
            insertLine = schemaInsert + insertLine
          }
        }
        querySize += mbStrlen(insertLine)
      } else {
        // Other inserts case
        insertLine = `${schemaInsert}(${values.join(', ')})`
      }
      await this.addLine((currentRow === 1 ? '' : `${separator}\n`) + insertLine)
    }
    if (currentRow > 0) await this.addLine(';\n')
    // We need to SET IDENTITY_INSERT OFF for MSSQL
    if (this.compatibility !== 'MSSQL' || currentRow <= 0) return
    await this.addLine(
      `\nSET IDENTITY_INSERT ${this.#bqc(tableAlias, this.compatibility, this.useSqlBackquotes)} OFF;\n`,
    )
  }

  /** Make a create table statement compatible with MSSQL */
  #makeCreateTableMSSQLCompatible(createQuery0: string): string {
    // In MSSQL
    // 1. No 'IF NOT EXISTS' in CREATE TABLE
    // 2. DATE field doesn't exists, we will use DATETIME instead
    // 3. UNSIGNED attribute doesn't exist
    // 4. No length on INT, TINYINT, SMALLINT, BIGINT and no precision on FLOAT fields
    // 5. No KEY and INDEX inside CREATE TABLE
    // 6. DOUBLE field doesn't exists, we will use FLOAT instead
    let q = createQuery0.replace(/^CREATE TABLE IF NOT EXISTS/, 'CREATE TABLE')
    // first we need  to replace all lines ended with '" DATE ...,\n'
    // last preg_replace preserve us from situation with date text
    // inside DEFAULT field value
    q = q.replace(/" date DEFAULT NULL(,)?\n/g, (_m, c?: string) => `" datetime DEFAULT NULL${c ?? ''}\n`)
    q = q.replace(/" date NOT NULL(,)?\n/g, (_m, c?: string) => `" datetime NOT NULL${c ?? ''}\n`)
    q = q.replace(/" date NOT NULL DEFAULT '([^'])/g, `" datetime NOT NULL DEFAULT '$1`)
    // next we need to replace all lines ended with ') UNSIGNED ...,'
    // last preg_replace preserve us from situation with unsigned text
    // inside DEFAULT field value
    q = q.replace(/\) unsigned NOT NULL(,)?\n/g, (_m, c?: string) => `) NOT NULL${c ?? ''}\n`)
    q = q.replace(/\) unsigned DEFAULT NULL(,)?\n/g, (_m, c?: string) => `) DEFAULT NULL${c ?? ''}\n`)
    q = q.replace(/\) unsigned NOT NULL DEFAULT '([^'])/g, `) NOT NULL DEFAULT '$1`)
    // we need to replace all lines ended with
    // '" INT|TINYINT([0-9]{1,}) ...,' last preg_replace preserve us
    // from situation with int([0-9]{1,}) text inside DEFAULT field value
    q = q.replace(
      /" (int|tinyint|smallint|bigint)\([0-9]+\) DEFAULT NULL(,)?\n/g,
      (_m, t: string, c?: string) => `" ${t} DEFAULT NULL${c ?? ''}\n`,
    )
    q = q.replace(
      /" (int|tinyint|smallint|bigint)\([0-9]+\) NOT NULL(,)?\n/g,
      (_m, t: string, c?: string) => `" ${t} NOT NULL${c ?? ''}\n`,
    )
    q = q.replace(
      /" (int|tinyint|smallint|bigint)\([0-9]+\) NOT NULL DEFAULT '([^'])/g,
      `" $1 NOT NULL DEFAULT '$2`,
    )
    // we need to replace all lines ended with
    // '" FLOAT|DOUBLE([0-9,]{1,}) ...,'
    // last preg_replace preserve us from situation with
    // float([0-9,]{1,}) text inside DEFAULT field value
    q = q.replace(
      /" (float|double)(\([0-9]+,[0-9,]+\))? DEFAULT NULL(,)?\n/g,
      (_m, _t: string, _p?: string, c?: string) => `" float DEFAULT NULL${c ?? ''}\n`,
    )
    q = q.replace(
      /" (float|double)(\([0-9,]+,[0-9,]+\))? NOT NULL(,)?\n/g,
      (_m, _t: string, _p?: string, c?: string) => `" float NOT NULL${c ?? ''}\n`,
    )
    return q.replace(
      /" (float|double)(\([0-9,]+,[0-9,]+\))? NOT NULL DEFAULT '([^'])/g,
      `" float NOT NULL DEFAULT '$3`,
    )
    // @todo remove indexes from CREATE TABLE
  }

  /** replaces db/table/column names with their aliases */
  replaceWithAliases(
    delimiter: string,
    sqlQuery: string,
    aliases: Aliases,
    db: string,
    flag: { value: boolean },
  ): string {
    flag.value = false
    const { statement: st0, ctx } = this.#parse(
      delimiter === '' ? sqlQuery : `DELIMITER ${delimiter}\n${sqlQuery}`,
    )
    if (st0 === undefined) return sqlQuery
    const statement = st0 as CreateStatement
    return Context.run(ctx, () => {
      let oldDatabase = db
      const options = statement.options
      // Replacing aliases in `CREATE TABLE` statement.
      if (options?.has('TABLE') === true && statement.name !== null) {
        const oldTable = statement.name.table ?? ''
        let newDatabase: string | null = null
        if (
          statement.name.database !== null &&
          statement.name.database !== '' &&
          statement.name.database !== '0'
        ) {
          oldDatabase = statement.name.database
          newDatabase = this.getDbAlias(aliases, oldDatabase)
        }
        const newTable = this.getTableAlias(aliases, oldDatabase, oldTable)
        // Replacing new values.
        if (statement.name.database !== newDatabase || statement.name.table !== newTable) {
          statement.name.database = newDatabase
          statement.name.table = newTable
          statement.name.expr = '' // Force rebuild.
          flag.value = true
        }
        const fields = Array.isArray(statement.fields) ? statement.fields : []
        for (const field of fields) {
          // Column name.
          if (field.type !== null) {
            field.name = this.getColumnAlias(aliases, oldDatabase, oldTable, String(field.name ?? ''))
            flag.value = true
          }
          // Key's columns.
          if (field.key !== null) {
            for (const column of field.key.columns) {
              if (column.name === undefined) continue
              const columnAlias = this.getColumnAlias(aliases, oldDatabase, oldTable, String(column.name))
              if (columnAlias === column.name) continue
              column.name = columnAlias
              flag.value = true
            }
          }
          // References.
          if (field.references === null) continue
          const refTable = field.references.table?.table ?? null
          if (refTable === null || field.references.table === null) continue
          // Replacing table.
          const tableAlias = this.getTableAlias(aliases, oldDatabase, refTable)
          if (tableAlias !== refTable) {
            field.references.table.table = tableAlias
            field.references.table.expr = ''
            flag.value = true
          }
          // Replacing column names.
          field.references.columns.forEach((column, key) => {
            const columnAlias = this.getColumnAlias(aliases, oldDatabase, refTable, column)
            if (columnAlias === column) return
            ;(field.references as { columns: string[] }).columns[key] = columnAlias
            flag.value = true
          })
        }
      } else if (options?.has('TRIGGER') === true && statement.table !== null) {
        // Extracting the name of the old database and table from the
        // statement to make sure the parameters are correct.
        if (
          statement.table.database !== null &&
          statement.table.database !== '' &&
          statement.table.database !== '0'
        ) {
          oldDatabase = statement.table.database
        }
        const oldTable = statement.table.table ?? ''
        const newTable = this.getTableAlias(aliases, oldDatabase, oldTable)
        if (newTable !== oldTable) {
          statement.table.table = newTable
          statement.table.expr = '' // Force rebuild.
          flag.value = true
        }
      }
      if (
        options?.has('TRIGGER') === true ||
        options?.has('PROCEDURE') === true ||
        options?.has('FUNCTION') === true ||
        options?.has('VIEW') === true
      ) {
        // Replacing the body.
        for (const token of statement.body) {
          // Replacing only symbols (that are not variables) and unknown identifiers.
          const isSymbol = token.type === TokenType.Symbol
          const isKeyword = token.type === TokenType.Keyword
          const isNone = token.type === TokenType.None
          const replaceToken =
            (isSymbol && (token.flags & TokenFlag.SYMBOL_VARIABLE) === 0) ||
            (isKeyword && (token.flags & TokenFlag.KEYWORD_RESERVED) === 0) ||
            isNone
          if (!replaceToken) continue
          // TODO: Figure out a better way to find the alias
          const alias = this.getAlias(aliases, String(token.value))
          if (alias === '') continue
          // Replacing the token.
          token.token = Context.current.escape(alias)
          flag.value = true
        }
      }
      return statement.build()
    })
  }

  /** Generate comment */
  #generateComment(
    sqlStatement0: string | null,
    comment1: string,
    comment2: string,
    tableAlias: string,
    compat: string,
  ): string {
    let sqlStatement = sqlStatement0
    if (sqlStatement === null) {
      sqlStatement = ExportSql.noConstraintsComments
        ? ''
        : `\n${this.#exportComment()}${this.#exportComment(comment1)}${this.#exportComment()}`
    }
    // comments for current table
    if (!ExportSql.noConstraintsComments) {
      sqlStatement += `\n${this.#exportComment()}${this.#exportComment(
        `${comment2} ${this.#bqc(tableAlias, compat, this.useSqlBackquotes)}`,
      )}${this.#exportComment()}`
    }
    return sqlStatement
  }

  async #getTableStatus(db: string, table: string): Promise<string> {
    if (!this.doDates) return ''
    let newCrlf = '\n'
    let schemaCreate = ''
    const tableStatus = (await this.ctx.tables.status(db, table)) ?? {}
    const date = (s: string) =>
      localisedDate(this.ctx.tr, wallTimeToEpoch(s, this.ctx.timeZone), '', this.ctx.timeZone)
    const ct = tableStatus.Create_time
    if (ct !== null && ct !== undefined && ct !== '' && ct !== '0') {
      schemaCreate += this.#exportComment(`${this.__('Creation:')} ${date(ct)}`)
      newCrlf = `${this.#exportComment()}\n`
    }
    const ut = tableStatus.Update_time
    if (ut !== null && ut !== undefined && ut !== '' && ut !== '0') {
      schemaCreate += this.#exportComment(`${this.__('Last update:')} ${date(ut)}`)
      newCrlf = `${this.#exportComment()}\n`
    }
    const ck = tableStatus.Check_time
    if (ck !== null && ck !== undefined && ck !== '' && ck !== '0') {
      schemaCreate += this.#exportComment(`${this.__('Last check:')} ${date(ck)}`)
      newCrlf = `${this.#exportComment()}\n`
    }
    return schemaCreate + newCrlf
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('sql_structure_or_data'),
      cfg.sql_structure_or_data,
      'structure_and_data',
    )
    this.useSqlBackquotes = request.has('sql_backquotes')
    this.doRelation = request.has('sql_relation')
    this.doMime = request.has('sql_mime')
    this.doDates = request.has('sql_dates')
    this.doComments = request.has('sql_include_comments')
    this.headerComment = setStringValue(request.get('sql_header_comment'), cfg.sql_header_comment)
    this.useTransaction = request.has('sql_use_transaction')
    this.disableForeignKey = request.has('sql_disable_fk')
    const compat = setStringValue(request.get('sql_compatibility'), cfg.sql_compatibility)
    this.compatibility = (
      ['ANSI', 'DB2', 'MAXDB', 'MYSQL323', 'MYSQL40', 'MSSQL', 'ORACLE', 'TRADITIONAL'].includes(compat)
        ? compat
        : 'NONE'
    ) as Compat
    this.createDatabase = request.has('sql_create_database')
    this.dropTable = request.has('sql_drop_table')
    this.hasCreateProcedureFunction = request.has('sql_procedure_function')
    this.hasCreateTable = request.has('sql_create_table')
    const type = setStringValue(request.get('sql_type'), cfg.sql_type)
    this.type = type === 'UPDATE' || type === 'REPLACE' ? type : 'INSERT'
    this.hasCreateView = request.has('sql_create_view')
    this.hasCreateTrigger = request.has('sql_create_trigger')
    this.viewCurrentUser = request.has('sql_view_current_user')
    this.simpleViewExport = request.has('sql_simple_view_export')
    this.ifNotExists = request.has('sql_if_not_exists')
    this.orReplaceView = request.has('sql_or_replace_view')
    this.autoIncrement = request.has('sql_auto_increment')
    this.truncate = request.has('sql_truncate')
    this.delayed = request.has('sql_delayed')
    this.ignore = request.has('sql_ignore')
    const syntax = setStringValue(request.get('sql_insert_syntax'), cfg.sql_insert_syntax)
    this.insertSyntax = syntax === 'complete' || syntax === 'extended' || syntax === 'none' ? syntax : 'both'
    this.maxQuerySize = setMaxQuerySize(request.get('sql_max_query_size'), cfg.sql_max_query_size)
    this.hexForBinary = request.has('sql_hex_for_binary')
    this.utcTime = request.has('sql_utc_time')
    this.dropDatabase = request.has('sql_drop_database')
    this.viewsAsTables = request.has('sql_views_as_tables')
    this.hasMetadata = request.has('sql_metadata')
  }
}

function setStringValue(fromRequest: string | undefined, fromConfig: unknown): string {
  if (fromRequest !== undefined && fromRequest !== '') return fromRequest
  if (typeof fromConfig === 'string' && fromConfig !== '') return fromConfig
  return ''
}

function setMaxQuerySize(fromRequest: string | undefined, fromConfig: unknown): number {
  if (
    fromRequest !== undefined &&
    /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(fromRequest) &&
    Number(fromRequest) >= 0
  ) {
    return Math.trunc(Number(fromRequest))
  }
  const c = typeof fromConfig === 'number' ? fromConfig : Number(fromConfig)
  if (Number.isFinite(c) && c >= 0) return c
  return 50000
}
