import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { MetaConn } from './conn.ts'

const q = (s: string) => quoteString(s)

/** pma: src/Export/Template.php */
export interface ExportTemplate {
  id: number
  username: string
  exportType: string
  name: string
  data: string
}

/**
 * Saved export templates (pma__export_templates), always through the control link; every
 * method returns the MySQL error text ('' on success) like phpMyAdmin.
 * pma: src/Export/TemplateModel.php
 */
export class ExportTemplatesRepository {
  readonly #conn: MetaConn
  readonly #table: string

  constructor(conn: MetaConn, feature: { database: string; exportTemplates: string }) {
    this.#conn = conn
    this.#table = `${backquote(feature.database)}.${backquote(feature.exportTemplates)}`
  }

  async create(t: Omit<ExportTemplate, 'id'>): Promise<string> {
    const r = await this.#conn.tryQuery(
      `INSERT INTO ${this.#table} (\`username\`, \`export_type\`, \`template_name\`, \`template_data\`) VALUES (${q(t.username)}, ${q(t.exportType)}, ${q(t.name)}, ${q(t.data)});`,
    )
    return r !== false ? '' : this.#conn.lastError
  }

  async delete(user: string, id: number): Promise<string> {
    const r = await this.#conn.tryQuery(
      `DELETE FROM ${this.#table} WHERE \`id\` = ${Math.trunc(id)} AND \`username\` = ${q(user)};`,
    )
    return r !== false ? '' : this.#conn.lastError
  }

  async load(user: string, id: number): Promise<ExportTemplate | string> {
    const r = await this.#conn.tryQuery(
      `SELECT * FROM ${this.#table} WHERE \`id\` = ${Math.trunc(id)} AND \`username\` = ${q(user)};`,
    )
    if (r === false) return this.#conn.lastError
    const row = r.rows[r.rows.length - 1] ?? {}
    return {
      id: Number(row.id ?? 0),
      username: row.username ?? '',
      exportType: row.export_type ?? '',
      name: row.template_name ?? '',
      data: row.template_data ?? '',
    }
  }

  async update(user: string, id: number, data: string): Promise<string> {
    const r = await this.#conn.tryQuery(
      `UPDATE ${this.#table} SET \`template_data\` = ${q(data)} WHERE \`id\` = ${Math.trunc(id)} AND \`username\` = ${q(user)};`,
    )
    return r !== false ? '' : this.#conn.lastError
  }

  async getAll(user: string, exportType: string): Promise<ExportTemplate[] | string> {
    const r = await this.#conn.tryQuery(
      `SELECT * FROM ${this.#table} WHERE \`username\` = ${q(user)} AND \`export_type\` = ${q(exportType)} ORDER BY \`template_name\`;`,
    )
    if (r === false) return this.#conn.lastError
    return r.rows.map((row) => ({
      id: Number(row.id ?? 0),
      username: row.username ?? '',
      exportType: row.export_type ?? '',
      name: row.template_name ?? '',
      data: row.template_data ?? '',
    }))
  }
}
