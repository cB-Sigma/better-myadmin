/**
 * Approximate rendered string width (phpMyAdmin's character width table).
 * pma: src/Font.php::getStringWidth
 */
const CHAR_LISTS: ReadonlyArray<readonly [readonly string[], number]> = [
  [['i', 'j', 'l'], 0.23],
  [['f'], 0.27],
  [['t', 'I'], 0.28],
  [['r'], 0.34],
  [['1'], 0.49],
  [['c', 'k', 's', 'v', 'x', 'y', 'z', 'J'], 0.5],
  [
    ['a', 'b', 'd', 'e', 'g', 'h', 'n', 'o', 'p', 'q', 'u', 'L', '0', '2', '3', '4', '5', '6', '7', '8', '9'],
    0.56,
  ],
  [['F', 'T', 'Z'], 0.61],
  [['A', 'B', 'E', 'K', 'P', 'S', 'V', 'X', 'Y'], 0.67],
  [['w', 'C', 'D', 'H', 'N', 'R', 'U'], 0.73],
  [['G', 'O', 'Q'], 0.78],
  [['m', 'M'], 0.84],
  [['W'], 0.95],
  [[' '], 0.28],
]

const mbStrlen = (s: string) => [...s].length

export function getStringWidth(text: string, font: string, fontSize: number): number {
  let count = 0
  for (const [chars, modifier] of CHAR_LISTS) {
    let without = text
    for (const c of chars) without = without.split(c).join('')
    count += (mbStrlen(text) - mbStrlen(without)) * modifier
  }
  // all other characters
  count +=
    mbStrlen(
      text
        .split(' ')
        .join('')
        .replace(/[a-z0-9]/gi, ''),
    ) * 0.3
  let modifier = 1
  switch (font.toLowerCase()) {
    case 'times':
    case 'serif':
    case 'brushscriptstd':
    case 'californian fb':
      modifier = 0.92
      break
    case 'broadway':
      modifier = 1.23
      break
  }
  return Math.ceil(count * fontSize * modifier)
}
