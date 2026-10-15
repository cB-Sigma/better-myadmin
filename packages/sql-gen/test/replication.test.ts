import { describe, expect, it } from 'vitest'
import {
  changePrimarySql,
  replicaControlSql,
  resetReplicaSql,
  setDefaultPrimaryConnectionSql,
  showAllReplicasStatusSql,
  showBinLogStatusSql,
  showReplicaStatusSql,
  showReplicasSql,
  skipCounterSql,
} from '../src/replication.ts'

const mysql = (versionInt: number) => ({ versionInt, isMariaDb: false })
const maria = (versionInt: number) => ({ versionInt, isMariaDb: true })

/** phpMyAdmin's terminology per server (src/Replication/*.php, Compatibility::getShowBinLogStatusStmt) */
describe('replication statements [p06-ba939d]', () => {
  it('binary log status: SHOW BINARY LOG STATUS (MySQL 8.2+), SHOW BINLOG STATUS (MariaDB 10.5.2+)', () => {
    expect(showBinLogStatusSql(mysql(80411))).toBe('SHOW BINARY LOG STATUS')
    expect(showBinLogStatusSql(mysql(80200))).toBe('SHOW BINARY LOG STATUS')
    expect(showBinLogStatusSql(mysql(80199))).toBe('SHOW MASTER STATUS')
    expect(showBinLogStatusSql(maria(100502))).toBe('SHOW BINLOG STATUS')
    expect(showBinLogStatusSql(maria(100501))).toBe('SHOW MASTER STATUS')
  })

  it('replica status and hosts: REPLICA from MySQL 8.0.22 / MariaDB 10.5.1', () => {
    expect(showReplicaStatusSql(mysql(80022))).toBe('SHOW REPLICA STATUS')
    expect(showReplicaStatusSql(mysql(80021))).toBe('SHOW SLAVE STATUS')
    expect(showReplicaStatusSql(maria(100501))).toBe('SHOW REPLICA STATUS')
    expect(showReplicaStatusSql(maria(100500))).toBe('SHOW SLAVE STATUS')
    expect(showReplicasSql(mysql(80411))).toBe('SHOW REPLICAS')
    expect(showReplicasSql(maria(110402))).toBe('SHOW REPLICA HOSTS')
    expect(showReplicasSql(maria(100406))).toBe('SHOW SLAVE HOSTS')
    expect(showReplicasSql(mysql(50744))).toBe('SHOW SLAVE HOSTS')
  })

  it('multi-source status and default connection are MariaDB only', () => {
    expect(showAllReplicasStatusSql(mysql(80411))).toBeNull()
    expect(showAllReplicasStatusSql(maria(110402))).toBe('SHOW ALL REPLICAS STATUS')
    expect(showAllReplicasStatusSql(maria(100406))).toBe('SHOW ALL SLAVES STATUS')
    expect(setDefaultPrimaryConnectionSql("it's")).toBe("SET @@default_master_connection = 'it\\'s'")
  })

  it('START/STOP keep the space before the empty control and reject other values', () => {
    expect(replicaControlSql(mysql(80411), 'start')).toBe('START REPLICA ;')
    expect(replicaControlSql(mysql(80411), 'stop', 'io_thread')).toBe('STOP REPLICA IO_THREAD;')
    expect(replicaControlSql(maria(100406), 'START', 'SQL_THREAD')).toBe('START SLAVE SQL_THREAD;')
    expect(replicaControlSql(mysql(80411), 'reset')).toBeNull()
    expect(replicaControlSql(mysql(80411), 'start', 'BOTH')).toBeNull()
    expect(resetReplicaSql(mysql(80411))).toBe('RESET REPLICA;')
    expect(resetReplicaSql(maria(100406))).toBe('RESET SLAVE;')
  })

  it('skip counter: SQL_REPLICA_SKIP_COUNTER on MySQL 8.4 only', () => {
    expect(skipCounterSql(mysql(80400), 3)).toBe('SET GLOBAL SQL_REPLICA_SKIP_COUNTER = 3;')
    expect(skipCounterSql(mysql(80399), 1)).toBe('SET GLOBAL SQL_SLAVE_SKIP_COUNTER = 1;')
    expect(skipCounterSql(maria(110402), 0)).toBe('SET GLOBAL SQL_SLAVE_SKIP_COUNTER = 0;')
  })

  it('change primary: CHANGE REPLICATION SOURCE (MySQL 8.0.23+) or CHANGE MASTER', () => {
    const o = { user: 'u', password: "p'w", host: 'h', port: 3306, file: 'binlog.000005', position: '157' }
    expect(changePrimarySql(mysql(80023), o)).toBe(
      "CHANGE REPLICATION SOURCE TO SOURCE_HOST='h',SOURCE_PORT=3306,SOURCE_USER='u',SOURCE_PASSWORD='p\\'w',SOURCE_LOG_FILE='binlog.000005',SOURCE_LOG_POS=157;",
    )
    expect(changePrimarySql(mysql(80022), o)).toBe(
      "CHANGE MASTER TO MASTER_HOST='h',MASTER_PORT=3306,MASTER_USER='u',MASTER_PASSWORD='p\\'w',MASTER_LOG_FILE='binlog.000005',MASTER_LOG_POS=157;",
    )
    expect(changePrimarySql(maria(110402), o)).toMatch(/^CHANGE MASTER TO MASTER_HOST='h'/)
  })
})
