<?php
declare(strict_types=1);
// Reference phpMyAdmin for the parity harness (never expose this container).
$cfg['blowfish_secret'] = 'ref-pma-secret-ref-pma-secret-0123';
$i = 1;
$cfg['Servers'][$i]['host'] = getenv('PMA_HOST') ?: '127.0.0.1';
$cfg['Servers'][$i]['port'] = getenv('PMA_PORT') ?: '3306';
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['TempDir'] = sys_get_temp_dir();
// configuration storage, created by docker/seed/pmadb.sql (same tables as resources/sql/create_tables.sql)
$cfg['Servers'][$i]['controluser'] = getenv('PMA_CONTROLUSER') ?: 'pma';
$cfg['Servers'][$i]['controlpass'] = getenv('PMA_CONTROLPASS') ?: 'pmapass';
$cfg['Servers'][$i]['pmadb'] = 'phpmyadmin';
