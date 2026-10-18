import type { Pool } from 'mysql2/promise'

/** What the budget needs to know about one pool it accounts for. */
export interface BudgetedPool {
  pool: Pool
  lastUsed: number
  /** physical connections open (created, not yet closed) */
  open: number
  /** connections handed out and not yet released or destroyed */
  busy: Set<object>
  /** set when the pool has been ended */
  ended: boolean
  /** acquisitions decided and not yet handed out */
  pending: number
}

/** The core connection object behind a promise connection (the one pool events carry). */
const core = (c: unknown): object => ((c as { connection?: object }).connection ?? (c as object)) as object

/**
 * The cap on MySQL connections held by every pool of this process (`ConnectionPool.maxTotal`):
 * phpMyAdmin holds one connection per running request, so idle pooled connections must never fill
 * the server's `max_connections`. A pool that needs a new connection while the cap is reached first
 * closes the least recently used idle pools, then waits (`ConnectionPool.waitTimeout`) for a
 * connection to be released.
 */
export class ConnectionBudget {
  readonly #pools = new Set<BudgetedPool>()
  readonly #waiters: Array<() => void> = []
  /** new connections decided but not yet created */
  #pending = 0
  readonly maxTotal: number
  readonly waitMs: number
  readonly #close: (p: BudgetedPool) => Promise<void>

  constructor(maxTotal: number, waitSeconds: number, close: (p: BudgetedPool) => Promise<void>) {
    this.maxTotal = maxTotal
    this.waitMs = waitSeconds * 1000
    this.#close = close
  }

  /** Open connections of every pool. */
  get open(): number {
    let n = 0
    for (const p of this.#pools) n += p.open
    return n
  }

  /** Starts accounting for a new pool (its connection, release and close events). */
  track(entry: BudgetedPool): void {
    this.#pools.add(entry)
    entry.pool.pool.on('connection', (c) => {
      entry.open++
      const conn = core(c) as {
        once(ev: string, fn: () => void): void
        stream?: { once(ev: string, fn: () => void): void }
      }
      let closed = false
      const gone = () => {
        if (closed) return
        closed = true
        entry.open--
        entry.busy.delete(conn)
        // an ended pool counts until its last connection is closed
        if (entry.ended && entry.open <= 0) this.#pools.delete(entry)
        this.#notify()
      }
      // destroy() only ends the socket: its close is the reliable signal
      conn.once('end', gone)
      conn.once('error', gone)
      conn.stream?.once('close', gone)
    })
    entry.pool.pool.on('release', (c) => {
      entry.busy.delete(core(c))
      this.#notify()
    })
  }

  /** The pool is being ended: it keeps counting until its connections are closed. */
  untrack(entry: BudgetedPool): void {
    entry.ended = true
    if (entry.open <= 0) this.#pools.delete(entry)
    this.#notify()
  }

  /**
   * A connection of `entry`, within the caps: `limit` connections in use for this pool (the
   * session's `Servers[i].max_connections`) and `maxTotal` open for the process. A request that
   * already holds a connection (`mayWait` false) is never made to wait: it would wait while
   * holding what the others wait for. It goes over a cap instead, briefly.
   */
  async getConnection<T>(
    entry: BudgetedPool,
    get: () => Promise<T>,
    opts: { limit?: number; mayWait?: boolean } = {},
  ): Promise<T> {
    const mayWait = opts.mayWait ?? true
    const deadline = Date.now() + this.waitMs
    let reserved = false
    for (;;) {
      const inUse = entry.busy.size + entry.pending
      const underLimit = opts.limit === undefined || inUse < opts.limit
      // a free connection of this pool needs no new one
      const free = entry.open - entry.busy.size - entry.pending > 0
      if (underLimit && (free || this.open + this.#pending < this.maxTotal)) break
      if (!mayWait) break
      if (underLimit && (await this.#reclaim(entry))) continue
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`All ${this.maxTotal} database connections are in use; try again later.`)
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, Math.min(left, 1000))
        function done() {
          clearTimeout(t)
          resolve()
        }
        this.#waiters.push(done)
      })
    }
    entry.pending++
    if (entry.open - entry.busy.size - entry.pending < 0) {
      this.#pending++
      reserved = true
    }
    try {
      const conn = await get()
      entry.busy.add(core(conn))
      entry.lastUsed = Date.now()
      return conn
    } finally {
      entry.pending--
      if (reserved) this.#pending--
      this.#notify()
    }
  }

  /** Closes the least recently used pool with open but no busy connections. */
  async #reclaim(except: BudgetedPool): Promise<boolean> {
    let lru: BudgetedPool | null = null
    for (const p of this.#pools) {
      if (p === except || p.ended || p.open === 0 || p.busy.size > 0) continue
      if (lru === null || p.lastUsed < lru.lastUsed) lru = p
    }
    if (lru === null) return false
    await this.#close(lru)
    return true
  }

  #notify(): void {
    for (const w of this.#waiters.splice(0)) w()
  }
}
