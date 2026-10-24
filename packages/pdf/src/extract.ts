import { inflateSync } from 'node:zlib'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  type PDFRef,
  PDFStream,
} from 'pdf-lib'

export interface PdfInspection {
  title: string
  author: string
  pages: Array<{
    width: number
    height: number
    /** each shown string on its own line, in drawing order */
    text: string
    /** link annotations */
    links: number
  }>
  /** the outline (bookmark) titles, depth first, indented by two spaces per level */
  outline: string[]
}

/**
 * What a PDF this package wrote holds: its pages' size and text (the glyph ids of every Tj decoded
 * through the fonts' ToUnicode maps), links and bookmarks. For tests and diagnostics, not a general
 * PDF reader.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const data = (s: unknown): Buffer => {
    if (!(s instanceof PDFRawStream)) return Buffer.alloc(0)
    const filter = s.dict.get(PDFName.of('Filter'))
    const raw = Buffer.from(s.contents)
    return filter instanceof PDFName && filter.asString() === '/FlateDecode' ? inflateSync(raw) : raw
  }
  const cmaps = new Map<string, Map<string, string>>()
  const cmapOf = (fontRef: unknown): Map<string, string> => {
    const key = String(fontRef)
    const hit = cmaps.get(key)
    if (hit !== undefined) return hit
    const map = new Map<string, string>()
    const font = ctx.lookup(fontRef as PDFRef)
    if (font instanceof PDFDict) {
      const text = data(ctx.lookup(font.get(PDFName.of('ToUnicode')) as PDFRef)).toString('latin1')
      const hex = (h: string) => Buffer.from(h, 'hex').swap16().toString('utf16le')
      for (const [, body] of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const [, g, u] of (body ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
          map.set((g ?? '').toLowerCase(), hex(u ?? ''))
      }
      for (const [, body] of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const [, a, b, u] of (body ?? '').matchAll(
          /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
        )) {
          const from = Number.parseInt(a ?? '0', 16)
          const to = Number.parseInt(b ?? '0', 16)
          const base = Number.parseInt(u ?? '0', 16)
          for (let g = from; g <= to; g++)
            map.set(g.toString(16).padStart(4, '0'), String.fromCodePoint(base + g - from))
        }
      }
    }
    cmaps.set(key, map)
    return map
  }
  const out: PdfInspection['pages'] = []
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)
    const contents = page.node.Contents()
    const streams: unknown[] =
      contents instanceof PDFArray
        ? contents.asArray().map((r) => ctx.lookup(r))
        : contents instanceof PDFStream
          ? [contents]
          : []
    const lines: string[] = []
    let cmap = new Map<string, string>()
    for (const s of streams) {
      const content = data(s).toString('latin1')
      for (const m of content.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (m[1] !== undefined) {
          cmap = cmapOf(fonts?.get(PDFName.of(m[1])))
          continue
        }
        const glyphs = (m[2] ?? '').match(/.{4}/g) ?? []
        lines.push(glyphs.map((g) => cmap.get(g.toLowerCase()) ?? '\ufffd').join(''))
      }
    }
    const annots = page.node.Annots()
    out.push({ ...page.getSize(), text: lines.join('\n'), links: annots === undefined ? 0 : annots.size() })
  }
  const outline: string[] = []
  const walk = (ref: unknown, depth: number) => {
    let node = ctx.lookup(ref as PDFRef)
    while (node instanceof PDFDict) {
      const title = node.get(PDFName.of('Title'))
      outline.push(`${'  '.repeat(depth)}${title instanceof PDFHexString ? title.decodeText() : ''}`)
      const first = node.get(PDFName.of('First'))
      if (first !== undefined) walk(first, depth + 1)
      const next = node.get(PDFName.of('Next'))
      node = next === undefined ? undefined : ctx.lookup(next as PDFRef)
    }
  }
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  const first = root?.get(PDFName.of('First'))
  if (first !== undefined) walk(first, 0)
  return { title: doc.getTitle() ?? '', author: doc.getAuthor() ?? '', pages: out, outline }
}
