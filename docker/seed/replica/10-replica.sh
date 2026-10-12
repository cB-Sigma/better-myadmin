#!/bin/bash
# Init script of the dev replica (docker/dev.compose.yml, mysql84-replica): replicates the dev primary
# from its binary log position at creation time (not from its first binary log), as bma_repl
# (docker/seed/02-replication-user.sql). Only the f06r_repl database is applied (--replicate-do-db),
# and --replica-skip-errors=all keeps the statements other suites run on the shared primary from
# stopping the SQL thread (a statement is parsed before the database filter applies).
set -eu
src_host="${REPLICA_SOURCE_HOST:-mysql84}"
src_port="${REPLICA_SOURCE_PORT:-3306}"
pos=''
for _ in $(seq 1 60); do
  pos=$(mysql -h"$src_host" -P"$src_port" -ubma_repl -pbma_repl --get-server-public-key -N -e 'SHOW BINARY LOG STATUS' 2>/dev/null || true)
  [ -n "$pos" ] && break
  sleep 2
done
[ -n "$pos" ] || { echo "replica: cannot read the primary's binary log position" >&2; exit 1; }
file=$(printf '%s' "$pos" | cut -f1)
offset=$(printf '%s' "$pos" | cut -f2)
# executable init scripts run in their own shell (no docker_process_sql): the socket of the init server
mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CHANGE REPLICATION SOURCE TO SOURCE_HOST='$src_host', SOURCE_PORT=$src_port, SOURCE_USER='bma_repl', SOURCE_PASSWORD='bma_repl', SOURCE_LOG_FILE='$file', SOURCE_LOG_POS=$offset, GET_SOURCE_PUBLIC_KEY=1;
SQL
