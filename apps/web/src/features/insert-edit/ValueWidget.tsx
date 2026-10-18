import type { InsertCell, InsertColumn } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  DateTimeTrigger,
  Input,
  NativeSelect,
  type PickerKind,
  PmaIcon,
  Radio,
  Textarea,
  isPickerKind,
  pickerOptionsFor,
  useUiSettings,
} from '@bettermyadmin/ui'
import { useState } from 'react'
import { t } from '../../lib/i18n'
import type { CellState } from './logic'

/**
 * The Value cell of one column of one row: the widget phpMyAdmin's column_row.twig picks.
 * pma: resources/templates/table/insert/column_row.twig, value_column_for_other_datatype.twig,
 *      src/Plugins/Transformations/Input/*::getInputHtml
 */
export interface WidgetProps {
  col: InsertColumn
  cell: InsertCell
  state: CellState
  /** field_<idx>_3 */
  idx: number
  rowId: number
  onChange: (patch: Partial<CellState>) => void
  onBrowseForeign: () => void
  onGis: () => void
  error: string | null
}

const readFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })

export function ValueWidget(p: WidgetProps) {
  const { col, cell, state, idx } = p
  const w = cell.widget
  const name = `fields[multi_edit][${p.rowId}][${col.md5}]`
  const v = Array.isArray(state.value) ? '' : state.value
  const id = `field_${idx}_3`
  const text = (e: { target: { value: string } }) => p.onChange({ value: e.target.value })
  let body: React.ReactNode
  switch (w.kind) {
    case 'text':
      body = (
        <span className="inline-flex items-center gap-1">
          <Input
            id={id}
            name={name}
            value={v}
            size={w.size}
            className="w-auto! textfield"
            data-type={w.dataType}
            data-maxlength={w.maxlength ?? undefined}
            min={w.min ?? undefined}
            max={w.max ?? undefined}
            inputMode={w.dataType === 'INT' ? 'numeric' : undefined}
            tabIndex={idx}
            // addDateTimePicker's tooltip on .timefield / .datefield
            title={w.picker === 'time' || w.picker === 'date' ? pickerTip(w.picker) : undefined}
            onChange={text}
          />
          {w.picker !== null && (
            <DateTimePicker
              // the td's data-type: the column's true type (timestamp has its own)
              kind={isPickerKind(col.trueType) ? col.trueType : w.picker}
              decimals={col.decimals}
              value={v}
              onPick={(value) => p.onChange({ value })}
            />
          )}
        </span>
      )
      break
    case 'textarea':
      body = (
        <>
          <Textarea
            id={id}
            name={name}
            rows={w.rows}
            cols={w.cols}
            className={`w-auto! ${w.charField ? 'charField' : ''}`}
            data-type={w.dataType}
            data-maxlength={w.maxlength ?? undefined}
            tabIndex={idx}
            value={v}
            onChange={text}
          />
          {w.tooLong && (
            <div className="text-xs">
              {t('Because of its length,<br> this column might not be editable.').replace('<br>', '')}
            </div>
          )}
        </>
      )
      break
    case 'enum-radio':
      body = (
        <span className="inline-flex flex-wrap items-center gap-2">
          {w.values.map((e, i) => (
            <span key={e} className="inline-flex items-center gap-1">
              <Radio
                id={`${id}_${i}`}
                name={name}
                value={e}
                className="textfield"
                tabIndex={idx}
                checked={v === e}
                onChange={() => p.onChange({ value: e })}
              />
              <label htmlFor={`${id}_${i}`}>{e}</label>
            </span>
          ))}
        </span>
      )
      break
    case 'enum-select':
      body = (
        <NativeSelect id={id} name={name} className="textfield" tabIndex={idx} value={v} onChange={text}>
          <option value="" />
          {w.values.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </NativeSelect>
      )
      break
    case 'set':
      body = (
        <NativeSelect
          id={id}
          name={`${name}[]`}
          multiple
          size={w.size}
          className="textfield h-auto"
          tabIndex={idx}
          value={Array.isArray(state.value) ? state.value : []}
          onChange={(e) => p.onChange({ value: [...e.target.selectedOptions].map((o) => o.value) })}
        >
          {w.values.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </NativeSelect>
      )
      break
    case 'protected':
      body = (
        <span>
          {t('Binary - do not edit')} ({w.size} {w.unit})
        </span>
      )
      break
    case 'hex-textarea':
      body = (
        <Textarea
          id={id}
          name={name}
          rows={w.rows}
          cols={w.cols}
          className="w-auto!"
          data-type="HEX"
          tabIndex={idx}
          value={v}
          onChange={text}
        />
      )
      break
    case 'hex-input':
      body = (
        <Input
          id={id}
          name={name}
          size={w.size}
          className="w-auto! textfield"
          data-type="HEX"
          value={v}
          onChange={text}
        />
      )
      break
    case 'foreign-link':
      body = (
        <span className="inline-flex items-center gap-1">
          <Input id={id} name={name} className="w-auto! textfield" tabIndex={idx} value={v} onChange={text} />
          <Button variant="link" className="browse_foreign" onClick={p.onBrowseForeign}>
            <PmaIcon name="b_browse" alt="" /> {t('Browse foreign values')}
          </Button>
        </span>
      )
      break
    case 'foreign-select':
      body = (
        <NativeSelect id={id} name={name} className="textfield" tabIndex={idx} value={v} onChange={text}>
          {w.options.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: options repeat (both dropdown sections)
            <option key={i} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )
      break
    case 'gis':
      body = (
        <span className="inline-flex items-center gap-1">
          <Input
            id={id}
            name={name}
            size={w.size}
            className="w-auto! textfield"
            tabIndex={idx}
            value={v}
            onChange={text}
          />
          <Button variant="link" className="open_gis_editor" onClick={p.onGis}>
            <PmaIcon name="b_edit" alt="" /> {t('Edit/Insert')}
          </Button>
        </span>
      )
      break
    case 'transformed':
      body = <TransformedInput {...p} />
      break
  }
  return (
    <>
      {body}
      {col.upload !== null && w.kind !== 'transformed' && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          <input
            type="file"
            name={`fields_upload[multi_edit][${p.rowId}][${col.md5}]`}
            className="textfield noDragDrop text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              p.onChange({ upload: f === undefined ? null : await readFile(f) })
            }}
          />
          {col.upload.maxSize}
        </div>
      )}
      {col.uploadDir !== null && col.uploadDir === 'error' && (
        <div className="text-xs">
          <span className="text-error">{t('Error')}</span>
          <br />
          {t('The directory you set for upload work cannot be reached.')}
        </div>
      )}
      {Array.isArray(col.uploadDir) && col.uploadDir.length > 0 && (
        <div className="text-xs">
          <i>{t('Or')}</i> {t('web server upload directory:')}
          <br />
          <NativeSelect
            name={`fields_uploadlocal[multi_edit][${p.rowId}][${col.md5}]`}
            value={state.uploadLocal}
            onChange={(e) => p.onChange({ uploadLocal: e.target.value })}
          >
            <option value="" />
            {col.uploadDir.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {state.salt !== null && (
        <div className="mt-1">
          <Input
            id={`salt_${id}`}
            name={`salt[multi_edit][${p.rowId}][${col.md5}]`}
            placeholder={t('Encryption key')}
            className="w-auto!"
            value={state.salt}
            onChange={(e) => p.onChange({ salt: e.target.value })}
          />
        </div>
      )}
      {state.fn === 'HEX' && col.trueType.startsWith('int') && (
        <p id={`note${id}`} className="text-xs text-fg-muted">
          {t('The HEX function will treat the integer as a string while calculating the hexadecimal value')}
        </p>
      )}
      {p.error !== null && (
        <span className="ms-1 text-xs text-error" role="alert">
          {p.error}
        </span>
      )}
    </>
  )
}

/** Input transformations' widgets (IOTransformationsPlugin::getInputHtml). */
function TransformedInput(p: WidgetProps) {
  const w = p.cell.widget
  if (w.kind !== 'transformed') return null
  const name = `fields[multi_edit][${p.rowId}][${p.col.md5}]`
  const upload = `fields_upload[multi_edit][${p.rowId}][${p.col.md5}]`
  const v = Array.isArray(p.state.value) ? '' : p.state.value
  const [preview, setPreview] = useState<string | null>(null)
  switch (w.plugin) {
    case 'Input/Image_JPEG_Upload': {
      const width = Number.parseInt(w.options[0] ?? '100', 10) || 100
      const height = Number.parseInt(w.options[1] ?? '100', 10) || 100
      return (
        <span>
          <img
            src={preview ?? w.imageSrc ?? ''}
            width={width}
            height={height}
            alt={t('Image preview here')}
          />
          <br />
          <input
            type="file"
            name={upload}
            accept="image/*"
            className="image-upload text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f === undefined) return
              const b64 = await readFile(f)
              // transformations/image_upload.ts: FileReader preview
              setPreview(URL.createObjectURL(f))
              p.onChange({ upload: b64 })
            }}
          />
        </span>
      )
    }
    case 'Input/Text_Plain_FileUpload':
      return (
        <input
          type="file"
          name={upload}
          className="text-xs"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            p.onChange({ upload: f === undefined ? null : await readFile(f) })
          }}
        />
      )
    case 'Input/Text_Plain_Iptobinary':
    case 'Input/Text_Plain_Iptolong':
      return (
        <Input
          id={`field_${p.idx}_3`}
          name={name}
          size={40}
          className={`w-auto! ${w.plugin.endsWith('Iptobinary') ? 'transform_IPToBin' : 'transform_IPToLong'}`}
          tabIndex={p.idx}
          value={v}
          onChange={(e) => p.onChange({ value: e.target.value })}
        />
      )
    default: {
      // CodeMirror editors (JSON / SQL / XML): a code textarea
      const cls = `transform_${w.plugin.split('_').pop()?.replace('Editor', '').toLowerCase()}_editor`
      return (
        <Textarea
          name={name}
          className={`w-full font-mono text-xs ${cls}`}
          rows={10}
          value={v}
          onChange={(e) => p.onChange({ value: e.target.value })}
        />
      )
    }
  }
}

/** strMysqlAllowedValuesTipDate / …Time: the tooltip of a `.datefield` / `.timefield` (and the picker's note) */
export function pickerTip(kind: PickerKind): string | undefined {
  if (kind === 'time')
    return t(
      'MySQL accepts additional values not selectable by the slider; key in those values directly if desired',
    )
  if (kind === 'date')
    return t(
      'MySQL accepts additional values not selectable by the datepicker; key in those values directly if desired',
    )
  return undefined
}

/**
 * The calendar trigger of `.datefield/.timefield/.datetimefield` (addDateTimePicker): phpMyAdmin's
 * jQuery UI date and time picker, the fractional seconds following the column precision.
 * pma: resources/js/modules/functions.ts::addDateTimePicker
 */
export function DateTimePicker({
  kind,
  decimals,
  value,
  onPick,
}: {
  kind: PickerKind
  decimals: number
  value: string
  onPick: (v: string) => void
}) {
  const { FirstDayOfCalendar } = useUiSettings()
  const tip = pickerTip(kind)
  return (
    <DateTimeTrigger
      kind={kind}
      value={value}
      onChange={onPick}
      options={pickerOptionsFor(kind, decimals, FirstDayOfCalendar)}
      // jQuery UI's buttonText, the title and alt of the trigger image
      title="..."
      {...(tip !== undefined ? { note: tip } : {})}
    />
  )
}

/** The NULL cell (column_row.twig, nullable columns only). */
export function NullCheckbox({
  col,
  idx,
  rowId,
  checked,
  onChange,
}: {
  col: InsertColumn
  idx: number
  rowId: number
  checked: boolean
  onChange: (v: boolean) => void
}) {
  if (!col.isNull) return null
  return (
    <Checkbox
      id={`field_${idx}_2`}
      className="checkbox_null"
      name={`fields_null[multi_edit][${rowId}][${col.md5}]`}
      aria-label={t('Use the NULL value for this column.')}
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
    />
  )
}
