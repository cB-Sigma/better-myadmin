import { gzipSync } from 'node:zlib'
import { encodeBytes } from './bytes.ts'
import { convertFromUtf8 } from './charset.ts'
import { kanjiStrConv } from './kanji.ts'
import { createZip } from './zip.ts'

/** Where the dump goes: the HTTP response, a file in SaveDir, or memory. */
export interface OutputSink {
  write(chunk: Buffer): Promise<void> | void
}

/** Raised when the save-to-server file could not be written completely. */
export class InsufficientSpaceError extends Error {}

export interface OutputOptions {
  /** OutputHandler::$asFile: false for "View output as text" */
  asFile: boolean
  compression: '' | 'zip' | 'gzip'
  /** $cfg['CompressOnFly'] (gzip only) */
  compressOnFly?: boolean
  /** flush threshold of the on-the-fly gzip (Export::getMemoryLimit) */
  memoryLimit?: number
  /** Current::$charset when the output must be converted from UTF-8 (outputCharsetConversion) */
  convertCharset?: string | null
  /**
   * outputKanjiConversion (Encoding::canConvertKanji(), the Japanese locale): the posted knjenc
   * (`''`, `EUC-JP`, `SJIS`) and xkana (`kana` or `''`)
   */
  kanji?: { enc: string; kana: string } | null
}

/**
 * Every line of every plugin goes through addLine(): straight to the sink for an uncompressed
 * file or the text view, buffered for zip / gzip (gzip flushed in chunks when CompressOnFly),
 * per object for "export as separate files".
 * pma: src/Export/OutputHandler.php
 */
export class OutputHandler {
  readonly asFile: boolean
  readonly compression: '' | 'zip' | 'gzip'
  readonly onFlyCompression: boolean
  readonly memoryLimit: number
  readonly convertCharset: string | null
  readonly kanji: { enc: string; kana: string } | null
  readonly #sink: OutputSink
  #dumpBuffer: string[] = []
  #dumpBufferLength = 0
  readonly #objects = new Map<string, string>()
  /** bytes handed to the sink */
  written = 0

  constructor(sink: OutputSink, o: OutputOptions) {
    this.#sink = sink
    this.asFile = o.asFile
    this.compression = o.compression
    this.onFlyCompression = o.compression === 'gzip' && (o.compressOnFly ?? false)
    this.memoryLimit = o.memoryLimit ?? 1024 * 1024
    this.convertCharset = o.convertCharset ?? null
    this.kanji = o.kanji ?? null
  }

  #convert(s: string): Buffer {
    const bytes = encodeBytes(s)
    return this.convertCharset === null ? bytes : convertFromUtf8(bytes, this.convertCharset)
  }

  async #emit(b: Buffer): Promise<void> {
    if (b.length === 0) return
    this.written += b.length
    await this.#sink.write(b)
  }

  /** pma: OutputHandler::addLine */
  async addLine(text: string): Promise<void> {
    // Kanji encoding convert feature
    const line = this.kanji === null ? text : kanjiStrConv(text, this.kanji.enc, this.kanji.kana)
    if (line === '') return
    // If we have to buffer data, we will perform everything at once at the end
    if (this.compression !== '') {
      this.#dumpBuffer.push(line)
      if (this.onFlyCompression) {
        this.#dumpBufferLength += line.length
        if (this.#dumpBufferLength > this.memoryLimit) {
          const converted = this.#convert(this.#dumpBuffer.join(''))
          await this.#emit(gzipSync(converted))
          this.#dumpBuffer = []
          this.#dumpBufferLength = 0
        }
      }
      return
    }
    // text view: the client shows the raw text (phpMyAdmin escapes it into a textarea)
    await this.#emit(this.asFile ? this.#convert(line) : encodeBytes(line))
  }

  /** pma: OutputHandler::saveObjectInBuffer (separate files) */
  saveObjectInBuffer(objectName: string, append = false): void {
    const buf = this.#dumpBuffer.join('')
    if (buf !== '') {
      const prev = this.#objects.get(objectName)
      if (append && prev !== undefined) this.#objects.set(objectName, prev + buf)
      else this.#objects.set(objectName, buf)
    }
    this.#dumpBuffer = []
    this.#dumpBufferLength = 0
  }

  clearBuffer(): void {
    this.#dumpBuffer = []
    this.#dumpBufferLength = 0
  }

  /**
   * End of the dump: charset conversion (convertBufferCharset) and compression (compress), then the
   * remaining bytes go to the sink. `filename` is the final name (with `.zip`).
   * pma: OutputHandler::convertBufferCharset, ::compress, ExportController (getBuffer)
   */
  async finish(separateFiles: boolean, filename: string, now = new Date()): Promise<void> {
    if (this.compression === 'zip') {
      const name = filename.endsWith('.zip') ? filename.slice(0, -4) : filename
      if (separateFiles) {
        const data = new Map<string, Buffer>()
        for (const [k, v] of this.#objects) data.set(k, this.#convert(v))
        await this.#emit(createZip(data, name, now))
      } else {
        await this.#emit(createZip(this.#convert(this.#dumpBuffer.join('')), name, now))
      }
    } else if (this.compression === 'gzip') {
      const rest = this.#dumpBuffer.join('')
      // on the fly: only what is left; a gzip of an empty buffer is still written once at the end
      if (rest !== '' || this.written === 0) await this.#emit(gzipSync(this.#convert(rest)))
    }
    this.#dumpBuffer = []
    this.#dumpBufferLength = 0
  }
}
