/**
 * Server identity and capability checks.
 *
 * pma: src/Query/Compatibility.php, src/Util.php::getServerType,
 *      src/Dbal/DatabaseInterface.php::isMariaDB/isMySql/isPercona/getVersion
 */

export type ServerVendor = 'mysql' | 'mariadb' | 'percona'

/** Input that toggles type/function availability. `version` is phpMyAdmin's integer form, e.g. 80400. */
export interface ServerInfo {
  vendor: ServerVendor
  version: number
}

/** phpMyAdmin's default when no server is connected (`DatabaseInterface::$versionInt = 55000`, MySQL) */
export const DEFAULT_SERVER: ServerInfo = { vendor: 'mysql', version: 55000 }

/** pma: src/Dbal/DatabaseInterface.php::isMariaDB */
export const isMariaDB = (s: ServerInfo): boolean => s.vendor === 'mariadb'
/** pma: src/Dbal/DatabaseInterface.php::isMySql (true for Percona too) */
export const isMySql = (s: ServerInfo): boolean => s.vendor !== 'mariadb'
/** pma: src/Dbal/DatabaseInterface.php::isPercona */
export const isPercona = (s: ServerInfo): boolean => s.vendor === 'percona'

/** pma: src/Util.php::getServerType */
export function getServerType(s: ServerInfo): 'MariaDB' | 'Percona Server' | 'MySQL' {
  if (isMariaDB(s)) return 'MariaDB'
  if (isPercona(s)) return 'Percona Server'
  return 'MySQL'
}

/**
 * Parses a `@@version` string (+ optional `@@version_comment`) into a ServerInfo.
 * pma: src/Dbal/DatabaseInterface.php::setVersion + src/Utils/... versionToInt
 */
export function parseServerVersion(versionString: string, versionComment = ''): ServerInfo {
  const parts = versionString.split('.')
  const num = (i: number): number => {
    const m = /^\d+/.exec(parts[i] ?? '')
    return m === null ? 0 : Number.parseInt(m[0], 10)
  }
  const version = num(0) * 10000 + num(1) * 100 + num(2)
  const vendor: ServerVendor = /mariadb/i.test(versionString)
    ? 'mariadb'
    : /percona/i.test(versionComment)
      ? 'percona'
      : 'mysql'
  return { vendor, version }
}

/** pma: Compatibility::isMySqlOrPerconaDb */
export const isMySqlOrPerconaDb = (s: ServerInfo): boolean => getServerType(s) !== 'MariaDB'
/** pma: Compatibility::isMariaDb */
export const isMariaDb = (s: ServerInfo): boolean => getServerType(s) === 'MariaDB'

/** pma: Compatibility::isCompatibleRenameIndex */
export function isCompatibleRenameIndex(s: ServerInfo): boolean {
  if (isMySqlOrPerconaDb(s)) return s.version >= 50700
  return s.version >= 100502
}

/** pma: Compatibility::isIntegersLengthRestricted (MySQL >= 8.0.18 only, not Percona) */
export const isIntegersLengthRestricted = (s: ServerInfo): boolean =>
  getServerType(s) === 'MySQL' && s.version >= 80018

/** pma: Compatibility::supportsReferencesPrivilege */
export const supportsReferencesPrivilege = (s: ServerInfo): boolean => !isMariaDB(s) && s.version >= 50622

/**
 * Whether a length is kept for the integer type in DDL.
 * pma: Compatibility::isIntegersSupportLength
 */
export function isIntegersSupportLength(type: string, length: string, s: ServerInfo): boolean {
  const integerTypes = ['SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT']
  const typeLengthNotAllowed = integerTypes.includes(type) || (type === 'TINYINT' && length !== '1')
  return !(isIntegersLengthRestricted(s) && typeLengthNotAllowed)
}

/** pma: Compatibility::isVirtualColumnsSupported */
export const isVirtualColumnsSupported = (s: ServerInfo): boolean =>
  isMySqlOrPerconaDb(s) ? s.version >= 50706 : s.version >= 50200

/** pma: Compatibility::isJsonSupported */
export const isJsonSupported = (s: ServerInfo): boolean =>
  (isMariaDB(s) && s.version >= 100207) || (!isMariaDB(s) && s.version >= 50708)

/** pma: Compatibility::isUUIDSupported (MariaDB >= 10.7.0) */
export const isUUIDSupported = (s: ServerInfo): boolean => isMariaDB(s) && s.version >= 100700
/** pma: Compatibility::isUUIDv4Supported (MariaDB >= 11.7.0) */
export const isUUIDv4Supported = (s: ServerInfo): boolean => isMariaDB(s) && s.version >= 110700
/** pma: Compatibility::isUUIDv7Supported (MariaDB >= 11.7.0) */
export const isUUIDv7Supported = (s: ServerInfo): boolean => isMariaDB(s) && s.version >= 110700

/** pma: Compatibility::isVectorSupported (MariaDB >= 11.7.1, MySQL/Percona >= 9.0.0) */
export const isVectorSupported = (s: ServerInfo): boolean =>
  (isMariaDB(s) && s.version >= 110701) || (isMySql(s) && s.version >= 90000)

/** pma: Compatibility::isXmlTypeSupported (MariaDB >= 12.3.0) */
export const isXmlTypeSupported = (s: ServerInfo): boolean => isMariaDB(s) && s.version >= 120300

/** pma: Compatibility::supportsStoredKeywordForVirtualColumns */
export const supportsStoredKeywordForVirtualColumns = (s: ServerInfo): boolean =>
  isMySqlOrPerconaDb(s) ? s.version >= 50706 : s.version >= 100201

/** pma: Compatibility::supportsCompressedColumns (MariaDB >= 10.1) */
export const supportsCompressedColumns = (s: ServerInfo): boolean => isMariaDb(s) && s.version >= 100100

/** pma: Compatibility::hasAccountLocking */
export const hasAccountLocking = (s: ServerInfo): boolean =>
  (isMariaDB(s) && s.version >= 100402) || (!isMariaDB(s) && s.version >= 50706)

/** pma: Compatibility::getShowBinLogStatusStmt */
export function getShowBinLogStatusStmt(s: ServerInfo): string {
  if (isMySql(s) && s.version >= 80200) return 'SHOW BINARY LOG STATUS'
  if (isMariaDB(s) && s.version >= 100502) return 'SHOW BINLOG STATUS'
  return 'SHOW MASTER STATUS'
}

/**
 * Whether a MariaDB virtual column may carry a COLLATE clause (MDEV-12161).
 * pma: src/Table/Table.php::generateFieldSpec ($isVirtualCollationSupported)
 */
export function isVirtualCollationSupported(s: ServerInfo): boolean {
  const v = s.version
  return (
    v >= 100509 || (v >= 100418 && v < 100500) || (v >= 100328 && v < 100400) || (v >= 100237 && v < 100300)
  )
}
