ARG PHP_VERSION=8.4
FROM php:${PHP_VERSION}-apache
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libcurl4-openssl-dev libxml2-dev \
    && docker-php-ext-install -j2 pdo_mysql curl dom \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY apache.conf /etc/apache2/sites-available/000-default.conf
COPY php.ini /usr/local/etc/php/conf.d/mind-assistant.ini
WORKDIR /var/www/mind-assistant
