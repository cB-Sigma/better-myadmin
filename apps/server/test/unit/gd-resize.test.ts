import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { formatSize, resizeImage } from '../../src/insert-edit/wrapper.ts'

/**
 * The transformation wrapper's thumbnails (resize=jpeg|png) against PHP's GD: the fixtures are GD's
 * own output (test/fixtures/gd-resize/gen.php). The PNG pixels are GD's exactly (imagecopyresampled
 * and the alpha blending onto the black canvas are ported); the files' bytes are not, as zlib and
 * the PNG filters differ. A JPEG has GD's size and format, its pixels within the encoders' noise.
 */
const dir = join(import.meta.dirname, '../fixtures/gd-resize')
const file = (name: string) => readFileSync(join(dir, name))
const pixels = (png: Buffer) => {
  const p = PNG.sync.read(png)
  return { width: p.width, height: p.height, rgb: [...p.data].filter((_, i) => i % 4 !== 3) }
}

describe('resize=png: GD pixels exactly', () => {
  it.each([
    ['opaque.png', 30, 30, 'opaque-30x30.png'],
    ['opaque.png', 200, 100, 'opaque-200x100.png'],
    ['alpha.png', 23, 23, 'alpha-23x23.png'],
    ['palette.gif', 16, 16, 'palette-16x16.png'],
  ])('%s into %ix%i', (src, w, h, expected) => {
    const ours = resizeImage(file(src), 'png', w, h)
    expect(ours).not.toBeNull()
    expect(pixels(ours as Buffer)).toEqual(pixels(file(expected)))
  })

  it('a JPEG source: GD size, pixels within the JPEG decoders’ rounding', () => {
    const ours = pixels(resizeImage(file('photo.jpg'), 'png', 41, 41) as Buffer)
    const gd = pixels(file('photo-41x41.png'))
    expect([ours.width, ours.height]).toEqual([gd.width, gd.height])
    const diff = Math.max(...ours.rgb.map((v, i) => Math.abs(v - (gd.rgb[i] as number))))
    expect(diff).toBeLessThanOrEqual(3)
  })
})

describe('resize=jpeg', () => {
  it('a quality-75 JPEG of GD’s size, close to the resampled pixels (X50: 4:4:4, GD writes 4:2:0)', () => {
    const ours = resizeImage(file('opaque.png'), 'jpeg', 50, 40) as Buffer
    expect(ours.subarray(0, 3).toString('hex')).toBe('ffd8ff')
    const a = jpeg.decode(ours, { formatAsRGBA: true })
    const gd = jpeg.decode(file('opaque-50x40.jpg'), { formatAsRGBA: true })
    expect([a.width, a.height]).toEqual([gd.width, gd.height])
    // the exact thumbnail (GD's resampled pixels, as the PNG cases show) against both encodings
    const truth = PNG.sync.read(resizeImage(file('opaque.png'), 'png', 50, 40) as Buffer).data
    const error = (img: { data: Uint8Array }) => {
      let sum = 0
      for (let i = 0; i < img.data.length; i++)
        if (i % 4 !== 3) sum += Math.abs((img.data[i] as number) - (truth[i] as number))
      return sum / ((img.data.length * 3) / 4)
    }
    expect(error(a)).toBeLessThanOrEqual(error(gd))
  })
})

describe('not an image, sizes', () => {
  it('imagecreatefromstring fails: null (the wrapper sends an empty body)', () => {
    expect(resizeImage(Buffer.from('not an image'), 'png', 10, 10)).toBeNull()
  })

  it('formatSize: 1 below 2 or not numeric, 2000 at most', () => {
    expect([undefined, '', 'x', '1', '2', '150', '2000', '99999', '12.7'].map(formatSize)).toEqual([
      1, 1, 1, 1, 2, 150, 2000, 2000, 12,
    ])
  })
})
