import type { Executed } from '@bettermyadmin/contracts'

/**
 * The request's statement log when `$cfg['DBG']['sql']` is off: nothing reads its entries then
 * (they are shown and logged only with DBG/sql), so it keeps none. A long import would otherwise
 * hold the text of every statement it ran until the request ends (a 500 MB SQL file: about
 * 600 MB; docs/architecture/17-large-data.md). Its identity still carries the per-request query
 * hooks (setQueryHook, the tracker).
 */
export class DiscardingLog extends Array<Executed> {
  // map / filter / slice of the log are plain arrays
  static override get [Symbol.species]() {
    return Array
  }

  override push(..._items: Executed[]): number {
    return this.length
  }
}

/** A new statement log for a request */
export const statementLog = (debugSql: boolean): Executed[] => (debugSql ? [] : new DiscardingLog())
