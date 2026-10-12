#!/bin/bash
# The reference phpMyAdmin for the dev replica without Docker (the compose service
# phpmyadmin-ref-replica does the same in a container): a second instance of a local reference
# checkout whose only server is the replica on :3308, with AllowArbitraryServer on (the "Change or
# reconfigure primary server" form needs it). The instance is a directory of symlinks into the
# checkout with its own config.inc.php and public/index.php (phpMyAdmin derives ROOT_PATH, and so
# the config file, from index.php's directory), so the :8081 instance and its config stay untouched.
#
#   docker/pma-ref/local-replica.sh [checkout=/home/user/ref/pma] [instance=/home/user/ref/pma-replica] [port=8083]
set -eu
ref="${1:-/home/user/ref/pma}"
dir="${2:-/home/user/ref/pma-replica}"
port="${3:-8083}"
mkdir -p "$dir/public" "$dir/tmp"
for entry in "$ref"/* "$ref"/.[!.]*; do
  name=$(basename "$entry")
  case "$name" in config.inc.php | public | tmp) continue ;; esac
  ln -sfn "$entry" "$dir/$name"
done
for entry in "$ref"/public/*; do
  name=$(basename "$entry")
  [ "$name" = index.php ] && continue
  ln -sfn "$entry" "$dir/public/$name"
done
cp "$ref/public/index.php" "$dir/public/index.php"
cat >"$dir/config.inc.php" <<PHP
<?php
declare(strict_types=1);
// Reference phpMyAdmin of the dev replica (docker/pma-ref/local-replica.sh)
\$cfg['blowfish_secret'] = 'ref-pma-replica-secret-0123456789ab';
\$cfg['Servers'][1]['host'] = '127.0.0.1';
\$cfg['Servers'][1]['port'] = '3308';
\$cfg['Servers'][1]['auth_type'] = 'cookie';
\$cfg['AllowArbitraryServer'] = true;
\$cfg['TempDir'] = '$dir/tmp';
PHP
cd "$dir"
exec php -S "127.0.0.1:$port" -t public
