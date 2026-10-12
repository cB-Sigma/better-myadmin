/**
 * Version-aware replication statements, with phpMyAdmin's choice of terminology per server:
 * MySQL ≥ 8.0.22 / MariaDB ≥ 10.5.1 say REPLICA, older servers SLAVE; MySQL ≥ 8.0.23 changes the
 * primary with CHANGE REPLICATION SOURCE, everything else with CHANGE MASTER; MySQL ≥ 8.4 skips
 * errors with SQL_REPLICA_SKIP_COUNTER (MariaDB keeps SQL_SLAVE_SKIP_COUNTER).
 *
 * pma: src/Replication/Replication.php, src/Replication/ReplicationInfo.php,
 *      src/Replication/ReplicationGui.php, src/Query/Compatibility.php::getShowBinLogStatusStmt
 */
import { quoteString } from './quote.ts'

export interface ServerFlavour {
  versionInt: number
  isMariaDb: boolean
}

/** MySQL ≥ 8.0.22 or MariaDB ≥ 10.5.1: the REPLICA keyword */
export function usesReplicaKeyword(s: ServerFlavour): boolean {
  return (!s.isMariaDb && s.versionInt >= 80022) || (s.isMariaDb && s.versionInt >= 100501)
}

/** Compatibility::getShowBinLogStatusStmt */
export function showBinLogStatusSql(s: ServerFlavour): string {
  if (!s.isMariaDb && s.versionInt >= 80200) return 'SHOW BINARY LOG STATUS'
  if (s.isMariaDb && s.versionInt >= 100502) return 'SHOW BINLOG STATUS'
  return 'SHOW MASTER STATUS'
}

/** ReplicationInfo::setReplicaStatus */
export function showReplicaStatusSql(s: ServerFlavour): string {
  return usesReplicaKeyword(s) ? 'SHOW REPLICA STATUS' : 'SHOW SLAVE STATUS'
}

/** ReplicationInfo::setMultiPrimaryStatus / ReplicationGui::getHtmlForReplicaConfiguration (MariaDB only) */
export function showAllReplicasStatusSql(s: ServerFlavour): string | null {
  if (!s.isMariaDb) return null
  return s.versionInt >= 100501 ? 'SHOW ALL REPLICAS STATUS' : 'SHOW ALL SLAVES STATUS'
}

/** ReplicationInfo::setDefaultPrimaryConnection (MariaDB multi-source) */
export function setDefaultPrimaryConnectionSql(connection: string): string {
  return `SET @@default_master_connection = ${quoteString(connection)}`
}

/** ReplicationGui::getHtmlForPrimaryReplication — the connected replicas */
export function showReplicasSql(s: ServerFlavour): string {
  if (!s.isMariaDb && s.versionInt >= 80022) return 'SHOW REPLICAS'
  if (s.isMariaDb && s.versionInt >= 100501) return 'SHOW REPLICA HOSTS'
  return 'SHOW SLAVE HOSTS'
}

/**
 * Replication::replicaControl — `START|STOP REPLICA [SQL_THREAD|IO_THREAD];` (the keyword and the
 * control are joined by spaces even when the control is empty: `START REPLICA ;`). null for an
 * action or control phpMyAdmin rejects (its -1).
 */
export function replicaControlSql(
  s: ServerFlavour,
  action: string,
  control: string | null = null,
): string | null {
  const a = action.toUpperCase()
  const c = control !== null ? control.toUpperCase() : ''
  if (a !== 'START' && a !== 'STOP') return null
  if (c !== 'SQL_THREAD' && c !== 'IO_THREAD' && c !== '') return null
  return `${a} ${usesReplicaKeyword(s) ? 'REPLICA' : 'SLAVE'} ${c};`
}

/** ReplicationGui::handleRequestForReplicaServerControl — the reset between STOP and START */
export function resetReplicaSql(s: ServerFlavour): string {
  return usesReplicaKeyword(s) ? 'RESET REPLICA;' : 'RESET SLAVE;'
}

/** ReplicationGui::handleRequestForReplicaSkipError (MySQL ≥ 8.4: SQL_REPLICA_SKIP_COUNTER) */
export function skipCounterSql(s: ServerFlavour, count: number): string {
  const name = !s.isMariaDb && s.versionInt >= 80400 ? 'SQL_REPLICA_SKIP_COUNTER' : 'SQL_SLAVE_SKIP_COUNTER'
  return `SET GLOBAL ${name} = ${Math.trunc(count)};`
}

/**
 * Replication::replicaChangePrimary — `CHANGE REPLICATION SOURCE TO SOURCE_…` (MySQL ≥ 8.0.23) or
 * `CHANGE MASTER TO MASTER_…`. The log position is inserted as read from the primary.
 */
export function changePrimarySql(
  s: ServerFlavour,
  o: { user: string; password: string; host: string; port: number; file: string; position: string },
): string {
  const p = !s.isMariaDb && s.versionInt >= 80023 ? 'SOURCE' : 'MASTER'
  const head = p === 'SOURCE' ? 'CHANGE REPLICATION SOURCE TO ' : 'CHANGE MASTER TO '
  return (
    `${head}${p}_HOST=${quoteString(o.host)},` +
    `${p}_PORT=${Math.trunc(o.port)},` +
    `${p}_USER=${quoteString(o.user)},` +
    `${p}_PASSWORD=${quoteString(o.password)},` +
    `${p}_LOG_FILE=${quoteString(o.file)},` +
    `${p}_LOG_POS=${o.position};`
  )
}
