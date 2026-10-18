/**
 * The GD calls of the transformation wrapper's thumbnails, on pure-JS codecs (jpeg-js, pngjs,
 * omggif): imagecreatefromstring, imagecreatetruecolor, imagecopyresampled, imagejpeg, imagepng.
 * Pixels are GD truecolor values: `alpha << 24 | red << 16 | green << 8 | blue`, alpha 0 (opaque)
 * to 127 (transparent).
 * pma: src/Image/ImageWrapper.php; libgd 2.3: gd.c (gdImageCopyResampled, gdAlphaBlend),
 *      gd_png.c / gd_gif_in.c / gd_jpeg.c (the readers' alpha)
 */
import jpeg from 'jpeg-js'
import { GifReader } from 'omggif'
import { PNG } from 'pngjs'

export interface GdImage {
  width: number
  height: number
  px: Uint32Array
}

const ALPHA_MAX = 127

const pack = (a: number, r: number, g: number, b: number) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0

/** RGBA bytes (8-bit alpha) → GD pixels (gd_png.c: alpha = gdAlphaMax - (a >> 1)) */
function fromRgba(width: number, height: number, rgba: Uint8Array | Buffer): GdImage {
  const px = new Uint32Array(width * height)
  for (let i = 0; i < px.length; i++) {
    const o = i * 4
    px[i] = pack(
      ALPHA_MAX - ((rgba[o + 3] as number) >> 1),
      rgba[o] as number,
      rgba[o + 1] as number,
      rgba[o + 2] as number,
    )
  }
  return { width, height, px }
}

/** imagecreatefromstring for the formats the wrapper's images use; null when not an image */
export function imageFromString(buf: Buffer): GdImage | null {
  try {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 })
      return fromRgba(d.width, d.height, d.data)
    }
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      const p = PNG.sync.read(buf)
      return fromRgba(p.width, p.height, p.data)
    }
    if (buf.subarray(0, 4).toString('latin1') === 'GIF8') {
      const g = new GifReader(new Uint8Array(buf))
      const rgba = new Uint8Array(g.width * g.height * 4)
      g.decodeAndBlitFrameRGBA(0, rgba)
      return fromRgba(g.width, g.height, rgba)
    }
  } catch {
    return null
  }
  return null
}

/** imagecreatetruecolor: black, opaque */
export function createTrueColor(width: number, height: number): GdImage {
  return { width, height, px: new Uint32Array(width * height) }
}

const alphaOf = (p: number) => (p >>> 24) & 0x7f
const redOf = (p: number) => (p >>> 16) & 0xff
const greenOf = (p: number) => (p >>> 8) & 0xff
const blueOf = (p: number) => p & 0xff

/** gdAlphaBlend: imagesetpixel on a truecolor image (alpha blending is on by default) */
function alphaBlend(dst: number, src: number): number {
  const srcAlpha = alphaOf(src)
  if (srcAlpha === 0) return src
  const dstAlpha = alphaOf(dst)
  if (srcAlpha === ALPHA_MAX) return dst
  if (dstAlpha === ALPHA_MAX) return src
  const srcWeight = ALPHA_MAX - srcAlpha
  const dstWeight = Math.trunc(((ALPHA_MAX - dstAlpha) * srcAlpha) / ALPHA_MAX)
  const tot = srcWeight + dstWeight
  const alpha = Math.trunc((srcAlpha * dstAlpha) / ALPHA_MAX)
  const mix = (s: number, d: number) => Math.trunc((s * srcWeight + d * dstWeight) / tot)
  return pack(
    alpha,
    mix(redOf(src), redOf(dst)),
    mix(greenOf(src), greenOf(dst)),
    mix(blueOf(src), blueOf(dst)),
  )
}

/** gdImageCopyResampled (truecolor destination): each destination pixel averages the source area it covers */
export function copyResampled(
  dst: GdImage,
  src: GdImage,
  dstX: number,
  dstY: number,
  srcX: number,
  srcY: number,
  dstW: number,
  dstH: number,
  srcW: number,
  srcH: number,
): void {
  const get = (x: number, y: number) => src.px[y * src.width + x] as number
  for (let y = dstY; y < dstY + dstH; y++) {
    const sy1 = ((y - dstY) * srcH) / dstH
    const sy2 = ((y + 1 - dstY) * srcH) / dstH
    for (let x = dstX; x < dstX + dstW; x++) {
      let spixels = 0
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let alphaSum = 0
      let contribSum = 0
      const sx1 = ((x - dstX) * srcW) / dstW
      const sx2 = ((x + 1 - dstX) * srcW) / dstW
      let sy = sy1
      do {
        let yportion: number
        if (Math.floor(sy) === Math.floor(sy1)) {
          yportion = 1 - (sy - Math.floor(sy))
          if (yportion > sy2 - sy1) yportion = sy2 - sy1
          sy = Math.floor(sy)
        } else if (sy === Math.floor(sy2)) {
          yportion = sy2 - Math.floor(sy2)
        } else {
          yportion = 1
        }
        let sx = sx1
        do {
          let xportion: number
          if (Math.floor(sx) === Math.floor(sx1)) {
            xportion = 1 - (sx - Math.floor(sx))
            if (xportion > sx2 - sx1) xportion = sx2 - sx1
            sx = Math.floor(sx)
          } else if (sx === Math.floor(sx2)) {
            xportion = sx2 - Math.floor(sx2)
          } else {
            xportion = 1
          }
          const pcontribution = xportion * yportion
          const p = get(Math.trunc(sx) + srcX, Math.trunc(sy) + srcY)
          const alphaFactor = (ALPHA_MAX - alphaOf(p)) * pcontribution
          red += redOf(p) * alphaFactor
          green += greenOf(p) * alphaFactor
          blue += blueOf(p) * alphaFactor
          alpha += alphaOf(p) * pcontribution
          alphaSum += alphaFactor
          contribSum += pcontribution
          spixels += xportion * yportion
          sx += 1
        } while (sx < sx2)
        sy += 1
      } while (sy < sy2)
      if (spixels !== 0) {
        red /= spixels
        green /= spixels
        blue /= spixels
        alpha /= spixels
      }
      if (alphaSum !== 0) {
        if (contribSum !== 0) alphaSum /= contribSum
        red /= alphaSum
        green /= alphaSum
        blue /= alphaSum
      }
      // round up to the closest channel value, clamped
      red = red >= 255.5 ? 255 : red + 0.5
      blue = blue >= 255.5 ? 255 : blue + 0.5
      green = green >= 255.5 ? 255 : green + 0.5
      alpha = alpha >= ALPHA_MAX + 0.5 ? ALPHA_MAX : alpha + 0.5
      const i = y * dst.width + x
      dst.px[i] = alphaBlend(
        dst.px[i] as number,
        pack(Math.trunc(alpha), Math.trunc(red), Math.trunc(green), Math.trunc(blue)),
      )
    }
  }
}

/** RGBA bytes of the image (alpha dropped: neither writer saves it) */
function toRgb(img: GdImage): Buffer {
  const out = Buffer.alloc(img.width * img.height * 4)
  for (let i = 0; i < img.px.length; i++) {
    const p = img.px[i] as number
    out[i * 4] = redOf(p)
    out[i * 4 + 1] = greenOf(p)
    out[i * 4 + 2] = blueOf(p)
    out[i * 4 + 3] = 0xff
  }
  return out
}

/** imagejpeg($image, null, $quality) */
export function encodeJpeg(img: GdImage, quality: number): Buffer {
  return Buffer.from(jpeg.encode({ data: toRgb(img), width: img.width, height: img.height }, quality).data)
}

/** imagepng($image): an RGB truecolor PNG (saveAlpha is off) */
export function encodePng(img: GdImage): Buffer {
  const p = new PNG({ width: img.width, height: img.height, colorType: 2 })
  toRgb(img).copy(p.data)
  return PNG.sync.write(p, { colorType: 2 })
}
