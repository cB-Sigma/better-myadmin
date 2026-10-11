import type { SearchColumn } from '@bettermyadmin/contracts'
import { Input, NativeSelect } from '@bettermyadmin/ui'
import { t } from '../../../lib/i18n'

/** pma: Types::getUnaryOperators */
export const UNARY = ['IS NULL', 'IS NOT NULL', "= ''", "!= ''"]

/** one criteria row's state */
export interface Criterion {
  operator: string
  value: string
  geomFunc: string
}

export const initialCriterion = (c: SearchColumn): Criterion => ({
  operator: c.operators[0]?.value ?? '=',
  value: '',
  geomFunc: c.geomFunctions?.[0] ?? '',
})

/** pma: table/search/column_comparison_operators.twig */
export function OperatorSelect({
  column,
  index,
  value,
  onChange,
}: {
  column: SearchColumn
  index: number
  value: string
  onChange: (v: string) => void
}) {
  return (
    <NativeSelect
      className="column-operator"
      id={`ColumnOperator${index}`}
      name={`criteriaColumnOperators[${index}]`}
      aria-label={t('Operator')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {column.operators.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  )
}

/** pma: table/search/input_box.twig (search mode) */
export function ValueInput({
  column,
  index,
  value,
  disabled,
  onChange,
}: {
  column: SearchColumn
  index: number
  value: string
  disabled: boolean
  onChange: (v: string) => void
}) {
  const name = `criteriaValues[${index}]`
  const common = { name, id: `fieldID_${index}`, disabled, 'aria-label': t('Value') }
  const inp = column.input
  if (inp.kind === 'foreign' || inp.kind === 'enum') {
    const options =
      inp.kind === 'foreign'
        ? (inp.foreign ?? [])
        : [{ value: '', label: '' }, ...(inp.values ?? []).map((v) => ({ value: v, label: v }))]
    return (
      <NativeSelect {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: foreign lists repeat the empty separator
          <option key={i} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    )
  }
  if (inp.kind === 'number') {
    return (
      <Input
        {...common}
        type="number"
        className="w-48"
        inputMode={column.dataType === 'INT' ? 'numeric' : 'decimal'}
        step="any"
        {...(inp.min !== undefined ? { 'data-min': inp.min, 'data-max': inp.max } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Input
      {...common}
      type="text"
      size={40}
      className={`w-80 ${inp.className ?? 'textfield'}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** The criteria to send: rows with a value, a unary operator or a unary geometry function (select.ts). */
export function criteriaToSend(columns: SearchColumn[], rows: Criterion[]) {
  const geomUnary = ['IsEmpty', 'IsSimple', 'IsRing', 'IsClosed']
  return columns.flatMap((c, i) => {
    const r = rows[i]
    if (r === undefined) return []
    const geom = c.geomFunctions !== undefined && r.geomFunc.trim() !== '' && !r.geomFunc.startsWith('-')
    if (!UNARY.includes(r.operator) && !(geom && geomUnary.includes(r.geomFunc)) && r.value === '') return []
    return [
      {
        name: c.name,
        type: c.type,
        operator: r.operator,
        value: r.value,
        ...(geom ? { geomFunc: r.geomFunc } : {}),
      },
    ]
  })
}
