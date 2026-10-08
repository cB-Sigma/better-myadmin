import type { Cell, Field } from '@bettermyadmin/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useRef } from 'react'
import { formatByteDown } from './format'

const ROW_H = 28

function b64ToHex(b64: string): string {
  const bin = atob(b64)
  let hex = ''
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
  return hex
}

/** Cell rendering per FieldMetadata hints; values are never parsed as numbers. */
const CellView = memo(function CellView({ value, field }: { value: Cell; field: Field }) {
  if (value === null) return <span className="italic text-data-null">NULL</span>
  if (typeof value === 'string') return <>{value}</>
  if (field.mappedType === 'blob' || field.flags.blob) {
    return <span className="font-mono text-data-binary">[BLOB - {formatByteDown(value.bytes)}]</span>
  }
  if (field.mappedType === 'bit') {
    const bits = [...b64ToHex(value.b64)]
      .map((h) => Number.parseInt(h, 16).toString(2).padStart(4, '0'))
      .join('')
    return <span className="font-mono">b'{bits.replace(/^0+(?=.)/, '')}'</span>
  }
  return <span className="font-mono text-data-binary">0x{b64ToHex(value.b64)}</span>
})

/**
 * Results grid: virtualized above 100 rows (docs/architecture/03-frontend-architecture.md#the-results-grid-datagrid).
 * Editing, sorting, FK links and the options panel arrive with M1.
 */
export function ResultGrid({ fields, rows }: { fields: Field[]; rows: Cell[][] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtual = rows.length > 100
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
    enabled: virtual,
  })
  const items = virtual ? v.getVirtualItems() : rows.map((_, i) => ({ index: i, start: i * ROW_H }))
  const padTop = virtual && items.length > 0 ? (items[0]?.start ?? 0) : 0
  const padBottom = virtual && items.length > 0 ? v.getTotalSize() - ((items.at(-1)?.start ?? 0) + ROW_H) : 0

  return (
    <div
      ref={parentRef}
      className={`overflow-auto rounded border border-border ${virtual ? 'max-h-[70vh]' : ''}`}
    >
      <table
        className="tnum w-max min-w-full border-collapse text-[13px]"
        role="grid"
        aria-rowcount={rows.length}
      >
        <thead className="sticky top-0 z-10">
          <tr>
            {fields.map((f, i) => (
              <th
                key={`${f.name}-${i}`}
                scope="col"
                className="h-8 whitespace-nowrap border-b border-r border-border bg-grid-header px-2 text-left font-semibold"
              >
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr style={{ height: padTop }}>
              <td colSpan={fields.length} />
            </tr>
          )}
          {items.map(({ index }) => {
            const row = rows[index]!
            return (
              <tr
                key={index}
                className={`h-7 hover:bg-grid-hover ${index % 2 === 0 ? 'bg-grid-odd' : 'bg-grid-even'}`}
                aria-rowindex={index + 1}
              >
                {fields.map((f, c) => (
                  <td
                    key={`${f.name}-${c}`}
                    className={`max-w-md truncate whitespace-nowrap border-r border-border/60 px-2 ${
                      f.flags.numeric ? 'text-right' : ''
                    }`}
                  >
                    <CellView value={row[c] ?? null} field={f} />
                  </td>
                ))}
              </tr>
            )
          })}
          {padBottom > 0 && (
            <tr style={{ height: padBottom }}>
              <td colSpan={fields.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
