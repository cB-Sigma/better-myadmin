import type { SimulateResponse } from '@bettermyadmin/contracts'
import { useEffect, useRef } from 'react'
import { HighlightedSql } from './HighlightedSql'

/**
 * The "Simulate query" modal: per statement the parsed SQL and "Affected rows:" linking to the rows.
 * pma: resources/templates/sql/query.twig (#simulateDmlModal), resources/js/sql.ts (#simulate_dml)
 */
export function SimulateModal({
  data,
  versionInt,
  onClose,
  onShowRows,
}: {
  data: SimulateResponse
  versionInt: number
  onClose: () => void
  onShowRows: (sql: string, sig: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dialog.current
    if (d !== null && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      id="simulateDmlModal"
      aria-labelledby="simulateDmlModalLabel"
      className="m-auto w-[min(40rem,92vw)] rounded border border-border bg-bg p-0 text-fg shadow-lg backdrop:bg-black/40"
      onClose={onClose}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h5 id="simulateDmlModalLabel" className="font-semibold">
          Simulate query
        </h5>
        <button
          type="button"
          aria-label="Close"
          className="px-2 text-lg"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="modal-body preview_sql px-4 py-3 text-sm">
        {data.sqlData === null ? (
          <div role="alert" className="text-error">
            {data.message}
          </div>
        ) : (
          data.sqlData.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statements are positional
            <div key={i}>
              {i > 0 && <hr className="my-2 border-border" />}
              <strong>SQL query:</strong>
              <HighlightedSql sql={d.sqlQuery} versionInt={versionInt} className="my-1" />
              Affected rows:{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  dialog.current?.close()
                  onShowRows(d.matchedRowsSql, d.matchedRowsSig)
                }}
              >
                {d.matchedRows}
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end border-t border-border px-4 py-2">
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  )
}
