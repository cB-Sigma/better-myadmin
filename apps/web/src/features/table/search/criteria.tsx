import type { SearchColumn } from '@bettermyadmin/contracts'
import { Button, Input, NativeSelect, PmaIcon, isPickerKind } from '@bettermyadmin/ui'
import { useState } from 'react'
import type { TableRef } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { GisEditor } from '../../gis/GisEditor'
import { ForeignBrowser } from '../../insert-edit/ForeignBrowser'
import { DateTimePicker } from '../../insert-edit/ValueWidget'

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
/** select.ts: the binary geometry functions and those returning a geometry (outputGeomFunctions) */
const GEOM_OUTPUT = [
  ...['Contains', 'Crosses', 'Disjoint', 'Equals', 'Intersects', 'Overlaps', 'Touches', 'Within'],
  ...['MBRContains', 'MBRDisjoint', 'MBREquals', 'MBRIntersects', 'MBROverlaps', 'MBRTouches', 'MBRWithin'],
  ...['ST_Contains', 'ST_Crosses', 'ST_Disjoint', 'ST_Equals', 'ST_Intersects', 'ST_Overlaps', 'ST_Touches'],
  ...['ST_Within', 'Envelope', 'EndPoint', 'StartPoint', 'ExteriorRing', 'Centroid', 'PointOnSurface'],
]

export function ValueInput({
  column,
  index,
  value,
  disabled,
  onChange,
  scope,
  geomFunc = '',
  picker = false,
}: {
  column: SearchColumn
  index: number
  value: string
  disabled: boolean
  onChange: (v: string) => void
  /** the table search (`in_fbs`): "Browse foreign values" and the GIS editor */
  scope?: TableRef
  /** the row's geometry function: the GIS editor shows for functions returning a geometry */
  geomFunc?: string
  /**
   * the table search's `<td data-type>`: addDateTimePicker gives `.datefield` / `.datetimefield`
   * a picker when the type is date, datetime or timestamp (zoom search has no data-type: none)
   */
  picker?: boolean
}) {
  const [browse, setBrowse] = useState(false)
  const [gis, setGis] = useState(false)
  const name = `criteriaValues[${index}]`
  const common = {
    name,
    id: `fieldID_${index}`,
    disabled,
    'aria-label': t('Value'),
    'data-type': column.dataType,
  }
  const inp = column.input
  if (inp.kind === 'foreignLink' && scope !== undefined) {
    return (
      <>
        <Input
          {...common}
          type="text"
          className="textfield w-80"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />{' '}
        <Button variant="link" className="browse_foreign" onClick={() => setBrowse(true)}>
          <PmaIcon name="b_browse" /> {t('Browse foreign values')}
        </Button>
        {browse && (
          <ForeignBrowser
            server={scope.server}
            db={scope.db}
            table={scope.table}
            field={column.name}
            data={value}
            onClose={() => setBrowse(false)}
            onPick={(key) => {
              onChange(key)
              setBrowse(false)
            }}
          />
        )}
      </>
    )
  }
  if (inp.kind === 'gis' && scope !== undefined) {
    return (
      <>
        <Input
          name={name}
          id={`field_${index}`}
          type="text"
          size={40}
          className="textfield w-80"
          aria-label={t('Value')}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />{' '}
        {/* select.ts: .open_search_gis_editor is hidden until a geometry-returning function is chosen */}
        {GEOM_OUTPUT.includes(geomFunc) && (
          <Button variant="link" className="open_search_gis_editor" onClick={() => setGis(true)}>
            <PmaIcon name="b_edit" /> {t('Edit/Insert')}
          </Button>
        )}
        {gis && (
          <GisEditor
            field="Parameter"
            columnType="GEOMETRY"
            value={
              value !== ''
                ? value
                : geomFunc === 'Envelope'
                  ? 'POLYGON()'
                  : geomFunc === 'ExteriorRing'
                    ? 'LINESTRING()'
                    : 'POINT()'
            }
            onClose={() => setGis(false)}
            onCopy={(v) => {
              onChange(v)
              setGis(false)
            }}
          />
        )}
      </>
    )
  }
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
  const className = inp.className ?? 'textfield'
  const field = (
    <Input
      {...common}
      type="text"
      size={40}
      className={`w-80 ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  const kind = column.type
  if (picker && /\b(datefield|datetimefield)\b/.test(className) && isPickerKind(kind)) {
    // no data-decimals on the td: no fractional seconds
    return (
      <span className="inline-flex items-center gap-1">
        {field}
        <DateTimePicker kind={kind} decimals={0} value={value} onPick={onChange} />
      </span>
    )
  }
  return field
}

const LIKES = ['LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%']
const MULTIPLE = ['IN (...)', 'NOT IN (...)', 'BETWEEN', 'NOT BETWEEN']

/**
 * The jQuery Validation rule of a criteria value (change.ts verifyAfterSearchFieldChange, set up on
 * focus and on operator change, checked on keyup and submit): LIKE operators skip it; INT values
 * must be numbers (lists for IN / BETWEEN) within the column's range, FLOAT values numbers.
 * Returns the message, or null. Selects are not validated.
 */
export function searchFieldError(c: SearchColumn, operator: string, value: string): string | null {
  if (c.input.kind !== 'number' && c.input.kind !== 'text') return null
  if (LIKES.includes(operator)) return null
  const v = value.trim()
  if (v === '') return null
  if (c.dataType === 'INT') {
    if (MULTIPLE.includes(operator)) {
      // validationFunctionForMultipleInt
      const ok =
        v
          .replace(/ /g, '')
          .match(/^(((0x[0-9a-f]+)|([+-]?([0-9]*\.?[0-9]+|[0-9]+\.?[0-9]*)(e[+-]?[0-9]+)?))(,|$))+$/i) !==
        null
      return ok ? null : t('Please enter a valid number!')
    }
    // validationFunctionForInt (the second alternative is not anchored at the start, as in pma)
    if (v.match(/^(0x[0-9a-f]+$)|([+-]?([0-9]*\.?[0-9]+|[0-9]+\.?[0-9]*)(e[+-]?[0-9]+)?)$/i) === null)
      return t('Please enter a valid number!')
    const n = Number(v)
    if (!Number.isNaN(n) && c.input.min !== undefined && n < Number(c.input.min))
      return t('Please enter a value greater than or equal to {0}').replace('{0}', c.input.min)
    if (!Number.isNaN(n) && c.input.max !== undefined && n > Number(c.input.max))
      return t('Please enter a value less than or equal to {0}').replace('{0}', c.input.max)
    return null
  }
  if (c.dataType === 'FLOAT') {
    // jQuery Validation `number`
    return /^(?:-?\d+|-?\d{1,3}(?:,\d{3})+)?(?:\.\d+)?$/.test(v) ? null : t('Please enter a valid number')
  }
  return null
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
