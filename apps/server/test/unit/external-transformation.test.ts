import { describe, expect, it } from 'vitest'
import { runExternalTransformation } from '../../src/browse/external.ts'
import { requestScope, runInRequestScope } from '../../src/db/request-scope.ts'

/**
 * Text_Plain_External with programs configured (ExternalTransformationsPlugin::applyTransformation):
 * the value on standard input, the output (escaped when the third option is 1 or 2), the program
 * picked by the first option, no shell, the deprecated second option's notice.
 */
const TR = '/usr/bin/tr a-z A-Z'
const NO_OPTIONS = [0, '', 1, 1] // DefaultTransformations.External with an empty options field

describe('runExternalTransformation', () => {
  it('feeds the value to the program and shows its output, escaped by default', () => {
    expect(runExternalTransformation([TR], [], Buffer.from('<b>hi</b>'), NO_OPTIONS)).toBe(
      '&lt;B&gt;HI&lt;/B&gt;',
    )
  })

  it('third option 0: the output as HTML; the first option picks the program, else the first', () => {
    expect(
      runExternalTransformation(['/bin/cat', TR], ['1', '', '0'], Buffer.from('<i>x</i>'), NO_OPTIONS),
    ).toBe('<I>X</I>')
    expect(runExternalTransformation(['/bin/cat'], ['5', '', '0'], Buffer.from('x'), NO_OPTIONS)).toBe('x')
  })

  it('no shell: the arguments are words, a missing program shows nothing', () => {
    // a shell would run the second command
    expect(
      runExternalTransformation(['/bin/echo a;', '/bin/cat'], ['0', '', '0'], Buffer.from(''), NO_OPTIONS),
    ).toBe('a;\n')
    expect(runExternalTransformation(['/nonexistent/program'], [], Buffer.from('x'), NO_OPTIONS)).toBe('')
  })

  it("the options field: extra arguments and phpMyAdmin's deprecation notice (also from the defaults)", async () => {
    await runInRequestScope(async () => {
      expect(
        runExternalTransformation(['/bin/echo'], ['0', '-n hello', '0'], Buffer.from(''), NO_OPTIONS),
      ).toBe('hello')
      expect(requestScope()?.userErrors).toEqual([{ kind: 'external-options' }])
    })
    await runInRequestScope(async () => {
      runExternalTransformation(['/bin/cat'], [], Buffer.from('x'))
      // DefaultTransformations.External[1] is '-f /dev/null -i -wrap -q'
      expect(requestScope()?.userErrors).toEqual([{ kind: 'external-options' }])
    })
    await runInRequestScope(async () => {
      runExternalTransformation(['/bin/cat'], [], Buffer.from('x'), NO_OPTIONS)
      expect(requestScope()?.userErrors).toEqual([])
    })
  })
})
