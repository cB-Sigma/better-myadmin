#!/bin/bash
# A second instance of a local reference checkout for another dev server, without Docker for
# phpMyAdmin (the compose services phpmyadmin-ref-replica / phpmyadmin-ref-mariadb do the same in a
# container). The instance is a directory of symlinks into the checkout with its own
# config.inc.php and public/index.php (phpMyAdmin derives ROOT_PATH, and so the config file, from
# index.php's directory), so the :8081 instance and its config stay untouched.
#
#   docker/pma-ref/local-instance.sh <instance dir> <http port> <mysql port> [pmadb|replica] [checkout]
#
#   pmadb    configuration storage `phpmyadmin` with control user pma/pmapass (docker/seed/pmadb.sql)
#   replica  no configuration storage, AllowArbitraryServer on ("Change or reconfigure primary server")
set -eu
dir="$1"
port="$2"
dbport="$3"
mode="${4:-pmadb}"
ref="${5:-/home/user/ref/pma}"
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
if [ "$mode" = replica ]; then
  extra="\$cfg['AllowArbitraryServer'] = true;"
else
  extra="\$cfg['Servers'][1]['controluser'] = 'pma';
\$cfg['Servers'][1]['controlpass'] = 'pmapass';
\$cfg['Servers'][1]['pmadb'] = 'phpmyadmin';"
fi
cat >"$dir/config.inc.php" <<PHP
<?php
declare(strict_types=1);
// Reference phpMyAdmin of the dev server on :$dbport (docker/pma-ref/local-instance.sh)
\$cfg['blowfish_secret'] = 'ref-pma-$port-secret-0123456789abcdef';
\$cfg['Servers'][1]['host'] = '127.0.0.1';
\$cfg['Servers'][1]['port'] = '$dbport';
\$cfg['Servers'][1]['auth_type'] = 'cookie';
$extra
\$cfg['TempDir'] = '$dir/tmp';
PHP
cd "$dir"
exec php -S "127.0.0.1:$port" -t public
