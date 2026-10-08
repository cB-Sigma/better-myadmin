# phpMyAdmin built from source at the reference commit, served by PHP's built-in server.
FROM php:8.3-cli
ARG PMA_COMMIT=e3e877e8b49ccd4600fcd22f3934e4aeb10adbd1
RUN apt-get update && apt-get install -y --no-install-recommends git unzip libzip-dev nodejs npm \
 && docker-php-ext-install mysqli zip && npm install -g yarn@1.22.22 && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /srv
RUN git clone --filter=blob:none https://github.com/phpmyadmin/phpmyadmin.git pma \
 && cd pma && git checkout "$PMA_COMMIT" \
 && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --no-interaction --prefer-source \
 && yarn install --frozen-lockfile --non-interactive
COPY config.inc.php /srv/pma/config.inc.php
WORKDIR /srv/pma
EXPOSE 8081
CMD ["php", "-S", "0.0.0.0:8081", "-t", "public"]
