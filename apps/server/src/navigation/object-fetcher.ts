import { backquote, escapeMysqlWildcards } from '@bettermyadmin/sql-gen'
import type { NavCtx } from './nodes.ts'

/**
 * Lists of tables, views, routines and events of one database, fetched once per node instance
 * (the first call's search clause wins, exactly as in phpMyAdmin).
 * pma: src/Navigation/Nodes/ObjectFetcher.php
 */
export class ObjectFetcher {
  #tables: string[] | null = null
  #views: string[] | null = null
  #procedures: string[] | null = null
  #functions: string[] | null = null
  #events: string[] | null = null
  readonly #ctx: NavCtx

  constructor(ctx: NavCtx) {
    this.#ctx = ctx
  }

  async getTables(realName: string, searchClause: string): Promise<string[]> {
    if (this.#tables === null) await this.#bufferTablesAndViews(realName, searchClause)
    return this.#tables as string[]
  }

  async getViews(realName: string, searchClause: string): Promise<string[]> {
    if (this.#views === null) await this.#bufferTablesAndViews(realName, searchClause)
    return this.#views as string[]
  }

  async getProcedures(realName: string, searchClause: string): Promise<string[]> {
    if (this.#procedures !== null) return this.#procedures
    this.#procedures = await this.#getRoutines('PROCEDURE', realName, searchClause)
    return this.#procedures
  }

  async getFunctions(realName: string, searchClause: string): Promise<string[]> {
    if (this.#functions !== null) return this.#functions
    this.#functions = await this.#getRoutines('FUNCTION', realName, searchClause)
    return this.#functions
  }

  async getEvents(realName: string, searchClause: string): Promise<string[]> {
    if (this.#events !== null) return this.#events
    this.#events = await this.#getEventsFromDb(realName, searchClause)
    return this.#events
  }

  #like(searchClause: string): string {
    return this.#ctx.dbi.quoteString(`%${escapeMysqlWildcards(searchClause)}%`)
  }

  async #getEventsFromDb(realName: string, searchClause: string): Promise<string[]> {
    const { dbi } = this.#ctx
    if (!this.#ctx.server.DisableIS) {
      let query = 'SELECT `EVENT_NAME` AS `name` '
      query += 'FROM `INFORMATION_SCHEMA`.`EVENTS` '
      query += `WHERE \`EVENT_SCHEMA\` ${await dbi.collateForIS()}=${dbi.quoteString(realName)}`
      if (searchClause !== '') query += ` AND \`EVENT_NAME\` LIKE ${this.#like(searchClause)}`
      query += ' ORDER BY `EVENT_NAME` ASC'
      return (await dbi.fetchSingleColumn(query)) as string[]
    }
    let query = `SHOW EVENTS FROM ${backquote(realName)}`
    if (searchClause !== '') query += ` WHERE \`Name\` LIKE ${this.#like(searchClause)}`
    const r = await dbi.tryQuery(query)
    if (r === null) return []
    const i = r.fields.indexOf('Name')
    return r.rows.map((row) => row[i] as string)
  }

  async #bufferTablesAndViews(realName: string, searchClause: string): Promise<void> {
    this.#tables = []
    this.#views = []
    for (const t of await this.#getTablesAndViews(realName, searchClause)) {
      if (t.type === 'BASE TABLE' || t.type === 'SYSTEM VERSIONED') this.#tables.push(t.name)
      else this.#views.push(t.name)
    }
  }

  async #getTablesAndViews(
    realName: string,
    searchClause: string,
  ): Promise<Array<{ name: string; type: string }>> {
    const { dbi } = this.#ctx
    if (!this.#ctx.server.DisableIS) {
      let query = 'SELECT `TABLE_NAME` AS `name`, `TABLE_TYPE` AS `type` '
      query += 'FROM `INFORMATION_SCHEMA`.`TABLES` '
      query += `WHERE \`TABLE_SCHEMA\`=${dbi.quoteString(realName)}`
      if (searchClause !== '') query += ` AND \`TABLE_NAME\` LIKE ${this.#like(searchClause)}`
      query += ' ORDER BY `TABLE_NAME` ASC'
      return (await dbi.fetchResultSimple(query)).map((r) => ({
        name: r.name ?? '',
        type: r.type ?? '',
      }))
    }
    let query = `SHOW FULL TABLES FROM ${backquote(realName)}`
    if (searchClause !== '') {
      query += ` WHERE ${backquote(`Tables_in_${realName}`)} LIKE ${this.#like(searchClause)}`
    }
    const r = await dbi.tryQuery(query)
    if (r === null) return []
    const out: Array<{ name: string; type: string }> = []
    for (const row of r.rows) out.push({ name: row[0] ?? '', type: row[1] ?? '' })
    return out
  }

  async #getRoutines(
    routineType: 'PROCEDURE' | 'FUNCTION',
    realName: string,
    searchClause: string,
  ): Promise<string[]> {
    const { dbi } = this.#ctx
    if (!this.#ctx.server.DisableIS) {
      let query = 'SELECT `ROUTINE_NAME` AS `name` '
      query += 'FROM `INFORMATION_SCHEMA`.`ROUTINES` '
      query += `WHERE \`ROUTINE_SCHEMA\` ${await dbi.collateForIS()}=${dbi.quoteString(realName)}`
      query += ` AND \`ROUTINE_TYPE\`='${routineType}'`
      if (searchClause !== '') query += ` AND \`ROUTINE_NAME\` LIKE ${this.#like(searchClause)}`
      query += ' ORDER BY `ROUTINE_NAME` ASC'
      return (await dbi.fetchSingleColumn(query)) as string[]
    }
    let query = `SHOW ${routineType} STATUS WHERE \`Db\`=${dbi.quoteString(realName)}`
    if (searchClause !== '') query += ` AND \`Name\` LIKE ${this.#like(searchClause)}`
    const r = await dbi.tryQuery(query)
    if (r === null) return []
    const i = r.fields.indexOf('Name')
    return r.rows.map((row) => row[i] as string)
  }
}
