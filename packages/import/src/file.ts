/// <reference path="./seek-bzip.d.ts" />
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statfsSync,
  writeSync,
} from 'node:fs'
import { createReadStream, createWriteStream, fstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, gunzipSync } from 'node:zlib'
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

const unsupportedError = (t: (s: string) => string, compression: Compression) =>
  new ImportFileError(
    t(
      'You attempted to load file with unsupported compression (%s). Either support for it is not implemented or disabled by your configuration.',
    ).replace('%s', compression),
  )

/**
 * Bounds of the decompression (a decompression bomb): phpMyAdmin inflates on the fly under PHP's
 * memory_limit and max_execution_time; ours inflates a gzip or bzip2 file to a temporary file and a
 * zip entry into memory, so both are bounded here.
 */
export interface DecompressionLimits {
  /** decompressed bytes at most (default: a gzip/bzip2 copy leaves 1 GiB (10 % of a smaller disk) free; a zip entry 1 GiB) */
  maxBytes?: number
  /** Date.now() past which the decompression stops (ExecTimeLimit) */
  deadline?: number
}

const GIB = 1024 * 1024 * 1024
/** ZipExtension::getContents holds the entry in memory */
const ZIP_ENTRY_LIMIT = GIB

class DecompressionLimitError extends Error {}

/** The bytes a temporary copy in `dir` may take: the free space less 1 GiB (10 % of a smaller disk). */
function diskBudget(dir: string): number {
  try {
    const s = statfsSync(dir)
    return Math.max(0, s.bavail * s.bsize - Math.min(GIB, (s.blocks * s.bsize) / 10))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** A file read with positioned reads: only the chunk asked for is in memory. */
class FileSource {
  readonly #fd: number
  readonly size: number
  #pos = 0
  /** a temporary file (a decompressed upload) removed on close */
  readonly #tempDir: string | null

  constructor(path: string, tempDir: string | null = null) {
    this.#fd = openSync(path, 'r')
    this.size = fstatSync(this.#fd).size
    this.#tempDir = tempDir
  }

  read(size: number): Buffer {
    const n = Math.max(0, Math.min(size, this.size - this.#pos))
    const buf = Buffer.allocUnsafe(n)
    let got = 0
    while (got < n) {
      const r = readSync(this.#fd, buf, got, n - got, this.#pos + got)
      if (r === 0) break
      got += r
    }
    this.#pos += got
    return got === n ? buf : buf.subarray(0, got)
  }

  eof(): boolean {
    return this.#pos >= this.size
  }

  close(): void {
    closeSync(this.#fd)
    if (this.#tempDir !== null) rmSync(this.#tempDir, { recursive: true, force: true })
  }
}

/** seek-bzip's byte streams over file descriptors, buffered */
function bunzipToFile(src: string, dest: string, maxBytes: number, deadline: number): void {
  const inFd = openSync(src, 'r')
  const outFd = openSync(dest, 'w', 0o600)
  try {
    const inBuf = Buffer.allocUnsafe(64 * 1024)
    let inLen = 0
    let inPos = 0
    let fileEof = false
    const fill = () => {
      inLen = readSync(inFd, inBuf, 0, inBuf.length, null)
      inPos = 0
      if (inLen === 0) fileEof = true
    }
    const outBuf = Buffer.allocUnsafe(64 * 1024)
    let outLen = 0
    let written = 0
    const flush = () => {
      written += outLen
      if (written > maxBytes || Date.now() > deadline) throw new DecompressionLimitError()
      if (outLen > 0) writeSync(outFd, outBuf, 0, outLen)
      outLen = 0
    }
    const input = {
      readByte: () => {
        if (inPos >= inLen) fill()
        return fileEof ? -1 : (inBuf[inPos++] as number)
      },
      read(buffer: Buffer, offset: number, length: number) {
        let n = 0
        while (n < length) {
          const c = this.readByte()
          if (c < 0) return n === 0 ? -1 : n
          buffer[offset + n++] = c
        }
        return n
      },
      seek: () => {
        throw new Error('seek is not supported')
      },
      eof: () => {
        if (inPos >= inLen && !fileEof) fill()
        return fileEof
      },
    }
    const output = {
      writeByte: (b: number) => {
        outBuf[outLen++] = b
        if (outLen === outBuf.length) flush()
      },
      write(buffer: Buffer, offset: number, length: number) {
        for (let i = 0; i < length; i++) this.writeByte(buffer[offset + i] as number)
        return length
      },
      flush,
    }
    ;(Bunzip.decode as unknown as (i: unknown, o: unknown, multistream: boolean) => void)(input, output, true)
    flush()
  } finally {
    closeSync(inFd)
    closeSync(outFd)
  }
}

/**
 * The file to import, decompressed (gzip, bzip2, or the first entry / content.xml of a zip) and
 * read in chunks.
 * pma: src/File.php::open, ::openZip, ::read, ::eof; src/ZipExtension.php::getContents
 *
 * {@link ImportFile.open} reads a file on disk the way phpMyAdmin does (fopen / gzopen / bzopen
 * and fread): an uncompressed file chunk by chunk from disk, a gzip or bzip2 one decompressed to a
 * temporary file first (Node has no synchronous streaming gunzip; the import's reads are
 * synchronous) and read from there, so neither is held in memory; a zip is read whole, as
 * ZipExtension::getContents does. Call {@link close} when done.
 */
export class ImportFile {
  readonly compression: Compression
  #content: Buffer = Buffer.alloc(0)
  #offset = 0
  readonly #raw: Buffer
  #source: FileSource | null = null
  /** Encoding conversion of a file read from disk, applied to each chunk (as phpMyAdmin does) */
  #convertChunk: ((b: Buffer) => Buffer) | null = null
  /** the translator (`__`) */
  readonly #t: (s: string) => string

  /**
   * Opens `path`. Rejects with {@link ImportFileError} for a disabled compression; a damaged gzip
   * or bzip2 file rejects with the decompressor's error.
   */
  static async open(
    path: string,
    support: CompressionSupport,
    t: (s: string) => string = (s) => s,
    limits: DecompressionLimits = {},
  ): Promise<ImportFile> {
    const fd = openSync(path, 'r')
    const head = Buffer.alloc(4)
    try {
      readSync(fd, head, 0, 4, 0)
    } finally {
      closeSync(fd)
    }
    const compression = compressionOf(head)
    const tooLarge = () => new ImportFileError(t('File could not be read!'))
    if (compression === 'application/zip') {
      const f = new ImportFile(
        readFileSync(path),
        support,
        t,
        Math.min(limits.maxBytes ?? ZIP_ENTRY_LIMIT, ZIP_ENTRY_LIMIT),
      )
      return f
    }
    if (compression === 'none') return new ImportFile(new FileSource(path), compression, t)
    if (compression === 'application/gzip' && !support.gzip) throw unsupportedError(t, compression)
    if (compression === 'application/bzip2' && !support.bzip2) throw unsupportedError(t, compression)
    const dir = mkdtempSync(join(tmpdir(), 'bma-import-'))
    const out = join(dir, 'content')
    const maxBytes = Math.min(limits.maxBytes ?? Number.POSITIVE_INFINITY, diskBudget(dir))
    const deadline = limits.deadline ?? Number.POSITIVE_INFINITY
    try {
      if (compression === 'application/gzip') {
        let written = 0
        const guard = new Transform({
          transform(chunk: Buffer, _enc, done) {
            written += chunk.length
            if (written > maxBytes || Date.now() > deadline) done(new DecompressionLimitError())
            else done(null, chunk)
          },
        })
        await pipeline(createReadStream(path), createGunzip(), guard, createWriteStream(out, { mode: 0o600 }))
      } else bunzipToFile(path, out, maxBytes, deadline)
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e instanceof DecompressionLimitError ? tooLarge() : e
    }
    return new ImportFile(new FileSource(out, dir), compression, t)
  }

  /** the largest zip entry inflated into memory */
  readonly #maxEntryBytes: number

  constructor(raw: Buffer, support: CompressionSupport, t?: (s: string) => string, maxEntryBytes?: number)
  constructor(source: FileSource, compression: Compression, t?: (s: string) => string)
  constructor(
    raw: Buffer | FileSource,
    support: CompressionSupport | Compression,
    t: (s: string) => string = (s) => s,
    maxEntryBytes: number = ZIP_ENTRY_LIMIT,
  ) {
    this.#t = t
    this.#maxEntryBytes = maxEntryBytes
    if (raw instanceof FileSource) {
      this.#raw = Buffer.alloc(0)
      this.#source = raw
      this.compression = support as Compression
      return
    }
    this.#raw = raw
    this.compression = compressionOf(raw.subarray(0, 4))
    const unsupported = () => unsupportedError(t, this.compression)
    const enabled = support as CompressionSupport
    switch (this.compression) {
      case 'application/gzip':
        if (!enabled.gzip) throw unsupported()
        this.#content = gunzipSync(raw, { maxOutputLength: this.#maxEntryBytes })
        break
      case 'application/bzip2':
        if (!enabled.bzip2) throw unsupported()
        this.#content = Bunzip.decode(raw)
        break
      case 'application/zip':
        if (!enabled.zip) throw unsupported()
        this.#content = this.#zipEntry(null)
        break
      default:
        this.#content = raw
    }
  }

  /** ZipExtension::getContents (an entry beyond the limit: the file cannot be read) */
  #zipEntry(specificEntry: RegExp | null): Buffer {
    try {
      return this.#zipEntryData(specificEntry)
    } catch (e) {
      if (e instanceof RangeError) throw new ImportFileError(this.#t('File could not be read!'))
      throw e
    }
  }

  #zipEntryData(specificEntry: RegExp | null): Buffer {
    let entries: Array<{ name: string; data: Buffer }>
    try {
      entries = readZip(this.#raw, { maxEntryBytes: this.#maxEntryBytes })
    } catch {
      throw new ImportFileError(`${this.#t('Error in ZIP archive:')} Not a zip archive`)
    }
    if (entries.length === 0) throw new ImportFileError(this.#t('No files found inside ZIP archive!'))
    const first = entries[0] as { name: string; data: Buffer }
    let entry = specificEntry
    /* Is the the zip really an ODS file? */
    if (first.data.toString('latin1') === 'application/vnd.oasis.opendocument.spreadsheet') {
      entry = /^content\.xml$/
    }
    if (entry === null) return first.data
    const hit = entries.find((e) => entry.test(e.name))
    if (hit === undefined || hit.data.length === 0) {
      throw new ImportFileError(`${this.#t('Error in ZIP archive:')} Could not find "${String(entry)}"`)
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
    return this.compression === 'application/zip'
      ? readZip(this.#raw, { maxEntryBytes: this.#maxEntryBytes })
      : []
  }

  /** File::read (zip content is cut at a UTF-8 character boundary: mb_strcut) */
  read(size: number): Buffer {
    if (this.#source !== null) {
      const b = this.#source.read(size)
      return this.#convertChunk === null ? b : this.#convertChunk(b)
    }
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
    if (this.#source !== null) return this.#source.eof()
    return this.#offset >= this.#content.length
  }

  /** Converts the content from `charset` (Encoding::convertString, applied per chunk in pma). */
  convert(fn: (b: Buffer) => Buffer): void {
    if (this.#source !== null) this.#convertChunk = fn
    else this.#content = fn(this.#content)
  }

  /** Closes the file and removes a temporary decompressed copy. */
  close(): void {
    this.#source?.close()
    this.#source = null
  }
}
