import { describe, expect, it } from 'vitest'
import {
  type ServerInfo,
  type TypeClass,
  getAllFunctions,
  getAttributes,
  getColumns,
  getDatatypeOptions,
  getFunctionsClass,
  getServerType,
  getShowBinLogStatusStmt,
  getSupportedDatatypes,
  hasAccountLocking,
  isCompatibleRenameIndex,
  isIntegersLengthRestricted,
  isIntegersSupportLength,
  isJsonSupported,
  isMariaDb,
  isMySqlOrPerconaDb,
  isUUIDSupported,
  isUUIDv4Supported,
  isUUIDv7Supported,
  isVectorSupported,
  isVirtualColumnsSupported,
  isXmlTypeSupported,
  parseServerVersion,
  supportsCompressedColumns,
  supportsReferencesPrivilege,
  supportsStoredKeywordForVirtualColumns,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

interface ServerCase {
  server: ServerInfo
  serverType: string
  columns: unknown[]
  supportedDatatypes: string[]
  attributes: string[]
  functionsClass: Record<string, string[]>
  allFunctions: string[]
  datatypeOptions: unknown[]
  compat: Record<string, boolean | string>
  integersSupportLength: [string, string, boolean][]
}

const { servers } = loadFixture<{ servers: ServerCase[] }>('catalog-by-server.json')

describe('type catalog per server (golden, executed phpMyAdmin)', () => {
  it('covers a matrix of servers', () => {
    expect(servers.length).toBeGreaterThanOrEqual(25)
  })

  for (const c of servers) {
    const s = c.server
    describe(`${s.vendor} ${s.version}`, () => {
      it('Types::getColumns / Util::getSupportedDatatypes / getAttributes', () => {
        expect(getServerType(s)).toBe(c.serverType)
        expect(getColumns(s)).toEqual(c.columns)
        expect(getSupportedDatatypes(s)).toEqual(c.supportedDatatypes)
        expect(getAttributes(s)).toEqual(c.attributes)
      })

      it('Types::getFunctionsClass / getAllFunctions', () => {
        for (const [cls, list] of Object.entries(c.functionsClass)) {
          const tc = (cls === 'UNKNOWN' ? '' : cls) as TypeClass
          expect(getFunctionsClass(tc, s), cls).toEqual(list)
        }
        expect(getAllFunctions(s)).toEqual(c.allFunctions)
      })

      it('Generator::getSupportedDatatypes options', () => {
        expect(getDatatypeOptions(s, 'VARCHAR')).toEqual(c.datatypeOptions)
      })

      it('Compatibility::*', () => {
        const actual = {
          isMySqlOrPerconaDb: isMySqlOrPerconaDb(s),
          isMariaDb: isMariaDb(s),
          isCompatibleRenameIndex: isCompatibleRenameIndex(s),
          isIntegersLengthRestricted: isIntegersLengthRestricted(s),
          supportsReferencesPrivilege: supportsReferencesPrivilege(s),
          isVirtualColumnsSupported: isVirtualColumnsSupported(s),
          isJsonSupported: isJsonSupported(s),
          isUUIDSupported: isUUIDSupported(s),
          isUUIDv4Supported: isUUIDv4Supported(s),
          isUUIDv7Supported: isUUIDv7Supported(s),
          isVectorSupported: isVectorSupported(s),
          isXmlTypeSupported: isXmlTypeSupported(s),
          supportsStoredKeywordForVirtualColumns: supportsStoredKeywordForVirtualColumns(s),
          supportsCompressedColumns: supportsCompressedColumns(s),
          hasAccountLocking: hasAccountLocking(s),
          showBinLogStatusStmt: getShowBinLogStatusStmt(s),
        }
        expect(actual).toEqual(c.compat)
        for (const [type, length, expected] of c.integersSupportLength) {
          expect(isIntegersSupportLength(type, length, s), `${type}(${length})`).toBe(expected)
        }
      })
    })
  }
})

describe('parseServerVersion', () => {
  it('parses MySQL, MariaDB and Percona version strings', () => {
    expect(parseServerVersion('8.4.0')).toEqual({ vendor: 'mysql', version: 80400 })
    expect(parseServerVersion('8.0.36-28', 'Percona Server (GPL), Release 28')).toEqual({
      vendor: 'percona',
      version: 80036,
    })
    expect(parseServerVersion('11.4.2-MariaDB-ubu2404')).toEqual({ vendor: 'mariadb', version: 110402 })
    expect(parseServerVersion('5.7.44-log')).toEqual({ vendor: 'mysql', version: 50744 })
  })
})
