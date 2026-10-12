#!/bin/bash
# Init script of the dev MariaDB replica (docker/dev.compose.yml, mariadb11-replica): like
# 10-replica.sh for MariaDB — the primary's position from SHOW BINLOG STATUS, CHANGE MASTER TO
# without GTID, as bma_repl (docker/seed/02-replication-user.sql).
set -eu
src_host="${REPLICA_SOURCE_HOST:-mariadb11}"
src_port="${REPLICA_SOURCE_PORT:-3306}"
pos=''
for _ in $(seq 1 60); do
  pos=$(mariadb -h"$src_host" -P"$src_port" -ubma_repl -pbma_repl -N -e 'SHOW BINLOG STATUS' 2>/dev/null || true)
  [ -n "$pos" ] && break
  sleep 2
done
[ -n "$pos" ] || { echo "replica: cannot read the primary's binary log position" >&2; exit 1; }
file=$(printf '%s' "$pos" | cut -f1)
offset=$(printf '%s' "$pos" | cut -f2)
# executable init scripts run in their own shell: the socket of the init server
mariadb --protocol=socket -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CHANGE MASTER TO MASTER_HOST='$src_host', MASTER_PORT=$src_port, MASTER_USER='bma_repl', MASTER_PASSWORD='bma_repl', MASTER_LOG_FILE='$file', MASTER_LOG_POS=$offset, MASTER_USE_GTID=no;
SQL
