import type { NavDbi } from '../navigation/dbi.ts'

type Rows = Array<Record<string, string | null>>

/**
 * Primary / replica facts read by every page that shows replication state.
 * pma: src/Replication/ReplicationInfo.php, src/Query/Compatibility.php::getShowBinLogStatusStmt
 */
export class ReplicationInfo {
  static readonly primaryVariables = ['File', 'Position', 'Binlog_Do_DB', 'Binlog_Ignore_DB']

  static readonly replicaVariables = [
    'Slave_IO_State',
    'Replica_IO_State',
    'Master_Host',
    'Source_Host',
    'Master_User',
    'Source_User',
    'Master_Port',
    'Source_Port',
    'Connect_Retry',
    'Master_Log_File',
    'Source_Log_File',
    'Read_Master_Log_Pos',
    'Read_Source_Log_Pos',
    'Relay_Log_File',
    'Relay_Log_Pos',
    'Relay_Master_Log_File',
    'Relay_Source_Log_File',
    'Slave_IO_Running',
    'Replica_IO_Running',
    'Slave_SQL_Running',
    'Replica_SQL_Running',
    'Replicate_Do_DB',
    'Replicate_Ignore_DB',
    'Replicate_Do_Table',
    'Replicate_Ignore_Table',
    'Replicate_Wild_Do_Table',
    'Replicate_Wild_Ignore_Table',
    'Last_Errno',
    'Last_Error',
    'Skip_Counter',
    'Exec_Master_Log_Pos',
    'Exec_Source_Log_Pos',
    'Relay_Log_Space',
    'Until_Condition',
    'Until_Log_File',
    'Until_Log_Pos',
    'Master_SSL_Allowed',
    'Source_SSL_Allowed',
    'Master_SSL_CA_File',
    'Source_SSL_CA_File',
    'Master_SSL_CA_Path',
    'Source_SSL_CA_Path',
    'Master_SSL_Cert',
    'Source_SSL_Cert',
    'Master_SSL_Cipher',
    'Source_SSL_Cipher',
    'Master_SSL_Key',
    'Source_SSL_Key',
    'Seconds_Behind_Master',
    'Seconds_Behind_Source',
  ]

  primaryStatus: Rows = []
  replicaStatus: Rows = []
  primaryInfo: { status: boolean; doDb: string[]; ignoreDb: string[] } = {
    status: false,
    doDb: [],
    ignoreDb: [],
  }
  replicaInfo: { status: boolean; doDb: string[]; ignoreDb: string[] } = {
    status: false,
    doDb: [],
    ignoreDb: [],
  }

  readonly #dbi: NavDbi
  readonly #versionInt: number
  readonly #isMariaDb: boolean

  constructor(dbi: NavDbi, versionInt: number, isMariaDb: boolean) {
    this.#dbi = dbi
    this.#versionInt = versionInt
    this.#isMariaDb = isMariaDb
  }

  /** ReplicationInfo::load — the multi-source `primary_connection` (MariaDB) is the replication page's. */
  async load(): Promise<this> {
    this.primaryStatus = await this.#dbi.fetchResultSimple(this.#showBinLogStatusStmt())
    const v = this.#versionInt
    this.replicaStatus = await this.#dbi.fetchResultSimple(
      (!this.#isMariaDb && v >= 80022) || (this.#isMariaDb && v >= 100501)
        ? 'SHOW REPLICA STATUS'
        : 'SHOW SLAVE STATUS',
    )
    const fill = (status: Rows, key: string): string[] => {
      const v0 = status[0]?.[key]
      // empty($status[0][$key])
      return v0 === undefined || v0 === null || v0 === '' || v0 === '0' ? [] : v0.split(',')
    }
    this.primaryInfo = {
      status: this.primaryStatus.length > 0,
      doDb: fill(this.primaryStatus, 'Binlog_Do_DB'),
      ignoreDb: fill(this.primaryStatus, 'Binlog_Ignore_DB'),
    }
    this.replicaInfo = {
      status: this.replicaStatus.length > 0,
      doDb: fill(this.replicaStatus, 'Replicate_Do_DB'),
      ignoreDb: fill(this.replicaStatus, 'Replicate_Ignore_DB'),
    }
    return this
  }

  /** Compatibility::getShowBinLogStatusStmt */
  #showBinLogStatusStmt(): string {
    if (!this.#isMariaDb && this.#versionInt >= 80200) return 'SHOW BINARY LOG STATUS'
    if (this.#isMariaDb && this.#versionInt >= 100502) return 'SHOW BINLOG STATUS'
    return 'SHOW MASTER STATUS'
  }
}

/**
 * pma: ReplicationGui::getHtmlForReplicationStatusTable — the variables of the primary or replica
 * status table (it loads its own ReplicationInfo).
 */
export async function replicationStatusTable(
  dbi: NavDbi,
  versionInt: number,
  isMariaDb: boolean,
  type: 'primary' | 'replica',
): Promise<{
  type: 'primary' | 'replica'
  variables: Array<{ name: string; value: string; status: '' | 'text-danger' | 'text-success' }>
}> {
  const info = await new ReplicationInfo(dbi, versionInt, isMariaDb).load()
  const names = type === 'primary' ? ReplicationInfo.primaryVariables : ReplicationInfo.replicaVariables
  const status = type === 'primary' ? info.primaryStatus : info.replicaStatus
  const alerts: Record<string, string> =
    type === 'replica'
      ? {
          Slave_IO_Running: 'No',
          Slave_SQL_Running: 'No',
          Replica_IO_Running: 'No',
          Replica_SQL_Running: 'No',
        }
      : {}
  const oks: Record<string, string> =
    type === 'replica'
      ? {
          Slave_IO_Running: 'Yes',
          Slave_SQL_Running: 'Yes',
          Replica_IO_Running: 'Yes',
          Replica_SQL_Running: 'Yes',
        }
      : {}
  const wrap = [
    'Replicate_Do_DB',
    'Replicate_Ignore_DB',
    'Replicate_Do_Table',
    'Replicate_Ignore_Table',
    'Replicate_Wild_Do_Table',
    'Replicate_Wild_Ignore_Table',
  ]
  const variables: Array<{ name: string; value: string; status: '' | 'text-danger' | 'text-success' }> = []
  for (const name of names) {
    const value = status[0]?.[name]
    // isset(): null values are skipped
    if (value === undefined || value === null) continue
    variables.push({
      name,
      value: wrap.includes(name) ? value.replaceAll(',', ', ') : value,
      status: alerts[name] === value ? 'text-danger' : oks[name] === value ? 'text-success' : '',
    })
  }
  return { type, variables }
}
