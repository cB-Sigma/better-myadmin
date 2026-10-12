/**
 * A QR code encoder for the two-factor setup (byte mode, error correction level L), the algorithm
 * of bacon/bacon-qr-code (ZXing's Encoder) that phpMyAdmin's Google2FA-QRCode uses: minimal
 * version, mask chosen by the lowest penalty, so the module matrix is the same.
 *
 * pma: vendor bacon/bacon-qr-code src/Encoder/{Encoder,MatrixUtil,MaskUtil}.php (via
 *      pragmarx/google2fa-qrcode, src/Plugins/TwoFactor/Application.php::setup)
 */

/** Level L: [EC codewords per block, blocks group 1, data codewords, blocks group 2, data codewords] */
const EC_L: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [7, 1, 19, 0, 0],
  [10, 1, 34, 0, 0],
  [15, 1, 55, 0, 0],
  [20, 1, 80, 0, 0],
  [26, 1, 108, 0, 0],
  [18, 2, 68, 0, 0],
  [20, 2, 78, 0, 0],
  [24, 2, 97, 0, 0],
  [30, 2, 116, 0, 0],
  [18, 2, 68, 2, 69],
  [20, 4, 81, 0, 0],
  [24, 2, 92, 2, 93],
  [26, 4, 107, 0, 0],
  [30, 3, 115, 1, 116],
  [22, 5, 87, 1, 88],
]

const ALIGNMENT: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
]

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number
}
const mul = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number)

/** Reed-Solomon EC codewords of one block. */
function rsEncode(data: number[], ecLen: number): number[] {
  // generator polynomial (x - a^0)(x - a^1)…(x - a^(ecLen-1))
  let gen = [1]
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] = (next[j] as number) ^ (gen[j] as number)
      next[j + 1] = (next[j + 1] as number) ^ mul(gen[j] as number, EXP[i] as number)
    }
    gen = next
  }
  const res = [...data, ...new Array<number>(ecLen).fill(0)]
  for (let i = 0; i < data.length; i++) {
    const coef = res[i] as number
    if (coef === 0) continue
    for (let j = 0; j < gen.length; j++) res[i + j] = (res[i + j] as number) ^ mul(gen[j] as number, coef)
  }
  return res.slice(data.length)
}

const dataCapacity = (v: number) => {
  const [, b1, d1, b2, d2] = EC_L[v - 1] as readonly number[]
  return (b1 as number) * (d1 as number) + (b2 as number) * (d2 as number)
}

function bchCode(value: number, poly: number): number {
  const msb = (n: number) => 32 - Math.clz32(n)
  const polyBits = msb(poly)
  let v = value << (polyBits - 1)
  while (msb(v) >= polyBits) v ^= poly << (msb(v) - polyBits)
  return v
}

type Matrix = Int8Array[]

function newMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Int8Array(size).fill(-1))
}

function placeFunctionPatterns(m: Matrix, version: number): void {
  const size = m.length
  const finder = (x0: number, y0: number) => {
    for (let y = -1; y <= 7; y++)
      for (let x = -1; x <= 7; x++) {
        const xx = x0 + x
        const yy = y0 + y
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
        ;(m[yy] as Int8Array)[xx] = ring === 2 || ring === 4 ? 0 : 1
      }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)
  // dark module
  ;(m[size - 8] as Int8Array)[8] = 1
  // alignment patterns (not over the finders)
  const pos = ALIGNMENT[version - 1] as readonly number[]
  for (const y of pos)
    for (const x of pos) {
      if ((m[y] as Int8Array)[x] !== -1) continue
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy))
          ;(m[y + dy] as Int8Array)[x + dx] = ring === 1 ? 0 : 1
        }
    }
  // timing
  for (let i = 8; i < size - 8; i++) {
    const bit = (i + 1) % 2
    if ((m[6] as Int8Array)[i] === -1) (m[6] as Int8Array)[i] = bit
    if ((m[i] as Int8Array)[6] === -1) (m[i] as Int8Array)[6] = bit
  }
  // version information
  if (version >= 7) {
    const bits = (version << 12) | bchCode(version, 0x1f25)
    let k = 0
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        const bit = (bits >> k) & 1
        k++
        ;(m[size - 11 + j] as Int8Array)[i] = bit
        ;(m[i] as Int8Array)[size - 11 + j] = bit
      }
  }
}

/** ZXing MatrixUtil::embedTypeInfo (level L = 01) */
function placeTypeInfo(m: Matrix, mask: number): void {
  const size = m.length
  const typeInfo = (((1 << 3) | mask) << 10) | bchCode((1 << 3) | mask, 0x537)
  const bits = typeInfo ^ 0x5412
  const coords: Array<[number, number]> = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ]
  for (let i = 0; i < 15; i++) {
    // LSB first (ZXing places typeInfoBits from the last one)
    const bit = (bits >> i) & 1
    const [x1, y1] = coords[i] as [number, number]
    ;(m[y1] as Int8Array)[x1] = bit
    if (i < 8) (m[8] as Int8Array)[size - 1 - i] = bit
    else (m[size - 7 + (i - 8)] as Int8Array)[8] = bit
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  let t: number
  switch (mask) {
    case 0:
      t = (y + x) & 1
      break
    case 1:
      t = y & 1
      break
    case 2:
      t = x % 3
      break
    case 3:
      t = (y + x) % 3
      break
    case 4:
      t = (Math.floor(y / 2) + Math.floor(x / 3)) & 1
      break
    case 5:
      t = ((y * x) & 1) + ((y * x) % 3)
      break
    case 6:
      t = (((y * x) & 1) + ((y * x) % 3)) & 1
      break
    default:
      t = (((y * x) % 3) + ((y + x) & 1)) & 1
  }
  return t === 0
}

/** ZXing MatrixUtil::embedDataBits */
function placeData(m: Matrix, bits: number[], mask: number): void {
  const size = m.length
  let index = 0
  let dir = -1
  let x = size - 1
  let y = size - 1
  while (x > 0) {
    if (x === 6) x--
    while (y >= 0 && y < size) {
      for (let i = 0; i < 2; i++) {
        const xx = x - i
        const row = m[y] as Int8Array
        if (row[xx] !== -1) continue
        let bit = index < bits.length ? (bits[index] as number) : 0
        index++
        if (maskBit(mask, xx, y)) bit ^= 1
        row[xx] = bit
      }
      y += dir
    }
    dir = -dir
    y += dir
    x -= 2
  }
}

/** ZXing MaskUtil rules 1–4 */
function penalty(m: Matrix): number {
  const size = m.length
  const at = (x: number, y: number) => (m[y] as Int8Array)[x] as number
  let p = 0
  // rule 1
  for (const horizontal of [true, false]) {
    for (let i = 0; i < size; i++) {
      let run = 0
      let prev = -1
      for (let j = 0; j < size; j++) {
        const bit = horizontal ? at(j, i) : at(i, j)
        if (bit === prev) run++
        else {
          if (run >= 5) p += 3 + (run - 5)
          run = 1
          prev = bit
        }
      }
      if (run >= 5) p += 3 + (run - 5)
    }
  }
  // rule 2
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const v = at(x, y)
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3
    }
  // rule 3
  const white = (get: (k: number) => number, from: number, to: number) => {
    for (let k = Math.max(from, 0); k < Math.min(to, size); k++) if (get(k) === 1) return false
    return true
  }
  let n3 = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const row = (k: number) => at(k, y)
      if (
        x + 6 < size &&
        row(x) === 1 &&
        row(x + 1) === 0 &&
        row(x + 2) === 1 &&
        row(x + 3) === 1 &&
        row(x + 4) === 1 &&
        row(x + 5) === 0 &&
        row(x + 6) === 1 &&
        (white(row, x - 4, x) || white(row, x + 7, x + 11))
      )
        n3++
      const col = (k: number) => at(x, k)
      if (
        y + 6 < size &&
        col(y) === 1 &&
        col(y + 1) === 0 &&
        col(y + 2) === 1 &&
        col(y + 3) === 1 &&
        col(y + 4) === 1 &&
        col(y + 5) === 0 &&
        col(y + 6) === 1 &&
        (white(col, y - 4, y) || white(col, y + 7, y + 11))
      )
        n3++
    }
  p += n3 * 40
  // rule 4
  let dark = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += at(x, y)
  const total = size * size
  p += Math.floor((Math.abs(dark * 2 - total) * 10) / total) * 10
  return p
}

/** Byte-mode text → modules (`1` dark, `0` light), one string per row. */
export function qrMatrix(text: string): string[] {
  const bytes = [...new TextEncoder().encode(text)]
  const ccBits = (v: number) => (v < 10 ? 8 : 16)
  const fits = (v: number) => Math.ceil((4 + ccBits(v) + bytes.length * 8) / 8) <= dataCapacity(v)
  let version = 1
  while (version <= EC_L.length && !fits(version)) version++
  if (version > EC_L.length) throw new Error('QR code: text too long')
  const capacity = dataCapacity(version)

  const bits: number[] = []
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ccBits(version))
  for (const b of bytes) put(b, 8)
  // terminator, byte boundary, pad bytes
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(Number.parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0; data.length < capacity; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11)

  // blocks + interleave
  const [ecLen, b1, d1, b2, d2] = EC_L[version - 1] as readonly [number, number, number, number, number]
  const blocks: number[][] = []
  let off = 0
  for (let i = 0; i < b1; i++) {
    blocks.push(data.slice(off, off + d1))
    off += d1
  }
  for (let i = 0; i < b2; i++) {
    blocks.push(data.slice(off, off + d2))
    off += d2
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen))
  const final: number[] = []
  const maxData = Math.max(d1, d2)
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) final.push(b[i] as number)
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) final.push(b[i] as number)
  const dataBits: number[] = []
  for (const c of final) for (let i = 7; i >= 0; i--) dataBits.push((c >> i) & 1)

  const size = 17 + version * 4
  let best: Matrix | null = null
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    const m = newMatrix(size)
    // MatrixUtil::buildMatrix: basic patterns, type info, version info, data
    placeFunctionPatterns(m, version)
    placeTypeInfo(m, mask)
    placeData(m, dataBits, mask)
    const p = penalty(m)
    if (p < bestPenalty) {
      bestPenalty = p
      best = m
    }
  }
  return (best as Matrix).map((row) => Array.from(row, (b) => (b === 1 ? '1' : '0')).join(''))
}
