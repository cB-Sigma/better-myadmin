# phpMyAdmin built from source at the reference commit, served by PHP's built-in server.
FROM php:8.3-cli
# the reference commit (docs/reference/reference-commit.txt); docker/dev.compose.yml passes it so
# the two stay together. Bump both when the pin moves (docs/architecture/15-upstream-sync.md).
ARG PMA_COMMIT=ef2fcd20e23b2fbe24844388a45c4d35f2c17309
# 1 = compile the translations like a release (bin/generate-mo + bin/remove-incomplete-mo);
# a plain checkout has no resources/locale and is English-only
ARG PMA_TRANSLATIONS=0
# locales guaranteed to be offered: an empty catalog resources/locale/<code>/LC_MESSAGES/phpmyadmin.mo
# for each code the build did not compile (texts stay English, Current::$lang is the code), e.g. "ja"
# for the Kanji conversion of tests/parity/export-kanji.parity.test.ts (Encoding::canConvertKanji)
ARG PMA_LOCALE_STUBS=""
# phpMyAdmin's yarn build needs Node >= 22 (Debian's nodejs is 20): install Node 22 from NodeSource
RUN apt-get update && apt-get install -y --no-install-recommends git unzip libzip-dev gettext ca-certificates curl \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && docker-php-ext-install mysqli zip && npm install -g yarn@1.22.22 && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /srv
RUN git clone --filter=blob:none https://github.com/phpmyadmin/phpmyadmin.git pma \
 && cd pma && git checkout "$PMA_COMMIT" \
 && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --no-interaction --prefer-source \
 && yarn install --frozen-lockfile --non-interactive \
 && if [ "$PMA_TRANSLATIONS" = 1 ]; then ./bin/generate-mo --quiet && ./bin/remove-incomplete-mo; fi \
 && for l in $PMA_LOCALE_STUBS; do [ -e "resources/locale/$l" ] \
      || { mkdir -p "resources/locale/$l/LC_MESSAGES" && : > "resources/locale/$l/LC_MESSAGES/phpmyadmin.mo"; }; done
COPY config.inc.php /srv/pma/config.inc.php
WORKDIR /srv/pma
EXPOSE 8081
CMD ["php", "-S", "0.0.0.0:8081", "-t", "public"]
