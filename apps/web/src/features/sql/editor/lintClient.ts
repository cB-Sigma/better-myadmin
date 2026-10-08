import type { LintMessage as Lint } from '@bettermyadmin/sql-lexer'
import type { LintJob } from './lint.worker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (lints: Lint[]) => void>()

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('./lint.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; lints: Lint[] }>) => {
      pending.get(e.data.id)?.(e.data.lints)
      pending.delete(e.data.id)
    }
  }
  return worker
}

/** Lints `sql` in the worker (positions are lines/columns in code points, like phpMyAdmin's /lint). */
export function lintInWorker(job: Omit<LintJob, 'id'>): Promise<Lint[]> {
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ ...job, id })
  })
}
