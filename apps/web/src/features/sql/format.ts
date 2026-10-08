/**
 * Byte formatting like phpMyAdmin's Util::formatByteDown (limes 6, comma 0 for B, 1 otherwise).
 */
export function formatByteDown(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
  let i = 0
  let value = bytes
  // pma: move to the next unit once the value has more than `limes` (6) digits
  while (i < units.length - 1 && value >= 10 ** 6 / 1) {
    value /= 1024
    i++
  }
  if (i === 0) return `${value} ${units[0]}`
  return `${value.toFixed(1)} ${units[i]}`
}
