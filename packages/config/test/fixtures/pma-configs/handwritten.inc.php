<?php
/**
 * Hand-written phpMyAdmin config exercising the syntax supported by
 * packages/config/src/pma-import.ts. Its PHP evaluation is stored in
 * ../pma-configs.json by scripts/dump-pma-configs.php.
 */

declare(strict_types=1);

# hash comment
$cfg['blowfish_secret'] = 'a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3'; // trailing comment

$i = 0;

/* First server: config auth */
$i++;
$cfg['Servers'][$i]['verbose'] = "Primary \"MySQL\"\tserver";
$cfg['Servers'][$i]['host'] = '127.0.0.1';
$cfg['Servers'][$i]['port'] = 3307;
$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['user'] = 'root';
$cfg['Servers'][$i]['password'] = 'it\'s a \\secret\\ \n';
$cfg['Servers'][$i]['AllowDeny'] = array(
    'order' => 'deny,allow',
    'rules' => array('deny root from all', "allow root from localhost",),
);
$cfg['Servers'][$i]['only_db'] = ['db1', 'db_%', 'test\_db'];
$cfg['Servers'][$i]['bookmarktable'] = false;
$cfg['Servers'][$i]['ssl'] = TRUE;
$cfg['Servers'][$i]['ssl_ca'] = NULL;
$cfg['Servers'][$i]['SignonCookieParams'] = ['lifetime' => 3600, 'samesite' => 'Lax', 'secure' => true];

// Second server: control user, interpolation, concatenation
$i++;
$name = 'replica';
$cfg['Servers'][$i]['host'] = $name . '.example.com';
$cfg['Servers'][$i]['verbose'] = "Server $i ({$name})";
$cfg['Servers'][$i]['controluser'] = 'pma';
$cfg['Servers'][$i]['controlpass'] = "p\x41ss\u{e9}\101";
$cfg['Servers'][$i]['pmadb'] = 'phpmyadmin';
$cfg['Servers'][$i]['MaxTableUiprefs'] = 0x20;
$cfg['Servers'][$i]['hide_db'] = '^(information_schema|performance_schema)$';

++$i;
$cfg['Servers'][$i] = [
    'host' => 'third.example.com',
    'port' => '3306',
    'compress' => true,
    'tracking_default_statements' => 'CREATE TABLE,ALTER TABLE',
];

$cfg['ServerDefault'] = 2;
$cfg['MaxRows'] = 1_000;
$cfg['ExecTimeLimit'] = 0;
$cfg['ProtectBinary'] = false;
$cfg['ShowServerInfo'] = 'database-server';
$cfg['NavigationTreeTableSeparator'] = ['__', '--'];
$cfg['AllowThirdPartyFraming'] = 'sameorigin';
$cfg['MysqlSslWarningSafeHosts'] = ['127.0.0.1', 'localhost', 'db.internal'];
$cfg['TrustedProxies'] = ['1.2.3.4' => 'HTTP_X_FORWARDED_FOR'];
$cfg['DefaultTabTable'] = 'browse';
$cfg['DefaultTabDatabase'] = 'db_sql.php';
$cfg['RecodingEngine'] = 'mb';
$cfg['TablePrimaryKeyOrder'] = 'desc';
$cfg['UserprefsDisallow'] = ['MaxRows', 'Export/format'];
$cfg['Export']['format'] = 'csv';
$cfg['Export']['csv_separator'] = ';';
$cfg['Export']['sql_max_query_size'] = 100000;
$cfg['Import']['ldi_local_option'] = false;
$cfg['Console']['Mode'] = 'collapse';
$cfg['Console']['Height'] = 120;
$cfg['DBG']['sql'] = true;
$cfg['SQLQuery']['ShowAsPHP'] = false;
$cfg['DefaultTransformations']['Substring'] = [2, 10];
$cfg['DefaultTransformations']['Hex'] = ['4'];
$cfg['DefaultTransformations']['Inline'] = [200, 150, 'wrapper_link' => 'https://img.example/', 'wrapper_params' => ['size' => 'small']];
$cfg['DefaultFunctions']['FUNC_UUID'] = 'UUID_SHORT';
$cfg['DefaultFunctions']['FUNC_JSON'] = 'JSON_OBJECT';
$cfg['MysqlMinVersion'] = ['internal' => 80000, 'human' => '8.0.0'];
$cfg['TitleDefault'] = '@HTTP_HOST@' . ' | ' . '@PHPMYADMIN@';
$cfg['FirstDayOfCalendar'] = 1;
$cfg['ZeroConf'] = false;
