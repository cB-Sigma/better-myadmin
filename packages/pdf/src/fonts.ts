import { readFileSync } from 'node:fs'
import * as fontkitModule from '@pdf-lib/fontkit'

/**
 * The PDF font: DejaVu Sans, regular and bold, the font phpMyAdmin's PDFs use (Pdf::PMA_PDF_FONT,
 * TCPDF's dejavusans / dejavusansb). Bundled as TrueType in ../fonts (Bitstream Vera license, see
 * ../fonts/LICENSE) and embedded as a subset, so any text the font covers renders.
 * pma: src/Pdf.php::__construct (AddFont('DejaVuSans', '', …), AddFont('DejaVuSans', 'B', …))
 */
export type FontStyle = '' | 'B'

/** the part of fontkit's API used here (its module is UMD: the functions may sit on `default`) */
interface FontkitFont {
  unitsPerEm: number
  ascent: number
  descent: number
  hasGlyphForCodePoint(codePoint: number): boolean
  glyphForCodePoint(codePoint: number): { advanceWidth: number }
}
export interface Fontkit {
  // biome-ignore lint/suspicious/noExplicitAny: handed to pdf-lib's registerFontkit as is
  create(buffer: Uint8Array, postscriptName?: string): any
}

const mod = fontkitModule as unknown as Partial<Fontkit> & { default?: Fontkit }
export const fontkit: Fontkit = typeof mod.create === 'function' ? (mod as Fontkit) : (mod.default as Fontkit)

const FILES: Record<FontStyle, string> = { '': 'DejaVuSans.ttf', B: 'DejaVuSans-Bold.ttf' }

/** TCPDF's MissingWidth of dejavusans (the width of a character the font lacks) */
const MISSING_WIDTH = 600

export interface FontData {
  bytes: Uint8Array
  /** Ascent / Descent of the font descriptor, in 1/1000 em (Descent negative) */
  ascent: number
  descent: number
  /** TCPDF's `cw`: the advance width of a code point, in 1/1000 em */
  charWidth(codePoint: number): number
}

const cache = new Map<FontStyle, FontData>()

/** The font of a style, read and parsed once per process. */
export function fontData(style: FontStyle): FontData {
  const hit = cache.get(style)
  if (hit !== undefined) return hit
  const bytes = new Uint8Array(readFileSync(new URL(`../fonts/${FILES[style]}`, import.meta.url)))
  const font = fontkit.create(bytes) as FontkitFont
  const scale = 1000 / font.unitsPerEm
  const widths = new Map<number, number>()
  const data: FontData = {
    bytes,
    ascent: Math.round(font.ascent * scale),
    descent: Math.round(font.descent * scale),
    charWidth(cp) {
      let w = widths.get(cp)
      if (w === undefined) {
        w = font.hasGlyphForCodePoint(cp)
          ? Math.round(font.glyphForCodePoint(cp).advanceWidth * scale)
          : MISSING_WIDTH
        widths.set(cp, w)
      }
      return w
    },
  }
  cache.set(style, data)
  return data
}
