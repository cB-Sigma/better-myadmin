-- The account the dev replica (mysql84-replica, docker/seed/replica/10-replica.sh) replicates with,
-- and the one the replication parity suite enters in "Change or reconfigure primary server".
CREATE USER IF NOT EXISTS 'bma_repl'@'%' IDENTIFIED BY 'bma_repl';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'bma_repl'@'%';
