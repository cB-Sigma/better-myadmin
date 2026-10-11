/// <reference path="./seek-bzip.d.ts" />
import { gunzipSync } from 'node:zlib'
import { readZip } from '@bettermyadmin/export'
import Bunzip from 'seek-bzip'

export type Compression = 'none' | 'application/gzip' | 'application/bzip2' | 'application/zip'

/** Util::getCompressionMimeType: the first four bytes decide. */
export function compressionOf(head: Buffer): Compression {
  if (head.length >= 2 && head[0] === 31 && head[1] === 139) return 'application/gzip'
  if (head.length >= 3 && head.subarray(0, 3).toString('latin1') === 'BZh') return 'application/bzip2'
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return 'application/zip'
  return 'none'
}

/** Which decompressions are enabled (`$cfg['GZipDump']` …); BetterMyAdmin has all three built in. */
export interface CompressionSupport {
  gzip: boolean
  bzip2: boolean
  zip: boolean
}

/** A failure while opening the file: the message is a phpMyAdmin msgid, already formatted. */
export class ImportFileError extends Error {}

/**
 * The file to import, decompressed (gzip, bzip2, or the first entry / content.xml of a zip) and
 * read in chunks.
 * pma: src/File.php::open, ::openZip, ::read, ::eof; src/ZipExtension.php::getContents
 */
export class ImportFile {
  readonly compression: Compression
  #content: Buffer
  #offset = 0
  readonly #raw: Buffer
  readonly #tr: (s: string) => string

  constructor(raw: Buffer, support: CompressionSupport, tr: (s: string) => string = (s) => s) {
    this.#raw = raw
    this.#tr = tr
    this.compression = compressionOf(raw.subarray(0, 4))
    const unsupported = () =>
      new ImportFileError(
        tr(
          'You attempted to load file with unsupported compression (%s). Either support for it is not implemented or disabled by your configuration.',
        ).replace('%s', this.compression),
      )
    switch (this.compression) {
      case 'application/gzip':
        if (!support.gzip) throw unsupported()
        this.#content = gunzipSync(raw)
        break
      case 'application/bzip2':
        if (!support.bzip2) throw unsupported()
        this.#content = Bunzip.decode(raw)
        break
      case 'application/zip':
        if (!support.zip) throw unsupported()
        this.#content = this.#zipEntry(null)
        break
      default:
        this.#content = raw
    }
  }

  /** ZipExtension::getContents */
  #zipEntry(specificEntry: RegExp | null): Buffer {
    let entries: Array<{ name: string; data: Buffer }>
    try {
      entries = readZip(this.#raw)
    } catch {
      throw new ImportFileError(`${this.#tr('Error in ZIP archive:')} Not a zip archive`)
    }
    if (entries.length === 0) throw new ImportFileError(this.#tr('No files found inside ZIP archive!'))
    const first = entries[0] as { name: string; data: Buffer }
    let entry = specificEntry
    /* Is the the zip really an ODS file? */
    if (first.data.toString('latin1') === 'application/vnd.oasis.opendocument.spreadsheet') {
      entry = /^content\.xml$/
    }
    if (entry === null) return first.data
    const hit = entries.find((e) => entry.test(e.name))
    if (hit === undefined || hit.data.length === 0) {
      throw new ImportFileError(`${this.#tr('Error in ZIP archive:')} Could not find "${String(entry)}"`)
    }
    return hit.data
  }

  /** File::openZip with an entry pattern (the .shp of a shape archive). */
  openZip(specificEntry: RegExp): void {
    this.#content = this.#zipEntry(specificEntry)
    this.#offset = 0
  }

  /** The number of entries of a zip archive (ZipExtension::getNumberOfFiles). */
  zipEntries(): Array<{ name: string; data: Buffer }> {
    return this.compression === 'application/zip' ? readZip(this.#raw) : []
  }

  /** File::read (zip content is cut at a UTF-8 character boundary: mb_strcut) */
  read(size: number): Buffer {
    let end = Math.min(this.#content.length, this.#offset + size)
    if (this.compression === 'application/zip') {
      // mb_strcut: do not split a multi-byte character
      while (
        end < this.#content.length &&
        end > this.#offset &&
        ((this.#content[end] as number) & 0xc0) === 0x80
      )
        end--
    }
    const r = this.#content.subarray(this.#offset, end)
    this.#offset = end
    return r
  }

  eof(): boolean {
    return this.#offset >= this.#content.length
  }

  /** Converts the whole content from `charset` (Encoding::convertString, applied per chunk in pma). */
  convert(fn: (b: Buffer) => Buffer): void {
    this.#content = fn(this.#content)
  }
}
