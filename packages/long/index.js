/**
 * A 64-bit integer from two 32-bit halves, as mysql2 builds one to read BIGINT and length-encoded
 * integers: `new Long(low, high, unsigned)`, then `toString()` or `toNumber()`. It stands in for the
 * `long` package (Apache-2.0), which cannot be combined with BetterMyAdmin's GPL-2.0-only code; the
 * root package.json overrides `long` with this package. Results match long 5.3.2 (test/long.test.ts).
 */
class Long {
  constructor(low, high, unsigned) {
    const bits = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0)
    this.value = unsigned ? bits : BigInt.asIntN(64, bits)
    this.unsigned = Boolean(unsigned)
  }

  toString(radix) {
    return this.value.toString(radix ?? 10)
  }

  toNumber() {
    return Number(this.value)
  }
}

module.exports = Long
module.exports.default = Long
module.exports.Long = Long
