#!/bin/sh
# Serves a copy of the reference phpMyAdmin WITH compiled translations, for the i18n parity test.
#
# A phpMyAdmin git checkout has no resources/locale (bin/generate-mo needs msgfmt), so it only
# offers English. This copies the checkout (without .git, node_modules and resources/po), compiles
# the .mo files a release ships with polib (scripts/build-mo.py) and starts `php -S`.
#
#   sh packages/i18n/scripts/serve-localized-pma.sh /tmp/pma-i18n 8082 [de fr ...]
#   PMA_I18N_URL=http://127.0.0.1:8082 npx vitest run --project parity
set -eu
src="${PMA_PATH:-/home/user/ref/pma}"
dest="$1"
port="$2"
shift 2
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$dest"
rm -rf "$dest/resources/locale"
tar -C "$src" --exclude ./.git --exclude ./node_modules --exclude ./resources/po -cf - . | tar -C "$dest" -xf -
python3 -I "$here/build-mo.py" "$src" "$dest/resources/locale" "$@"
cd "$dest"
exec php -S "127.0.0.1:$port" -t public
