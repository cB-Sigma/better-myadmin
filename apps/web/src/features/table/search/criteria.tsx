import type { SearchColumn } from '@bettermyadmin/contracts'
import { Button, Input, NativeSelect, PmaIcon } from '@bettermyadmin/ui'
import { useState } from 'react'
import type { TableRef } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { GisEditor } from '../../gis/GisEditor'
import { ForeignBrowser } from '../../insert-edit/ForeignBrowser'

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
}) {
  const [browse, setBrowse] = useState(false)
  const [gis, setGis] = useState(false)
  const name = `criteriaValues[${index}]`
  const common = { name, id: `fieldID_${index}`, disabled, 'aria-label': t('Value') }
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
