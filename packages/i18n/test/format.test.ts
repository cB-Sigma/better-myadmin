import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convertBBCode } from '../src/bbcode.ts'
import {
  formatByteDown,
  formatNumber,
  getFormattedMaximumUploadSize,
  localisedDate,
  timespanFormat,
} from '../src/format.ts'
import { translatorFor } from '../src/node.ts'
import { type SprintfArg, numberFormat, phpRound, sprintf } from '../src/php.ts'

type Num = number | string
interface FormatFixture {
  locales: Record<
    string,
    {
      formatNumber: Array<[Num, [number, number, boolean, boolean], string]>
      formatByteDown: Array<[Num | null, [number, number], [string, string] | null]>
      timespanFormat: Array<[number, string]>
      localisedDate: Array<[number, string, string]>
      upload: Array<[Num, string]>
    }
  >
  runtime: {
    round: Array<[number, number, number]>
    number_format: Array<[number, number, string]>
    sprintf: Array<[string, SprintfArg[], string]>
  }
}

const load = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
const fx = load<FormatFixture>('format.json')
const bb = load<{ locales: Record<string, Array<[string, string, string]>> }>('bbcode.json')

describe('PHP runtime pieces', () => {
  it('round()', () => {
    for (const [v, p, expected] of fx.runtime.round)
      expect(phpRound(v, p), `round(${v}, ${p})`).toBe(expected)
  })
  it('number_format()', () => {
    for (const [v, p, expected] of fx.runtime.number_format) {
      expect(numberFormat(v, p, '.', ','), `number_format(${v}, ${p})`).toBe(expected)
    }
  })
  it('sprintf()', () => {
    for (const [f, args, expected] of fx.runtime.sprintf) expect(sprintf(f, ...args), f).toBe(expected)
  })
})

for (const [code, data] of Object.entries(fx.locales)) {
  describe(`Util helpers — ${code}`, () => {
    const t = translatorFor(code)
    it('formatNumber', () => {
      for (const [v, p, expected] of data.formatNumber) {
        expect(formatNumber(t, v, ...p), `formatNumber(${v}, ${p.join(', ')})`).toBe(expected)
      }
    })
    it('formatByteDown', () => {
      for (const [v, p, expected] of data.formatByteDown) {
        expect(formatByteDown(t, v, ...p), `formatByteDown(${v}, ${p.join(', ')})`).toEqual(expected)
      }
    })
    it('timespanFormat', () => {
      for (const [s, expected] of data.timespanFormat) expect(timespanFormat(t, s)).toBe(expected)
    })
    it('localisedDate', () => {
      for (const [ts, f, expected] of data.localisedDate) {
        expect(localisedDate(t, ts, f), `localisedDate(@${ts}, ${JSON.stringify(f)})`).toBe(expected)
      }
    })
    it('getFormattedMaximumUploadSize', () => {
      for (const [v, expected] of data.upload) expect(getFormattedMaximumUploadSize(t, v)).toBe(expected)
    })
  })
}

describe('Sanitize::convertBBCode', () => {
  for (const [code, rows] of Object.entries(bb.locales)) {
    it(code, () => {
      const t = translatorFor(code)
      for (const [msg, unsafe, safe] of rows) {
        // the fixtures are phpMyAdmin's output: its documentation base (ours is DOCS_BASE, X57)
        const docsBase = 'https://docs.phpmyadmin.net/en/latest/'
        expect(convertBBCode(t, msg, false, { docsBase }), msg).toBe(unsafe)
        expect(convertBBCode(t, msg, true, { docsBase }), msg).toBe(safe)
      }
    })
  }
})
