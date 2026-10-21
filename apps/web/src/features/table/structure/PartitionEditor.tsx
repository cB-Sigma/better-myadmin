import type { PartitionDefT, Partitioning } from '@bettermyadmin/contracts'
import { t } from '../../../lib/i18n'

/**
 * Partition editor (Create table "PARTITION definition:" and "Edit partitioning").
 *
 * pma: resources/templates/columns_definitions/partitions.twig,
 *      src/Partitioning/TablePartitionDefinition.php (the grid regenerated when counts change)
 */
const PARTITION_BY = [
  '',
  'HASH',
  'LINEAR HASH',
  'KEY',
  'LINEAR KEY',
  'RANGE',
  'RANGE COLUMNS',
  'LIST',
  'LIST COLUMNS',
]
const SUB_BY = ['', 'HASH', 'LINEAR HASH', 'KEY', 'LINEAR KEY']
const VALUE_TYPES = ['', 'LESS THAN', 'LESS THAN MAXVALUE', 'IN']
const RANGE_LIST = ['RANGE', 'RANGE COLUMNS', 'LIST', 'LIST COLUMNS']

type Full = Required<Partitioning> & { partitions: PartitionDefT[] }

const count = (v: string | undefined) => {
  const n = Number(v ?? '')
  return Number.isFinite(n) && v !== '' ? Math.min(Math.trunc(n), 8192) : 0
}

const blank = (name: string): PartitionDefT => ({
  name,
  engine: '',
  comment: '',
  dataDirectory: '',
  indexDirectory: '',
  maxRows: '',
  minRows: '',
  tablespace: '',
  nodeGroup: '',
})

/** TablePartitionDefinition::getDetails + extractPartitions */
export function regeneratePartitions(p: Partitioning): Full {
  const full: Full = {
    partitionBy: p.partitionBy ?? '',
    partitionExpr: p.partitionExpr ?? '',
    partitionCount: p.partitionCount ?? '',
    subpartitionBy: p.subpartitionBy ?? '',
    subpartitionExpr: p.subpartitionExpr ?? '',
    subpartitionCount: p.subpartitionCount ?? '',
    partitions: [...(p.partitions ?? [])],
  }
  const n = count(full.partitionCount)
  const sub = count(full.subpartitionCount)
  const canSub = n > 1 && RANGE_LIST.includes(full.partitionBy ?? '')
  const valueEnabled = RANGE_LIST.includes(full.partitionBy ?? '')
  if (n <= 1) return { ...full, partitions: [] }
  const parts = full.partitions.slice(0, n)
  for (let i = 0; i < n; i++) {
    let part = parts[i] ?? { ...blank(`p${i}`), valueType: '', value: '' }
    if (valueEnabled && part.valueType === undefined) part = { ...part, valueType: '', value: '' }
    if (part.engine === undefined && (part.subpartitions === undefined || sub < 2))
      part = { ...blank(part.name), ...part }
    if (sub < 2 || !canSub) {
      const { subpartitions: _s, ...rest } = part
      part = rest.engine === undefined ? { ...blank(rest.name), ...rest } : rest
    } else {
      const subs = (part.subpartitions ?? []).slice(0, sub)
      for (let j = 0; j < sub; j++) subs[j] ??= blank(`${part.name}_s${j}`)
      part = { ...part, subpartitions: subs }
    }
    parts[i] = part
  }
  return { ...full, partitions: parts }
}

export function PartitionEditor({
  value,
  engines,
  onChange,
}: {
  value: Partitioning
  engines: Array<{ name: string; comment: string }>
  onChange: (p: Partitioning) => void
}) {
  const p = regeneratePartitions(value)
  const n = count(p.partitionCount)
  const sub = count(p.subpartitionCount)
  const canSub = n > 1 && RANGE_LIST.includes(p.partitionBy ?? '')
  const valueEnabled = RANGE_LIST.includes(p.partitionBy ?? '')
  const set = (patch: Partial<Full>) => onChange(regeneratePartitions({ ...p, ...patch }))
  const setPart = (i: number, patch: Partial<PartitionDefT>, j?: number) => {
    const parts = p.partitions.map((x, k) => {
      if (k !== i) return x
      if (j === undefined) return { ...x, ...patch }
      return {
        ...x,
        subpartitions: (x.subpartitions ?? []).map((s, l) => (l === j ? { ...s, ...patch } : s)),
      }
    })
    onChange({ ...p, partitions: parts })
  }
  const optionCells = (d: PartitionDefT, i: number, j?: number) => (
    <>
      <td>
        <select
          className="input"
          aria-label={t('Storage engine')}
          value={d.engine ?? ''}
          onChange={(e) => setPart(i, { engine: e.target.value }, j)}
        >
          <option value="" />
          {engines.map((e) => (
            <option key={e.name} value={e.name} title={e.comment}>
              {e.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <textarea
          className="input"
          aria-label={t('Comment')}
          value={d.comment ?? ''}
          onChange={(e) => setPart(i, { comment: e.target.value }, j)}
        />
      </td>
      {(['dataDirectory', 'indexDirectory', 'maxRows', 'minRows', 'tablespace', 'nodeGroup'] as const).map(
        (k) => (
          <td key={k}>
            <input
              className="input"
              type={k === 'maxRows' || k === 'minRows' ? 'number' : 'text'}
              aria-label={
                {
                  dataDirectory: t('Data directory'),
                  indexDirectory: t('Index directory'),
                  maxRows: t('Max rows'),
                  minRows: t('Min rows'),
                  tablespace: t('Table space'),
                  nodeGroup: t('Node group'),
                }[k]
              }
              value={d[k] ?? ''}
              onChange={(e) => setPart(i, { [k]: e.target.value }, j)}
            />
          </td>
        ),
      )}
    </>
  )
  return (
    <div className="text-sm">
      <table id="partition_table">
        <tbody>
          <tr>
            <td className="pr-2">
              <label htmlFor="partition_by">{t('Partition by:')}</label>
            </td>
            <td>
              <select
                id="partition_by"
                className="input"
                value={p.partitionBy}
                onChange={(e) => set({ partitionBy: e.target.value })}
              >
                {PARTITION_BY.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <span className="inline-flex items-center gap-1">
                (
                <input
                  className="input inline w-64"
                  aria-label={t('Expression or column list')}
                  placeholder={t('Expression or column list')}
                  value={p.partitionExpr}
                  onChange={(e) => set({ partitionExpr: e.target.value })}
                />
                )
              </span>
            </td>
          </tr>
          <tr>
            <td>
              <label htmlFor="partition_count">{t('Partitions:')}</label>
            </td>
            <td colSpan={2}>
              <input
                id="partition_count"
                type="number"
                min={2}
                className="input w-24"
                value={p.partitionCount}
                onChange={(e) => set({ partitionCount: e.target.value })}
              />
            </td>
          </tr>
          {canSub && (
            <>
              <tr>
                <td>
                  <label htmlFor="subpartition_by">{t('Subpartition by:')}</label>
                </td>
                <td>
                  <select
                    id="subpartition_by"
                    className="input"
                    value={p.subpartitionBy}
                    onChange={(e) => set({ subpartitionBy: e.target.value })}
                  >
                    {SUB_BY.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1">
                    (
                    <input
                      className="input inline w-64"
                      aria-label={t('Subpartition by:')}
                      value={p.subpartitionExpr}
                      onChange={(e) => set({ subpartitionExpr: e.target.value })}
                    />
                    )
                  </span>
                </td>
              </tr>
              <tr>
                <td>
                  <label htmlFor="subpartition_count">{t('Subpartitions:')}</label>
                </td>
                <td colSpan={2}>
                  <input
                    id="subpartition_count"
                    type="number"
                    min={2}
                    className="input w-24"
                    value={p.subpartitionCount}
                    onChange={(e) => set({ subpartitionCount: e.target.value })}
                  />
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {n > 1 && (
        <table id="partition_definition_table" className="mt-2">
          <thead>
            <tr className="text-left">
              <th>{t('Partition')}</th>
              {valueEnabled && <th>{t('Values')}</th>}
              {canSub && sub > 1 && <th>{t('Subpartition')}</th>}
              <th>{t('Engine')}</th>
              <th>{t('Comment')}</th>
              <th>{t('Data directory')}</th>
              <th>{t('Index directory')}</th>
              <th>{t('Max rows')}</th>
              <th>{t('Min rows')}</th>
              <th>{t('Table space')}</th>
              <th>{t('Node group')}</th>
            </tr>
          </thead>
          <tbody>
            {p.partitions.map((part, i) => {
              const subs = part.subpartitions
              return subs === undefined ? (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: partitions are positional (partitions[i])
                  key={`p${i}`}
                  data-testid={`partition-${i}`}
                >
                  <td>
                    <input
                      className="input"
                      aria-label={t('Partition')}
                      value={part.name}
                      onChange={(e) => setPart(i, { name: e.target.value })}
                    />
                  </td>
                  {valueEnabled && (
                    <td>
                      <select
                        className="input partition_value"
                        aria-label={t('Values')}
                        value={part.valueType ?? ''}
                        onChange={(e) => setPart(i, { valueType: e.target.value })}
                      >
                        {VALUE_TYPES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input partition_value"
                        aria-label={t('Value')}
                        value={part.value ?? ''}
                        onChange={(e) => setPart(i, { value: e.target.value })}
                      />
                    </td>
                  )}
                  {optionCells(part, i)}
                </tr>
              ) : (
                subs.map((s, j) => (
                  <tr key={`${part.name}/${s.name}`}>
                    {j === 0 ? (
                      <td rowSpan={subs.length}>
                        <input
                          className="input"
                          aria-label={t('Partition')}
                          value={part.name}
                          onChange={(e) => setPart(i, { name: e.target.value })}
                        />
                      </td>
                    ) : null}
                    {valueEnabled && j === 0 ? (
                      <td rowSpan={subs.length}>
                        <select
                          className="input"
                          aria-label={t('Values')}
                          value={part.valueType ?? ''}
                          onChange={(e) => setPart(i, { valueType: e.target.value })}
                        >
                          {VALUE_TYPES.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input"
                          aria-label={t('Value')}
                          value={part.value ?? ''}
                          onChange={(e) => setPart(i, { value: e.target.value })}
                        />
                      </td>
                    ) : null}
                    <td>
                      <input
                        className="input"
                        aria-label={t('Subpartition')}
                        value={s.name}
                        onChange={(e) => setPart(i, { name: e.target.value }, j)}
                      />
                    </td>
                    {optionCells(s, i, j)}
                  </tr>
                ))
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
