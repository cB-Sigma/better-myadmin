import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import { ConfigFile, arrayRemove, flatArray } from '../../src/preferences/config-file.ts'
import { validateSelect } from '../../src/preferences/form-display.ts'
import { qrMatrix } from '../../src/preferences/qr.ts'
import { prefsMessage } from '../../src/preferences/service.ts'
import { base32Decode, oathTotp, otpauthUrl, verifyKey } from '../../src/preferences/totp.ts'
import { pcreError, validate } from '../../src/preferences/validator.ts'

const tr = englishTranslator()

describe('preferences validators (pma: Config/Validator.php)', () => {
  it('[p08-d2dece] number validators skip empty values like PHP empty()', () => {
    expect(validate(tr, ['MaxRows'], { MaxRows: 0 }, {})).toEqual({})
    expect(validate(tr, ['MaxRows'], { MaxRows: '1.5' }, {})).toEqual({ MaxRows: ['Not a positive number!'] })
    expect(validate(tr, ['NavigationWidth'], { NavigationWidth: -1 }, {})).toEqual({
      NavigationWidth: ['Not a non-negative number!'],
    })
  })

  it('[p08-8ef8d5] upper bounds come from the base configuration', () => {
    expect(validate(tr, ['MaxDbList'], { MaxDbList: 200 }, { MaxDbList: 100 })).toEqual({
      MaxDbList: ['Value must be less than or equal to 100!'],
    })
    expect(validate(tr, ['MaxDbList'], { MaxDbList: 100 }, { MaxDbList: 100 })).toEqual({})
  })

  it('[p08-84b620] MemoryLimit and CSV characters by regex', () => {
    expect(validate(tr, ['Import/csv_terminated'], { 'Import/csv_terminated': 'ab' }, {})).toEqual({
      'Import/csv_terminated': ['Incorrect value!'],
    })
    expect(validate(tr, ['Import/csv_enclosed'], { 'Import/csv_enclosed': '' }, {})).toEqual({})
  })

  it('PCRE errors in PHP wording', () => {
    expect(pcreError('ab(')).toBe('Compilation failed: missing closing parenthesis at offset 3')
    expect(pcreError('a/b')).toBe("Unknown modifier 'b'")
    expect(pcreError('a\\')).toBe("No ending delimiter '/' found")
    expect(pcreError('^test')).toBeNull()
  })
})

describe('ConfigFile (pma: Config/ConfigFile.php)', () => {
  it('flattens nested arrays but keeps lists, drops empty arrays', () => {
    expect(flatArray({ a: { b: 1, c: [1, 2] }, d: [], e: [null, 5] })).toEqual({
      'a/b': 1,
      'a/c': [1, 2],
      'e/0': null,
      'e/1': 5,
    })
  })

  it('removes empty parents', () => {
    const a: Record<string, unknown> = { x: { y: { z: 1 } }, k: 2 }
    arrayRemove('x/y/z', a)
    expect(a).toEqual({ k: 2 })
  })

  it('[p08-9b4f97] stores only values differing from the default or from config.inc.php', () => {
    const cf = new ConfigFile({ MaxRows: 50, Order: 'SMART' }, { MaxRows: 25, Order: 'SMART' })
    cf.set('MaxRows', 25)
    cf.set('Order', 'SMART')
    expect(cf.getConfigArray()).toEqual({ MaxRows: 25 })
  })

  it('[p08-5102df] maps Servers/1/hide_db to Server/hide_db at the end', () => {
    const cf = new ConfigFile({}, { A: 1, Servers: { 1: { hide_db: '' } } })
    cf.setCfgUpdateReadMapping({ 'Server/hide_db': 'Servers/1/hide_db' })
    cf.set('Servers/1/hide_db', '^x')
    cf.set('A', 2)
    expect(Object.keys(cf.getConfigArray())).toEqual(['A', 'Server/hide_db'])
  })
})

describe('FormDisplay::validateSelect', () => {
  const keys = [{ key: 0 }, { key: 'blob' }, { key: 'all' }]
  it('casts to the key type and keeps booleans', () => {
    expect(validateSelect('0', keys)).toEqual({ ok: true, value: 0 })
    expect(validateSelect(false, keys)).toEqual({ ok: true, value: false })
    expect(validateSelect('blob', keys)).toEqual({ ok: true, value: 'blob' })
    expect(validateSelect('x', keys)).toEqual({ ok: false })
    expect(validateSelect('25', [{ key: 25 }])).toEqual({ ok: true, value: 25 })
  })
})

describe('TOTP (pragmarx/google2fa)', () => {
  it('matches RFC 6238 SHA1 vectors', () => {
    // RFC 6238 secret "12345678901234567890" = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(base32Decode(secret).toString()).toBe('12345678901234567890')
    expect(oathTotp(secret, Math.floor(59 / 30))).toBe('287082')
    expect(oathTotp(secret, Math.floor(1111111109 / 30))).toBe('081804')
    expect(verifyKey(secret, '081804', 8, 1111111109 + 8 * 30)).toBe(true)
    expect(verifyKey(secret, '081804', 8, 1111111109 + 9 * 30)).toBe(false)
  })

  it('[p08-3db3a5] otpauth URL with the phpMyAdmin (<host>) label', () => {
    expect(otpauthUrl('phpMyAdmin (localhost:8080)', 'root', 'ABC')).toBe(
      'otpauth://totp/phpMyAdmin%20%28localhost%3A8080%29:root?secret=ABC&issuer=phpMyAdmin%20%28localhost%3A8080%29&algorithm=SHA1&digits=6&period=30',
    )
  })
})

describe('QR encoder', () => {
  it('produces a square matrix with the finder patterns', () => {
    const m = qrMatrix('otpauth://totp/phpMyAdmin%20%28localhost%29:root?secret=ABCDEFGHIJKLMNOP&issuer=x')
    expect(m.length).toBe(m[0]?.length)
    expect(m[0]?.slice(0, 7)).toBe('1111111')
    expect(m[1]?.slice(0, 7)).toBe('1000001')
  })
})

describe('UserPreferences::save failure message', () => {
  it('the error, the control link error and the inaccessible-storage notice', () => {
    expect(
      prefsMessage(tr, { type: 'error', text: 'Could not save configuration', detail: 'denied' }).text,
    ).toBe('Could not save configuration<br><br>denied')
    expect(
      prefsMessage(tr, {
        type: 'error',
        text: 'Could not save configuration',
        detail: 'x',
        inaccessible: true,
      }).text,
    ).toBe(
      'Could not save configuration<br><br>x<br><br>The phpMyAdmin configuration storage database could not be accessed.',
    )
  })
})
