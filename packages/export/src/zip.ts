import { constants as bufferConstants } from 'node:buffer'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * A ZIP archive the way phpMyAdmin writes it (one deflated entry per file, DOS local time, the
 * 'archive' attribute). With several buffers and one name, entries are named
 * `<base>_<key><ext>` (ext from the first dot of `name`).
 * pma: src/ZipExtension.php::createFile
 */
export function createZip(
  data: Buffer | Map<string, Buffer>,
  name: string | string[],
  now = new Date(),
): Buffer {
  let entries: Array<[string, Buffer]>
  if (Buffer.isBuffer(data) && typeof name === 'string') entries = [[name, data]]
  else if (!Buffer.isBuffer(data) && typeof name === 'string') {
    const extPos = name.indexOf('.') === -1 ? 0 : name.indexOf('.')
    const extension = name.slice(extPos)
    entries = [...data].map(([key, value]) => [
      extension === '' ? name : name.split(extension).join(`_${key}${extension}`),
      value,
    ])
  } else if (!Buffer.isBuffer(data) && Array.isArray(name) && name.length === data.size) {
    const values = [...data.values()]
    entries = name.map((n, i) => [n, values[i] as Buffer])
  } else {
    throw new Error('createZip: data and names do not match')
  }

  let year = now.getFullYear()
  let mon = now.getMonth() + 1
  let mday = now.getDate()
  let hours = now.getHours()
  let minutes = now.getMinutes()
  let seconds = now.getSeconds()
  if (year < 1980) {
    year = 1980
    mon = 1
    mday = 1
    hours = 0
    minutes = 0
    seconds = 0
  }
  const time =
    (((year - 1980) << 25) | (mon << 21) | (mday << 16) | (hours << 11) | (minutes << 5) | (seconds >> 1)) >>>
    0

  const datasec: Buffer[] = []
  const ctrlDir: Buffer[] = []
  let oldOffset = 0
  for (const [entryName, dump] of entries) {
    const tempName = Buffer.from(entryName.replaceAll('\\', '/'), 'utf8')
    const crc = crc32(dump) >>> 0
    const zdata = deflateRawSync(dump)
    const fr = Buffer.alloc(30)
    fr.writeUInt32LE(0x04034b50, 0)
    fr.writeUInt16LE(0x14, 4) // version needed to extract
    fr.writeUInt16LE(0, 6) // general purpose bit flag
    fr.writeUInt16LE(8, 8) // compression method
    fr.writeUInt32LE(time, 10)
    fr.writeUInt32LE(crc, 14)
    fr.writeUInt32LE(zdata.length, 18)
    fr.writeUInt32LE(dump.length, 22)
    fr.writeUInt16LE(tempName.length, 26)
    fr.writeUInt16LE(0, 28)
    const local = Buffer.concat([fr, tempName, zdata])
    datasec.push(local)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(0, 4) // version made by
    cd.writeUInt16LE(0x14, 6) // version needed to extract
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(time, 12)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(zdata.length, 20)
    cd.writeUInt32LE(dump.length, 24)
    cd.writeUInt16LE(tempName.length, 28)
    cd.writeUInt16LE(0, 30) // extra field length
    cd.writeUInt16LE(0, 32) // file comment length
    cd.writeUInt16LE(0, 34) // disk number start
    cd.writeUInt16LE(0, 36) // internal file attributes
    cd.writeUInt32LE(32, 38) // external file attributes - 'archive' bit set
    cd.writeUInt32LE(oldOffset, 42)
    ctrlDir.push(Buffer.concat([cd, tempName]))
    oldOffset += local.length
  }
  const tempCtrlDir = Buffer.concat(ctrlDir)
  const eof = Buffer.alloc(22)
  eof.writeUInt32LE(0x06054b50, 0)
  eof.writeUInt16LE(ctrlDir.length, 8)
  eof.writeUInt16LE(ctrlDir.length, 10)
  eof.writeUInt32LE(tempCtrlDir.length, 12)
  eof.writeUInt32LE(oldOffset, 16)
  return Buffer.concat([...datasec, tempCtrlDir, eof])
}

/**
 * The entries of a ZIP archive (stored or deflated), for import and tests. An entry's data is
 * inflated when first read, at most `maxEntryBytes` (a RangeError beyond: a zip bomb's entry).
 */
export function readZip(
  zip: Buffer,
  { maxEntryBytes = bufferConstants.MAX_LENGTH }: { maxEntryBytes?: number } = {},
): Array<{ name: string; data: Buffer }> {
  // locate the end of central directory record
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  const out: Array<{ name: string; data: Buffer }> = []
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory')
    const method = zip.readUInt16LE(p + 10)
    const cLen = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const offset = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = zip.readUInt16LE(offset + 26)
    const lExtraLen = zip.readUInt16LE(offset + 28)
    const start = offset + 30 + lNameLen + lExtraLen
    const raw = zip.subarray(start, start + cLen)
    let data: Buffer | null = null
    out.push({
      name,
      get data() {
        if (data === null) {
          if (method === 0 && raw.length > maxEntryBytes) throw new RangeError('zip entry too large')
          data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: maxEntryBytes })
        }
        return data
      },
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
