/**
 * The subset of PHP's XMLWriter (libxml2 xmlTextWriter, indenting with three spaces) that the
 * schema plugins use, byte for byte: an element opens on a new line indented by its depth, text
 * and raw output stay on the line, and every end tag is followed by a newline.
 * pma: src/Plugins/Schema/Svg/Svg.php, src/Plugins/Schema/Dia/Dia.php (XMLWriter, setIndent(true))
 * libxml2: xmlwriter.c xmlTextWriterStartElement / EndElement / WriteRawLen / WriteIndent
 */
export class XmlWriter {
  #out = ''
  readonly #stack: Array<{ name: string; open: boolean }> = []
  #doIndent = true
  readonly #indent: string

  constructor(indent = '   ') {
    this.#indent = indent
  }

  /** startDocument('1.0', 'UTF-8') */
  startDocument(): void {
    this.#out += '<?xml version="1.0" encoding="UTF-8"?>\n'
  }

  /** startDtd(name, pubid, sysid) + endDtd() with indentation on */
  dtd(name: string, publicId: string, systemId: string): void {
    this.#out += `<!DOCTYPE ${name}\nPUBLIC "${publicId}"\n       "${systemId}">\n`
  }

  /** closes a pending start tag (">", plus a newline when an element follows) */
  #closeStart(newline: boolean): void {
    const top = this.#stack.at(-1)
    if (top?.open !== true) return
    this.#out += newline ? '>\n' : '>'
    top.open = false
  }

  startElement(name: string): void {
    this.#closeStart(true)
    this.#stack.push({ name, open: true })
    this.#out += this.#indent.repeat(this.#stack.length - 1)
    this.#out += `<${name}`
  }

  writeAttribute(name: string, value: string): void {
    this.#out += ` ${name}="${escapeAttribute(value)}"`
  }

  text(value: string): void {
    this.#closeStart(false)
    this.#out += escapeText(value)
    this.#doIndent = false
  }

  writeRaw(value: string): void {
    this.#closeStart(false)
    this.#out += value
    this.#doIndent = false
  }

  endElement(): void {
    const top = this.#stack.at(-1)
    if (top === undefined) return
    if (top.open) {
      this.#out += '/>'
    } else {
      if (this.#doIndent) this.#out += this.#indent.repeat(this.#stack.length - 1)
      this.#out += `</${top.name}>`
    }
    this.#doIndent = true
    this.#out += '\n'
    this.#stack.pop()
  }

  /** endDocument(): closes what is still open */
  endDocument(): void {
    while (this.#stack.length > 0) this.endElement()
  }

  flush(): string {
    const s = this.#out
    this.#out = ''
    return s
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>\r]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;' })[c] ?? c)
}

function escapeAttribute(s: string): string {
  return s.replace(
    /[&<>"\n\r\t]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': '&#10;', '\r': '&#13;', '\t': '&#9;' })[
        c
      ] ?? c,
  )
}
