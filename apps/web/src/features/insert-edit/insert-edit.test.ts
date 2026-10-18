import { describe, expect, it } from 'vitest'
import { generateWkt, initialValue, parseGeom, resultValue } from '../gis/gis'
import { arrowTarget, fieldIndex, isDateTime, validateCell } from './logic'

describe('GIS data editor model', () => {
  it('generates WKT with phpMyAdmin minimum point counts [p03-6f8311]', () => {
    expect(generateWkt({ type: 'LINESTRING', points: [{ x: '1', y: '2' }] })).toBe('LINESTRING(1 2, )')
    expect(generateWkt({ type: 'POLYGON', lines: [[{ x: '0', y: '0' }]] }, '0')).toBe(
      'POLYGON((0 0,0 0,0 0,0 0))',
    )
  })
  it('round-trips a value with SRID [p03-6f8311]', () => {
    const v = initialValue('geometry', "'MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))',4326")
    expect(v.type).toBe('MULTIPOLYGON')
    expect(resultValue(v.value)).toBe("'MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))',4326")
    expect(parseGeom('GEOMETRYCOLLECTION(POINT(1 2),LINESTRING(0 0,1 1))')?.type).toBe('GEOMETRYCOLLECTION')
  })
  it('a fixed column type wins over the value [p03-6f8311]', () => {
    expect(initialValue('point', '').type).toBe('POINT')
    expect(resultValue(initialValue('point', '').value)).toBe("'POINT(0 0)',0")
  })
})

describe('Insert/Edit form rules', () => {
  it('field ids and Ctrl+arrow targets (keyhandler.ts) [p03-ae6d6f]', () => {
    expect(fieldIndex(1, 5, 2)).toBe(8)
    expect(arrowTarget('field_8_3', 'ArrowUp')).toEqual(['field_7_3', 'field_7_3_0'])
    expect(arrowTarget('field_8_3', 'ArrowLeft')).toEqual(['field_8_2', 'field_8_2_0'])
  })
  it('date/time validation [p03-7f7f64]', () => {
    expect(isDateTime('CURRENT_TIMESTAMP', 'datetime')).toBe(true)
    expect(isDateTime('2020-02-30', 'date')).toBe(false)
    expect(isDateTime('2040-01-01 00:00:00', 'timestamp')).toBe(false)
    expect(isDateTime('838:59:59', 'time')).toBe(true)
  })
})

describe('function select rules (change.ts validationFunctionForMd5 / ForAesDesEncrypt)', () => {
  const text = (maxlength: number | null, dataType: string) =>
    ({ widget: { kind: 'text', size: 20, maxlength, min: null, max: null, dataType, picker: null } }) as never
  const state = (fn: string) => ({ fn, isNull: false, value: 'x' }) as never
  const col = { trueType: 'varchar', isChar: true } as never
  const tr = (m: string) => m
  it('MD5 into a column shorter than 32 characters', () => {
    expect(validateCell(col, text(20, 'CHAR'), state('MD5'), tr)).toBe(
      'This column can not contain a 32 chars value',
    )
    expect(validateCell(col, text(40, 'CHAR'), state('MD5'), tr)).toBeNull()
  })
  it('AES_ENCRYPT / DES_ENCRYPT outside a CHAR or HEX column', () => {
    expect(validateCell(col, text(null, 'NUMBER'), state('AES_ENCRYPT'), tr)).toMatch(
      /^These functions are meant/,
    )
    expect(validateCell(col, text(null, 'CHAR'), state('DES_ENCRYPT'), tr)).toBeNull()
    expect(
      validateCell(col, { widget: { kind: 'hex-input', size: 10 } } as never, state('AES_ENCRYPT'), tr),
    ).toBeNull()
  })
})
