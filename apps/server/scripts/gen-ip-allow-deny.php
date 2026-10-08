<?php
// Generates test/unit/fixtures/ip-allow-deny.json from phpMyAdmin's own IpAllowDeny.
// Usage: php scripts/gen-ip-allow-deny.php /path/to/phpmyadmin > test/unit/fixtures/ip-allow-deny.json
declare(strict_types=1);
$pma = $argv[1] ?? '/home/user/ref/pma';
define('ROOT_PATH', $pma . '/');
require $pma . '/vendor/autoload.php';

use PhpMyAdmin\IpAllowDeny;
use PhpMyAdmin\Config;
use PhpMyAdmin\Core;

$ranges = [
  '255.255.255.0/4', '255.255.2.0/4', '255.255.0.0/8', '192.168.0.0/16', '192.168.1.0/24', '10.0.0.0/8',
  '127.0.0.1/8', '0.0.0.0/0', '192.168.5.50', '192.168.[5-6].10', '192.168.100.[50-100]', '1.2.3.4/32', '1.2.3.4/1',
  '2001:4998:c:a0d:0000:0000:4998:1020', '2001:4998:c:a0d:0000:0000:4998:[1001-2010]',
  '2001:4998:c:a0d:0000:0000:4998:3020/24', '::1', '2001:db8::/32', '2001:db8::[10-ff]', 'fe80::/10', '::ffff:1.2.3.4',
];
$ips = [
  '255.0.1.0', '10.0.0.0', '255.255.0.1', '255.124.0.5', '122.124.0.5', '192.168.1.20', '192.168.2.1', '192.168.5.10',
  '192.168.6.10', '192.168.7.10', '192.168.100.75', '192.168.100.101', '127.0.0.1', '127.5.5.5', '1.2.3.4', '1.2.3.5',
  '200.1.1.1', '2001:4998:c:a0d:0000:0000:4998:1020', '2001:4998:c:a0d:0000:0000:4998:1000', '2001:4998:c:a0d::4998:1500',
  '2001:4998:ffff::1', '::1', '2001:db8::1', '2001:db8::20', '2001:db9::1', 'fe80::1', 'febf::1', '::ffff:1.2.3.4',
];
$out = ['mask' => [], 'getIp' => []];
$ad = new IpAllowDeny();
foreach ($ranges as $r) foreach ($ips as $ip) {
  $out['mask'][] = [$r, $ip, @$ad->ipMaskTest($r, $ip)];
}
$cases = [
  ['101.0.0.25', null, null],
  ['101.0.0.25', '192.168.10.10', '101.0.0.25'],
  ['101.0.0.25', '192.168.10.1, 192.168.100.100', '101.0.0.25'],
  ['101.0.0.25', 'invalid', '101.0.0.25'],
  ['101.0.0.25', '192.168.10.10', '10.10.10.10'],
  ['101.0.0.25', '2001:db8::1', '101.0.0.25'],
  ['', null, null],
];
$config = Config::getInstance();
foreach ($cases as [$remote, $header, $proxy]) {
  $_SERVER['REMOTE_ADDR'] = $remote;
  unset($_SERVER['HTTP_X_FORWARDED_FOR']);
  $config->settings['TrustedProxies'] = [];
  if ($proxy !== null) {
    $config->settings['TrustedProxies'][$proxy] = 'HTTP_X_FORWARDED_FOR';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = $header;
  }
  $out['getIp'][] = ['remote' => $remote, 'header' => $header, 'proxy' => $proxy, 'result' => Core::getIp()];
}
$rules = ['allow % 255.255.255.0/4', 'allow % from 255.255.2.0/4', 'allow % from 2001:4998:c:a0d:0000:0000:4998:1020',
  'allow % from 2001:4998:c:a0d:0000:0000:4998:[1001-2010]', 'allow % from 2001:4998:c:a0d:0000:0000:4998:3020/24',
  'deny % 255.255.0.0/8', 'deny % from 255.255.0.0/8', 'allow bob from all', 'deny root from localhost', 'allow mary from 192.168.100.[50-100]'];
$config->settings['TrustedProxies'] = [];
$out['rules'] = $rules;
$out['allowDeny'] = [];
foreach (['pma_username', 'bob', 'root', 'mary'] as $user) foreach (array_merge($ips, ['']) as $ip) {
  $_SERVER['REMOTE_ADDR'] = $ip;
  $config->selectedServer['user'] = $user;
  $config->selectedServer['AllowDeny']['rules'] = $rules;
  $out['allowDeny'][] = ['user' => $user, 'ip' => $ip, 'allow' => $ad->allow(), 'deny' => $ad->deny()];
}
echo json_encode($out, JSON_PRETTY_PRINT), "\n";
