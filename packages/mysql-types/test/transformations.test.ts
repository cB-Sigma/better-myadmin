import { describe, expect, it } from 'vitest'
import {
  applyInputTransformation,
  applyOutputTransformation,
  findTransformationPlugin,
  getAvailableMimeTypes,
  inetNtop,
  inetPton,
  parseTransformationOptions,
  transformationNoWrap,
} from '../src/transformations.ts'

const html = (file: string, v: string | Uint8Array, o: string[] = [], ctx = {}) => {
  const r = applyOutputTransformation(file, v, o, ctx)
  return 'html' in r ? r.html : `SQL:${r.sql}`
}

describe('Transformations::getOptions', () => {
  it('splits on commas, keeps quoted commas, strips quotes and slashes', () => {
    expect(parseTransformationOptions("'option ,, quoted',abd,'2,3',")).toEqual([
      'option ,, quoted',
      'abd',
      '2,3',
      '',
    ])
    expect(parseTransformationOptions('')).toEqual([])
    expect(parseTransformationOptions("'a\\'b'")).toEqual(["a'b"])
  })
})

describe('plugin catalog', () => {
  it('finds stored file names case-insensitively', () => {
    expect(findTransformationPlugin('output/text_plain_dateformat.php')?.name).toBe('Date Format')
    expect(findTransformationPlugin('Input/Image_JPEG_Upload.php')?.kind).toBe('input')
  })
  it('lists input transformations then the root plugins [p03-e852ea]', () => {
    const t = getAvailableMimeTypes()
    expect(t.mimetype).toEqual([
      'Image/JPEG',
      'Text/Plain',
      'Application/Octetstream',
      'Image/PNG',
      'Text/Octetstream',
    ])
    expect(t.input_transformation.map((p) => p.label).slice(-4)).toEqual([
      'Link',
      'Longtoipv4',
      'PreApPend',
      'Substring',
    ])
    expect(t.transformation).toHaveLength(19)
  })
})

describe('output plugins', () => {
  it('Hex, Bool2Text, Substring, PreApPend, Long To IPv4', () => {
    expect(html('Output/Application_Octetstream_Hex', new Uint8Array([1, 2, 255]))).toBe('01 02 ff ')
    expect(html('Output/Application_Octetstream_Hex', 'ab', ['0'])).toBe('6162')
    expect(html('Output/Text_Plain_Bool2Text', '0')).toBe('F')
    expect(html('Output/Text_Plain_Bool2Text', '5', ['yes', 'no'])).toBe('yes')
    expect(html('Text_Plain_Substring', 'abcdef', ['1', '3'])).toBe('…bcd…')
    expect(html('Text_Plain_PreApPend', '<x>', ['[', ']'])).toBe('[&lt;x&gt;]')
    expect(html('Text_Plain_Longtoipv4', '3232235777')).toBe('192.168.1.1')
  })
  it('links only for safe URLs', () => {
    expect(html('Text_Plain_Link', 'x', ['https://e.org/'])).toBe(
      '<a href="https://e.org/x" title="" target="_blank" rel="noopener noreferrer">x</a>',
    )
    expect(html('Text_Plain_Link', 'javascript:alert(1)')).toBe('javascript:alert(1)')
  })
  it('wrapper links, SQL, JSON, Formatted, External', () => {
    const wrapperUrl = (e?: Record<string, string>) => `w?${new URLSearchParams(e)}`
    expect(html('Output/Application_Octetstream_Download', 'x', [], { wrapperUrl })).toContain(
      'cn=binary_file.dat',
    )
    expect(html('Output/Text_Plain_Sql', 'SELECT 1')).toBe('SQL:SELECT 1')
    expect(html('Output/Text_Plain_Json', '{"a":1}')).toBe(
      '<pre><code class="json">{&quot;a&quot;:1}</code></pre>',
    )
    expect(html('Output/Text_Plain_Formatted', '<b class="x">')).toBe(
      '<iframe srcdoc="<b class=\'x\'>" sandbox=""></iframe>',
    )
    expect(html('Output/Text_Plain_External', '<p>')).toBe('<p>')
    expect(transformationNoWrap('Output/Text_Plain_External', [])).toBe(true)
  })
  it('Date Format in UTC', () => {
    expect(
      html('Output/Text_Plain_Dateformat', '0', ['', 'Y-m-d', 'utc'], { meta: { isInt: true } }),
    ).toContain('>1970-01-01</dfn>')
  })
  it('Binary To IPv4/IPv6', () => {
    expect(html('Output/Text_Plain_Binarytoip', '0x7f000001')).toBe('127.0.0.1')
  })
})

describe('input plugins', () => {
  it('IP to binary / long, regex validation, root plugins are not input plugins', () => {
    expect(applyInputTransformation('Input/Text_Plain_Iptobinary.php', '10.0.0.1').value).toBe('0x0a000001')
    expect(applyInputTransformation('Input/Text_Plain_Iptolong.php', '1.2.3.4').value).toBe('16909060')
    const re = applyInputTransformation('Input/Text_Plain_RegexValidation.php', 'A1', ['/^[a-z]+$/'], {
      pregMatch: (p, s) => new RegExp(p.slice(1, -1)).test(s),
    })
    expect(re).toEqual({ value: 'A1', success: false, error: 'Validation failed for the input string A1.' })
    expect(applyInputTransformation('Text_Plain_PreApPend.php', 'x', ['a', 'b']).value).toBe('x')
  })
  it('inet_pton / inet_ntop', () => {
    const v6 = inetPton('2001:db8::1')
    expect(v6 && inetNtop(v6)).toBe('2001:db8::1')
    expect(inetPton('nope')).toBe(false)
  })
})
