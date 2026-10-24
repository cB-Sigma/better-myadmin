import {
  type PDFArray,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  type PDFPage,
  type PDFRef,
  rgb,
} from 'pdf-lib'
import { type FontStyle, fontData, fontkit } from './fonts.ts'

/**
 * The subset of TCPDF that phpMyAdmin's PDF export and PDF relational schema use, with TCPDF's
 * geometry: user units (`pt` or `mm`), the origin at the top left, Cell / MultiCell with TCPDF's
 * cell padding, minimum cell height (font size × 1.25), vertical centring and word wrapping,
 * automatic page breaks, the page header / footer hooks (run when a page starts / ends, with the
 * default graphic state), moving back to an earlier page (`page = n`), internal links, bookmarks
 * and page-number aliases.
 *
 * Drawing is recorded per page and rendered with pdf-lib when the document is output, so links,
 * aliases (`{:ptp:}` = page count) and pages revisited later all resolve like TCPDF's.
 * pma: vendor/tecnickcom/tcpdf/tcpdf.php (6.x), src/Pdf.php
 */

export type Rgb = readonly [number, number, number]
export type Align = '' | 'L' | 'C' | 'R' | 'J'
/** 0 / 1 (frame) or the sides to draw (`'LTRB'` subsets) */
export type Border = 0 | 1 | string
/** an internal link id (addLink) or '' for none */
export type Link = number | ''

type Op =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; lw: number; color: Rgb }
  | {
      t: 'rect'
      x: number
      y: number
      w: number
      h: number
      lw: number
      stroke: Rgb | null
      fill: Rgb | null
    }
  | { t: 'text'; x: number; y: number; text: string; style: FontStyle; size: number; color: Rgb }

interface PageData {
  ops: Op[]
  links: Array<{ x: number; y: number; w: number; h: number; link: number }>
  /** pagedim: the margins and page-break mode of the page when it was started */
  tm: number
  bm: number
  olm: number
  orm: number
  pb: boolean
}

interface GraphicVars {
  style: FontStyle
  sizePt: number
  lMargin: number
  rMargin: number
  padding: { L: number; T: number; R: number; B: number }
  lineWidth: number
  drawColor: Rgb
  fillColor: Rgb
  textColor: Rgb
}

/** TCPDF_STATIC::$page_formats (points, portrait) */
const PAGE_FORMATS: Record<string, readonly [number, number]> = {
  A0: [2383.937, 3370.394],
  A1: [1683.78, 2383.937],
  A2: [1190.551, 1683.78],
  A3: [841.89, 1190.551],
  A4: [595.276, 841.89],
  A5: [419.528, 595.276],
  A6: [297.638, 419.528],
  B4: [708.661, 1000.63],
  B5: [498.898, 708.661],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
  TABLOID: [792, 1224],
  LEDGER: [1224, 792],
}

/** K_CELL_HEIGHT_RATIO */
const CELL_HEIGHT_RATIO = 1.25
const BLACK: Rgb = [0, 0, 0]

const isSpace = (c: number) => /^[\s\p{Z}]$/u.test(String.fromCodePoint(c))
const isLetter = (c: number) => /^\p{L}$/u.test(String.fromCodePoint(c))

/** TCPDF::setDrawColor & co: one value is a grey level */
const color = (r: number, g: number, b: number): Rgb => (g < 0 || b < 0 ? [r, r, r] : [r, g, b])

export class Tcpdf {
  /** scale factor: points per user unit */
  readonly k: number
  /** page size in user units */
  w: number
  h: number
  readonly orientation: 'P' | 'L'
  x = 0
  y = 0
  lMargin: number
  rMargin: number
  tMargin: number
  bMargin = 0
  autoPageBreak = true
  pageBreakTrigger = 0
  /** the current page (1-based; 0 before the first page) — may be set to an earlier page directly */
  page = 0
  /** last cell height */
  lasth = 0
  /** font size in points / in user units, and the current style */
  fontSizePt = 12
  fontSize: number
  fontStyle: FontStyle = ''
  fontAscent = 0
  fontDescent = 0
  cellPadding: { L: number; T: number; R: number; B: number }
  lineWidth: number
  drawColor: Rgb = BLACK
  fillColor: Rgb = BLACK
  textColor: Rgb = BLACK
  inHeader = false
  inFooter = false
  protected readonly pages: PageData[] = []
  readonly #pageOpen: boolean[] = []
  #originalLMargin: number | null = null
  #originalRMargin: number | null = null
  readonly #defaults: GraphicVars
  readonly #links: Array<{ p: number; y: number }> = []
  readonly #outlines: Array<{ title: string; level: number; p: number; y: number }> = []
  readonly #aliases = new Map<string, string>()
  readonly #meta: { title: string; author: string; creator: string }

  constructor(orientation: string, unit: 'pt' | 'mm', format: string, author = '') {
    this.k = unit === 'pt' ? 1 : 72 / 25.4
    const [fw, fh] = PAGE_FORMATS[format.toUpperCase()] ?? (PAGE_FORMATS.A4 as readonly [number, number])
    this.orientation = orientation.toUpperCase().startsWith('L') ? 'L' : 'P'
    const [wPt, hPt] =
      this.orientation === 'L' ? [Math.max(fw, fh), Math.min(fw, fh)] : [Math.min(fw, fh), Math.max(fw, fh)]
    this.w = wPt / this.k
    this.h = hPt / this.k
    // page margins (1 cm), internal cell padding 1 mm
    const margin = 28.35 / this.k
    this.lMargin = margin
    this.rMargin = margin
    this.tMargin = margin
    this.cellPadding = { L: margin / 10, T: 0, R: margin / 10, B: 0 }
    this.lineWidth = 0.57 / this.k
    this.fontSize = this.fontSizePt / this.k
    this.setAutoPageBreak(true, 2 * margin)
    this.setFont('', this.fontSizePt)
    this.#defaults = this.#graphicVars()
    this.#meta = { title: '', author, creator: author }
  }

  // ---- hooks -------------------------------------------------------------------------------

  /** the page header (TCPDF::Header), run when a page is started */
  protected header(): void {}

  /** the page footer (TCPDF::Footer), run when a page is closed */
  protected footer(): void {}

  // ---- document --------------------------------------------------------------------------

  setTitle(title: string): void {
    this.#meta.title = title
  }

  setAuthor(author: string): void {
    this.#meta.author = author
  }

  getPageWidth(): number {
    return this.w
  }

  getPageHeight(): number {
    return this.h
  }

  /** PageNo(): the current page number */
  pageNo(): number {
    return this.page
  }

  getNumPages(): number {
    return this.pages.length
  }

  /** getAliasNbPages: replaced by the total number of pages in the output */
  getAliasNbPages(): string {
    return '{:ptp:}'
  }

  /** getAliasNumPage: replaced by the page number in the output */
  getAliasNumPage(): string {
    return '{:pnp:}'
  }

  /** Pdf::setAlias: `name` is replaced by `value` in every page's text */
  setAlias(name: string, value: string): void {
    this.#aliases.set(name, value)
  }

  // ---- state -------------------------------------------------------------------------------

  setMargins(left: number, top: number, right = -1): void {
    this.lMargin = left
    this.tMargin = top
    this.rMargin = right === -1 ? left : right
  }

  setTopMargin(margin: number): void {
    this.tMargin = margin
  }

  setAutoPageBreak(auto: boolean, margin = 0): void {
    this.autoPageBreak = auto
    this.bMargin = margin
    this.pageBreakTrigger = this.h - margin
  }

  setCellPadding(pad: number): void {
    this.cellPadding = { L: pad, T: pad, R: pad, B: pad }
  }

  /** setFont(family, style, size): one family (DejaVu Sans); a null size keeps the current one */
  setFont(style = '', size: number | null = null): void {
    this.fontStyle = style.toUpperCase().includes('B') ? 'B' : ''
    this.setFontSize(size ?? this.fontSizePt)
  }

  setFontSize(size: number): void {
    this.fontSizePt = size
    this.fontSize = size / this.k
    const f = fontData(this.fontStyle)
    this.fontAscent = (f.ascent * size) / 1000 / this.k
    this.fontDescent = (-f.descent * size) / 1000 / this.k
  }

  setLineWidth(width: number): void {
    this.lineWidth = width
  }

  setDrawColor(r: number, g = -1, b = -1): void {
    this.drawColor = color(r, g, b)
  }

  setFillColor(r: number, g = -1, b = -1): void {
    this.fillColor = color(r, g, b)
  }

  setTextColor(r = 0, g = -1, b = -1): void {
    this.textColor = color(r, g, b)
  }

  /** GetStringWidth: the sum of the characters' widths at the current font and size */
  getStringWidth(s: string): number {
    const f = fontData(this.fontStyle)
    let w = 0
    for (const c of s) w += f.charWidth(c.codePointAt(0) as number)
    return (w * this.fontSize) / 1000
  }

  #charWidth(cp: number): number {
    return (fontData(this.fontStyle).charWidth(cp) * this.fontSize) / 1000
  }

  getCellHeight(fontSize: number, padding = true): number {
    let height = fontSize * CELL_HEIGHT_RATIO
    if (padding) height += this.cellPadding.T + this.cellPadding.B
    return Math.round(height * 1e6) / 1e6
  }

  getX(): number {
    return this.x
  }

  getY(): number {
    return this.y
  }

  setX(x: number): void {
    this.x = x >= 0 ? x : this.w + x
  }

  setY(y: number, resetX = true): void {
    if (resetX) this.x = this.lMargin
    this.y = y >= 0 ? y : this.h + y
  }

  setXY(x: number, y: number): void {
    this.setY(y, false)
    this.setX(x)
  }

  /** Ln(h): to the left margin, h (the last cell height by default) further down */
  ln(h: number | null = null): void {
    this.x = this.lMargin
    this.y += h ?? this.lasth
  }

  #graphicVars(): GraphicVars {
    return {
      style: this.fontStyle,
      sizePt: this.fontSizePt,
      lMargin: this.lMargin,
      rMargin: this.rMargin,
      padding: { ...this.cellPadding },
      lineWidth: this.lineWidth,
      drawColor: this.drawColor,
      fillColor: this.fillColor,
      textColor: this.textColor,
    }
  }

  #setGraphicVars(g: GraphicVars): void {
    this.lMargin = g.lMargin
    this.rMargin = g.rMargin
    this.cellPadding = { ...g.padding }
    this.lineWidth = g.lineWidth
    this.drawColor = g.drawColor
    this.fillColor = g.fillColor
    this.textColor = g.textColor
    this.setFont(g.style, g.sizePt)
  }

  // ---- pages -------------------------------------------------------------------------------

  #current(): PageData {
    const p = this.pages[this.page - 1]
    if (p === undefined) throw new Error('no page: call addPage() first')
    return p
  }

  /** setPage(n): makes an existing page current, with the margins it was started with */
  setPage(n: number): void {
    if (n === this.page || this.pages[n - 1] === undefined) return
    this.page = n
    this.#applyPageDim(n)
  }

  #applyPageDim(n: number): void {
    const p = this.pages[n - 1]
    if (p === undefined) return
    this.tMargin = p.tm
    this.setAutoPageBreak(p.pb, p.bm)
  }

  lastPage(): void {
    this.setPage(this.pages.length)
  }

  /** AddPage: ends the current page (footer) and starts the next one (header) */
  addPage(): void {
    this.#originalLMargin ??= this.lMargin
    this.#originalRMargin ??= this.rMargin
    this.#endPage()
    this.#startPage()
  }

  #endPage(): void {
    if (this.page === 0 || this.pages.length > this.page || this.#pageOpen[this.page] !== true) return
    this.#runFooter()
    this.#pageOpen[this.page] = false
  }

  #startPage(): void {
    if (this.pages.length > this.page) {
      // this page has been already added
      this.setPage(this.page + 1)
      this.setY(this.tMargin)
      return
    }
    this.pages.push({
      ops: [],
      links: [],
      tm: this.tMargin,
      bm: this.bMargin,
      olm: this.#originalLMargin ?? this.lMargin,
      orm: this.#originalRMargin ?? this.rMargin,
      pb: this.autoPageBreak,
    })
    this.page = this.pages.length
    this.#pageOpen[this.page] = true
    this.x = this.lMargin
    this.y = this.tMargin
    const gvars = this.#graphicVars()
    this.#runHeader()
    this.#setGraphicVars(gvars)
  }

  #runHeader(): void {
    this.inHeader = true
    this.#setGraphicVars(this.#defaults)
    const lasth = this.lasth
    const olm = this.#originalLMargin ?? this.lMargin
    this.rMargin = this.#originalRMargin ?? this.rMargin
    this.lMargin = olm
    this.setCellPadding(0)
    this.setXY(olm, 0)
    this.header()
    this.setXY(olm, this.tMargin)
    this.lasth = lasth
    this.inHeader = false
  }

  #runFooter(): void {
    this.inFooter = true
    const gvars = this.#graphicVars()
    const lasth = this.lasth
    this.#setGraphicVars(this.#defaults)
    const olm = this.#originalLMargin ?? this.lMargin
    this.rMargin = this.#originalRMargin ?? this.rMargin
    this.lMargin = olm
    this.setCellPadding(0)
    this.setXY(olm, this.h)
    this.footer()
    this.setXY(olm, this.tMargin)
    this.lasth = lasth
    this.#setGraphicVars(gvars)
    this.inFooter = false
  }

  /** AcceptPageBreak */
  acceptPageBreak(): boolean {
    return this.autoPageBreak
  }

  /** checkPageBreak: a new page when h does not fit below y (body only); true when one was added */
  protected checkPageBreak(h = 0, y: number | null = null, addPage = true): boolean {
    const yy = y ?? this.y
    const current = this.page
    if (yy + h > this.pageBreakTrigger && !this.inHeader && !this.inFooter && this.acceptPageBreak()) {
      if (addPage) {
        const x = this.x
        this.addPage()
        this.y = this.tMargin
        const old = this.pages[this.page - 2]
        const now = this.pages[this.page - 1]
        this.x = old !== undefined && now !== undefined && now.olm !== old.olm ? x + now.olm - old.olm : x
      }
      return true
    }
    return current !== this.page
  }

  // ---- drawing -----------------------------------------------------------------------------

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.#current().ops.push({ t: 'line', x1, y1, x2, y2, lw: this.lineWidth, color: this.drawColor })
  }

  /** Rect(x, y, w, h): the outline */
  rect(x: number, y: number, w: number, h: number): void {
    this.#current().ops.push({
      t: 'rect',
      x,
      y,
      w,
      h,
      lw: this.lineWidth,
      stroke: this.drawColor,
      fill: null,
    })
  }

  /** AddLink: a new internal link id (its target is set by setLink) */
  addLink(): number {
    this.#links.push({ p: 0, y: 0 })
    return this.#links.length
  }

  /** setLink(link, y, page): y -1 is the current position, page -1 the current page */
  setLink(link: Link, y = 0, page = -1): void {
    if (link === '') return
    this.#links[link - 1] = { p: page < 0 ? this.page : page, y: y === -1 ? this.y : y }
  }

  /** Link(x, y, w, h, link): a clickable area going to an internal link */
  link(x: number, y: number, w: number, h: number, link: Link): void {
    if (link === '') return
    this.#current().links.push({ x, y, w, h, link })
  }

  /** Bookmark(txt, level, y): an outline entry for the current page; y -1 is the current position */
  bookmark(txt: string, level = 0, y = -1): void {
    this.#outlines.push({ title: txt, level, p: this.page, y: y === -1 ? this.y : y })
  }

  /** Cell(w, h, txt, border, ln, align, fill, link) */
  cell(
    w: number,
    h = 0,
    txt = '',
    border: Border = 0,
    ln = 0,
    align: Align = '',
    fill = false,
    link: Link = '',
  ): void {
    const minHeight = this.getCellHeight(this.fontSize)
    const hh = h < minHeight ? minHeight : h
    this.checkPageBreak(hh)
    this.#cellCode(w, hh, txt, border, ln, align, fill, link)
  }

  /** getCellCode (calign T, valign M, no stretching) */
  #cellCode(
    w0: number,
    h: number,
    txt0: string,
    border: Border,
    ln: number,
    align: Align,
    fill: boolean,
    link: Link,
  ): void {
    const ops = this.#current().ops
    // no-break space as space, soft hyphens removed; a lone surrogate (an invalid UTF-8 byte) is U+FFFD
    const txt = txt0
      .replaceAll('\u00a0', ' ')
      .replaceAll('\u00ad', '')
      .replace(/[\r\n]/g, ' ')
      .replace(/\p{Cs}/gu, '\ufffd')
    const x = this.x
    const y = this.y
    const yt = y + (h - this.fontAscent - this.fontDescent) / 2
    const baseline = yt + this.fontAscent
    const w = w0 <= 0 ? this.w - this.rMargin - x : w0
    const frame = border === 1 || (typeof border === 'string' && border.length === 4)
    if (fill || frame) {
      ops.push({
        t: 'rect',
        x,
        y,
        w,
        h,
        lw: this.lineWidth,
        stroke: frame ? this.drawColor : null,
        fill: fill ? this.fillColor : null,
      })
    }
    if (typeof border === 'string' && !frame) {
      const side = (x1: number, y1: number, x2: number, y2: number) =>
        ops.push({ t: 'line', x1, y1, x2, y2, lw: this.lineWidth, color: this.drawColor })
      if (border.includes('L')) side(x, y, x, y + h)
      if (border.includes('T')) side(x, y, x + w, y)
      if (border.includes('R')) side(x + w, y, x + w, y + h)
      if (border.includes('B')) side(x, y + h, x + w, y + h)
    }
    if (txt !== '') {
      const width = this.getStringWidth(txt)
      const dx =
        align === 'C' ? (w - width) / 2 : align === 'R' ? w - width - this.cellPadding.R : this.cellPadding.L
      ops.push({
        t: 'text',
        x: x + dx,
        y: baseline,
        text: txt,
        style: this.fontStyle,
        size: this.fontSizePt,
        color: this.textColor,
      })
      if (link !== '') this.link(x + dx, yt, width, this.fontAscent + this.fontDescent, link)
    }
    this.lasth = h
    if (ln > 0) {
      this.y = y + h
      if (ln === 1) this.x = this.lMargin
    } else this.x = x + w
  }

  /**
   * MultiCell(w, h, txt, border 0, align, fill false, ln): the text wrapped into lines of the cell
   * height ratio, h the minimum height. Lines that do not fit continue on the next page.
   */
  multiCell(w0: number, h: number, txt: string, align: Align = 'J', ln = 1): void {
    const padding = this.cellPadding
    this.cellPadding = { ...padding, T: 0, B: 0 }
    this.lasth = this.getCellHeight(this.fontSize)
    const y = this.y
    const startPage = this.page
    const x = this.x
    const w = w0 <= 0 ? this.w - x - this.rMargin : w0
    const lMargin = this.lMargin
    const rMargin = this.rMargin
    this.lMargin = x
    this.rMargin = this.w - x - w
    this.#write(this.lasth, txt, align)
    let currentY = this.y
    if (this.page === startPage) currentY = y + Math.max(h, currentY - y)
    else this.#applyPageDim(this.page)
    this.lMargin = lMargin
    this.rMargin = rMargin
    if (ln > 0) {
      this.setY(currentY)
      if (ln === 2) this.setX(x + w)
    } else {
      this.setPage(startPage)
      this.y = y
      this.setX(x + w)
    }
    this.cellPadding = padding
  }

  /** Write(h, txt, '', false, align, ln = true) within the margins MultiCell set */
  #write(h: number, txt0: string, align0: Align): void {
    const s = (txt0 === '' ? ' ' : txt0).replaceAll('\r', '')
    const chars = [...s].map((c) => c.codePointAt(0) as number)
    const nb = chars.length
    const sub = (a: number, b: number) => String.fromCodePoint(...chars.slice(a, b))
    const pad = this.cellPadding.L + this.cellPadding.R
    const remaining = () => this.w - this.rMargin - this.x
    const pw = this.w - this.lMargin - this.rMargin
    let w = remaining()
    let wmax = w - pad
    let widest = 0
    for (const c of chars) widest = Math.max(widest, this.#charWidth(c))
    if (this.#charWidth(46) > wmax || widest > wmax) return
    let i = 0
    let j = 0
    let sep = -1
    let shy = false
    let l = 0
    let pc = 0
    while (i < nb) {
      const c = chars[i] as number
      if (c === 10) {
        this.cell(w, h, sub(j, i), 0, 1, align0 === 'J' ? 'L' : align0)
        j = i + 1
        l = 0
        sep = -1
        shy = false
        w = remaining()
        wmax = w - pad
      } else {
        const next = chars[i + 1]
        if (c !== 160 && (isSpace(c) || (c === 45 && next !== undefined && isLetter(pc) && isLetter(next)))) {
          sep = i
          shy = c === 45
        }
        l += this.#charWidth(c)
        if (l > wmax) {
          const endspace = sep !== -1 && isSpace(chars[sep] as number) ? 1 : 0
          const nextWord =
            sep === -1
              ? ''
              : (sub(sep + endspace, nb)
                  .trim()
                  .split(/\s/u)[0] ?? '')
          if (sep === -1 || this.getStringWidth(nextWord) > pw) {
            // no separator (or the next word is longer than a line): split here
            this.cell(w, h, sub(j, i), 0, 1, align0)
            j = i
            i--
          } else {
            this.cell(w, h, sub(j, sep + (shy ? 0 : endspace)) + (shy ? '-' : ''), 0, 1, align0)
            i = sep
            sep = -1
            shy = false
            j = i + 1
          }
          w = remaining()
          wmax = w - pad
          l = 0
        }
      }
      pc = c
      i++
    }
    if (l > 0) {
      const lastW = align0 === 'C' || align0 === 'J' || align0 === 'R' ? w : l
      this.cell(lastW, h, sub(j, nb), 0, 1, align0)
    }
  }

  // ---- output ------------------------------------------------------------------------------

  /** Close + getPDFData: the document (an empty document gets one page) */
  async output(now: Date = new Date()): Promise<Uint8Array> {
    if (this.page === 0) this.addPage()
    this.lastPage()
    this.#endPage()
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.registerFontkit(fontkit)
    const fonts = new Map<FontStyle, PDFFont>()
    const font = async (style: FontStyle): Promise<PDFFont> => {
      let f = fonts.get(style)
      if (f === undefined) {
        // no shaping: TCPDF prints one glyph per character (widths match getStringWidth)
        f = await doc.embedFont(fontData(style).bytes, {
          subset: true,
          features: { liga: false, kern: false, clig: false, calt: false },
        })
        fonts.set(style, f)
      }
      return f
    }
    const total = String(this.pages.length)
    const k = this.k
    const pdfPages: PDFPage[] = []
    for (const [n, p] of this.pages.entries()) {
      const page = doc.addPage([this.w * k, this.h * k])
      pdfPages.push(page)
      const H = this.h * k
      const c = (v: Rgb) => rgb(v[0] / 255, v[1] / 255, v[2] / 255)
      for (const op of p.ops) {
        if (op.t === 'line') {
          page.drawLine({
            start: { x: op.x1 * k, y: H - op.y1 * k },
            end: { x: op.x2 * k, y: H - op.y2 * k },
            thickness: op.lw * k,
            color: c(op.color),
          })
        } else if (op.t === 'rect') {
          page.drawRectangle({
            x: op.x * k,
            y: H - (op.y + op.h) * k,
            width: op.w * k,
            height: op.h * k,
            ...(op.fill !== null ? { color: c(op.fill) } : {}),
            ...(op.stroke !== null
              ? { borderColor: c(op.stroke), borderWidth: op.lw * k }
              : { borderWidth: 0 }),
          })
        } else {
          let text = op.text.replaceAll('{:ptp:}', total).replaceAll('{:pnp:}', String(n + 1))
          for (const [name, value] of this.#aliases) text = text.replaceAll(name, value)
          page.drawText(text, {
            x: op.x * k,
            y: H - op.y * k,
            size: op.size,
            font: await font(op.style),
            color: c(op.color),
          })
        }
      }
    }
    const dest = (link: { p: number; y: number }) => {
      const target = pdfPages[link.p - 1]
      if (target === undefined) return null
      return doc.context.obj([
        target.ref,
        PDFName.of('XYZ'),
        PDFNumber.of(0),
        PDFNumber.of((this.h - link.y) * k),
        PDFNull,
      ])
    }
    for (const [n, p] of this.pages.entries()) {
      const page = pdfPages[n] as PDFPage
      const H = this.h * k
      for (const l of p.links) {
        const target = this.#links[l.link - 1]
        const d = target === undefined ? null : dest(target)
        if (d === null) continue
        const annot = doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [l.x * k, H - (l.y + l.h) * k, (l.x + l.w) * k, H - l.y * k],
          Border: [0, 0, 0],
          Dest: d,
        })
        page.node.addAnnot(doc.context.register(annot))
      }
    }
    this.#writeOutlines(doc, dest)
    doc.setTitle(this.#meta.title)
    doc.setAuthor(this.#meta.author)
    doc.setCreator(this.#meta.creator)
    doc.setProducer(this.#meta.creator)
    doc.setCreationDate(now)
    doc.setModificationDate(now)
    return doc.save({ useObjectStreams: false })
  }

  /** the bookmarks as the document outline (nested by level), opened with the outline panel */
  #writeOutlines(doc: PDFDocument, dest: (l: { p: number; y: number }) => PDFArray | null): void {
    if (this.#outlines.length === 0) return
    const ctx = doc.context
    const root = ctx.nextRef()
    interface Node {
      ref: PDFRef
      title: string
      dest: PDFArray | null
      children: Node[]
    }
    const top: Node[] = []
    const stack: Array<{ level: number; node: Node }> = []
    for (const o of this.#outlines) {
      const node: Node = { ref: ctx.nextRef(), title: o.title, dest: dest(o), children: [] }
      while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= o.level) stack.pop()
      const parent = stack[stack.length - 1]
      if (parent === undefined) top.push(node)
      else parent.node.children.push(node)
      stack.push({ level: o.level, node })
    }
    const count = (nodes: Node[]): number => nodes.reduce((n, x) => n + 1 + count(x.children), 0)
    const write = (nodes: Node[], parent: PDFRef) => {
      nodes.forEach((node, i) => {
        const dict = ctx.obj({})
        const set = (key: string, v: PDFObject) => dict.set(PDFName.of(key), v)
        set('Title', PDFHexString.fromText(node.title))
        set('Parent', parent)
        const prev = nodes[i - 1]
        const next = nodes[i + 1]
        if (prev !== undefined) set('Prev', prev.ref)
        if (next !== undefined) set('Next', next.ref)
        const first = node.children[0]
        const last = node.children[node.children.length - 1]
        if (first !== undefined && last !== undefined) {
          set('First', first.ref)
          set('Last', last.ref)
          set('Count', PDFNumber.of(count(node.children)))
        }
        if (node.dest !== null) set('Dest', node.dest)
        ctx.assign(node.ref, dict)
        write(node.children, node.ref)
      })
    }
    write(top, root)
    const first = top[0] as Node
    const last = top[top.length - 1] as Node
    ctx.assign(
      root,
      ctx.obj({ Type: 'Outlines', First: first.ref, Last: last.ref, Count: PDFNumber.of(count(top)) }),
    )
    doc.catalog.set(PDFName.of('Outlines'), root)
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  }
}
