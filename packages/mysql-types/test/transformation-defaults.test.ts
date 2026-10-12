import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSFORMATIONS,
  type DefaultTransformations,
  applyOutputTransformation,
} from '../src/transformations.ts'

/**
 * `$cfg['DefaultTransformations']`: a column without options takes the configured ones
 * (TransformationsPlugin::getOptions($options, $cfg['DefaultTransformations'][name])), and
 * `GD2Available` = 'no' replaces the Inline thumbnail link by the 320×240 image.
 */
const html = (file: string, value: string, defaults: Partial<DefaultTransformations> = {}, gd2 = true) => {
  const out = applyOutputTransformation(file, value, [], {
    defaults: { ...DEFAULT_TRANSFORMATIONS, ...defaults },
    wrapperUrl: (extra) => `w?${new URLSearchParams(extra ?? {})}`,
    gd2,
    t: (s) => s,
  })
  return 'html' in out ? out.html : out.sql
}

describe('DefaultTransformations', () => {
  it('Substring, PreApPend, Bool2Text, Hex take the configured options', () => {
    expect(html('Text_Plain_Substring', 'abcdef', { Substring: [1, 2, '+'] })).toBe('+bc+')
    expect(html('Text_Plain_PreApPend', 'x', { PreApPend: ['<', '>'] })).toBe('&lt;x&gt;')
    expect(html('Output/Text_Plain_Bool2Text', '1', { Bool2Text: ['yes', 'no'] })).toBe('yes')
    expect(html('Output/Application_Octetstream_Hex', 'ab', { Hex: ['1'] })).not.toBe(
      html('Output/Application_Octetstream_Hex', 'ab'),
    )
  })

  it('DateFormat, TextLink, TextImageLink take the configured options', () => {
    expect(html('Output/Text_Plain_Dateformat', '86400', { DateFormat: [0, '%d', 'utc'] })).not.toBe(
      html('Output/Text_Plain_Dateformat', '86400'),
    )
    expect(html('Text_Plain_Link', 'page', { TextLink: ['https://example.org/', 'title', null] })).toContain(
      'https://example.org/page',
    )
    expect(
      html('Output/Text_Plain_Imagelink', 'a.png', { TextImageLink: ['https://img/', 33, 44] }),
    ).toContain('width="33"')
  })

  it('Inline: the thumbnail size, and the plain image without GD2', () => {
    const big = html('Output/Image_JPEG_Inline', 'x', { Inline: [200, 150] })
    expect(big).toContain('newWidth=200')
    expect(big).toContain('newHeight=150')
    expect(html('Output/Image_JPEG_Inline', 'x', {}, false)).toContain('width="320" height="240"')
  })
})
