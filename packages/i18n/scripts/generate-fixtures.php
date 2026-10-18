<?php

/**
 * Golden fixtures for @bettermyadmin/i18n, produced by EXECUTING phpMyAdmin code (motranslator, Util,
 * Sanitize, LanguageManager) with real .mo files.
 *
 *   python3 -I packages/i18n/scripts/build-mo.py $PMA_PATH /tmp/locale   # polib, independent of po.ts
 *   BMA_NO_MYSQL=1 BMA_LOCALE_DIR=/tmp/locale php packages/i18n/scripts/generate-fixtures.php
 *
 * Output: packages/i18n/test/fixtures/{gettext,format,bbcode,languages}.json
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Config;
use PhpMyAdmin\Current;
use PhpMyAdmin\I18n\LanguageManager;
use PhpMyAdmin\MoTranslator\Loader;
use PhpMyAdmin\MoTranslator\Translator;
use PhpMyAdmin\Sanitize;
use PhpMyAdmin\Util;

$out = dirname(__DIR__) . '/test/fixtures';
@mkdir($out, 0777, true);
$localeDir = rtrim((string) getenv('BMA_LOCALE_DIR'), '/');
if ($localeDir === '' || ! is_dir($localeDir)) {
    fwrite(STDERR, "BMA_LOCALE_DIR must point to the output of scripts/build-mo.py\n");
    exit(1);
}

$shipped = json_decode((string) shell_exec(
    'node -e ' . escapeshellarg(
        'const s=require("fs").readFileSync(process.argv[1],"utf8");'
        . 'console.log(JSON.stringify(JSON.parse(s.match(/shippedLocales[^=]*= (\\[[^\\]]*\\])/)[1])))',
    ) . ' ' . escapeshellarg(dirname(__DIR__) . '/src/generated/catalog-index.ts'),
), true, 512, JSON_THROW_ON_ERROR);

/** Activates a locale for the global __() family (LanguageManager::activate without the checks). */
function bma_activate(string $code, string $localeDir): void
{
    Current::$lang = $code;
    _setlocale(0, $code);
    _bindtextdomain('phpmyadmin', $localeDir);
    _textdomain('phpmyadmin');
    // before 8e6af1a04f, Sanitize cached its BBCode pairs (with the translated [dochelpicon]) in a
    // static per request: reset it per locale. Since then it translates on every call.
    if (property_exists(Sanitize::class, 'replacePairs')) {
        $r = new ReflectionProperty(Sanitize::class, 'replacePairs');
        $r->setValue(null, []);
    }
}

function bma_mo(string $code, string $localeDir): string
{
    return $localeDir . '/' . $code . '/LC_MESSAGES/phpmyadmin.mo';
}

// ---------------------------------------------------------------------------
// gettext: one locale per distinct Plural-Forms among shipped locales + a fixed set
// ---------------------------------------------------------------------------
$pot = file_get_contents(ROOT_PATH . 'resources/po/phpmyadmin.pot');
preg_match_all('/^(?:msgctxt "((?:[^"\\\\]|\\\\.)*)"\n)?msgid "((?:[^"\\\\]|\\\\.)*)"\n(?:msgid_plural "((?:[^"\\\\]|\\\\.)*)"\n)?/m', $pot, $m, PREG_SET_ORDER);
$unq = static fn (string $s): string => stripcslashes($s);
$singular = [];
$plurals = [];
$contexts = [];
foreach ($m as $i => $hit) {
    $id = $unq($hit[2]);
    if ($id === '') {
        continue; // header or multi-line msgid (first line empty) — sampled below from the .mo instead
    }

    if (($hit[1] ?? '') !== '') {
        $contexts[] = [$unq($hit[1]), $id];
    } elseif (($hit[3] ?? '') !== '') {
        $plurals[] = [$id, $unq($hit[3])];
    } elseif ($i % 23 === 0) {
        $singular[] = $id;
    }
}

// multi-line msgids and plurals are taken from a fully translated .mo so they are exact
$cs = new Translator(bma_mo('cs', $localeDir));
$ref = new ReflectionProperty(Translator::class, 'cache');
$cache = $ref->getValue($cs);
$all = $cache instanceof PhpMyAdmin\MoTranslator\Cache\GetAllInterface ? $cache->getAll() : [];
$plurals = [];
$multi = 0;
foreach (array_keys($all) as $key) {
    $key = (string) $key;
    if ($key === '' || str_contains($key, "\x04")) {
        continue;
    }

    if (str_contains($key, "\0")) {
        $plurals[] = explode("\0", $key, 2);
    } elseif (str_contains($key, "\n") && $multi++ < 15) {
        $singular[] = $key;
    }
}

$singular[] = 'This msgid does not exist in phpMyAdmin';
$plurals[] = ['%d missing item', '%d missing items'];
$contexts[] = ['Missing context', 'Jan'];

$forms = [];
$gettextLocales = ['de', 'fr', 'cs', 'ru', 'ar', 'ja', 'pt_BR', 'zh_CN', 'pl', 'sl', 'he', 'lv', 'ro', 'uk', 'en_GB'];
foreach ($shipped as $code) {
    $header = (new Translator(bma_mo($code, $localeDir)))->gettext('');
    $pf = Translator::extractPluralsForms($header);
    if (! isset($forms[$pf])) {
        $forms[$pf] = $code;
        if (! in_array($code, $gettextLocales, true)) {
            $gettextLocales[] = $code;
        }
    }
}

$numbers = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 19, 20, 21, 22, 25, 100, 101, 102, 103, 111, 112, 1000001];
$gettext = ['locales' => []];
foreach ($gettextLocales as $code) {
    $t = new Translator(bma_mo($code, $localeDir));
    $entry = [
        'pluralForms' => Translator::extractPluralsForms($t->gettext('')),
        'gettext' => [],
        'ngettext' => [],
        'pgettext' => [],
    ];
    foreach ($singular as $id) {
        $entry['gettext'][] = [$id, $t->gettext($id)];
    }

    foreach ($plurals as [$one, $many]) {
        $row = [$one, $many, []];
        foreach ($numbers as $n) {
            $row[2][] = $t->ngettext($one, $many, $n);
        }

        $entry['ngettext'][] = $row;
    }

    foreach ($contexts as [$ctx, $id]) {
        $entry['pgettext'][] = [$ctx, $id, $t->pgettext($ctx, $id)];
    }

    $gettext['locales'][$code] = $entry;
}

$gettext['numbers'] = $numbers;

// whole-catalogue digest per shipped locale: every key and translation of the .mo (header excluded)
$gettext['digests'] = [];
foreach ($shipped as $code) {
    $all = $ref->getValue(new Translator(bma_mo($code, $localeDir)))->getAll();
    unset($all['']);
    $lines = [];
    foreach ($all as $k => $v) {
        $lines[] = $k . "\x01" . $v;
    }

    sort($lines, SORT_STRING);
    $gettext['digests'][$code] = [count($lines), md5(implode("\x02", $lines))];
}
bma_write_fixture($out . '/gettext.json', $gettext);

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------
$formatLocales = ['en', 'de', 'fr', 'cs', 'ru', 'ar', 'ja', 'pt_BR', 'zh_CN', 'sv', 'it', 'pl', 'he'];
$numberValues = [
    0, 1, -1, 0.5, 0.004, 0.0004, 12, 123, 1234, 12345, 123456, 1234567, 1e9, 1.5e12, 9.99e14, -123456.789,
    0.1, 1023.5, 1000, 999.9999, 3.14159, 0.000001234, 0.285, 1.005, 2.675, 5.015, 1e-12, 1e30, '1234.5',
    '12abc', '0.0001', 42.0, -0.001,
];
$numberParams = [
    [3, 0, false, true], [0, 0, false, true], [0, 2, false, true], [3, 1, false, true], [5, 2, true, false],
    [2, 3, false, true], [6, 1, false, true], [1, 0, false, true], [4, 2, false, false], [0, 4, false, true],
    [5, 0, true, false], [3, 2, true, true],
];
$byteValues = [
    0, 1, 10, 1000, 1023, 1024, 1025, 999999, 1000000, 1048576, 123456789, 1e10, 5e12, 1e18, 2.5e20, '4096',
    null, 1536, 10485760, 99999999999,
];
$byteParams = [[6, 0], [3, 1], [4, 0], [6, 2], [1, 1], [2, 0]];
$spans = [0, 1, 59, 60, 61, 3599, 3600, 3661, 86399, 86400, 90061, 1234567, 99999999];
$timestamps = [0, 1700000000, 951782400, 1735689599, 1234567890, 1720043200, 1609459200, 946684800, 1293840000];
$dateFormats = [
    '',
    '%a %A %b %B %p %P',
    '%Y-%m-%d %H:%M:%S',
    '%e %j %u %w %U %W %V %G %g %C %y %D %F %R %T %r %x %X %c',
    '%I %l %k %s %% %h',
    '%B %d, %Y at %I:%M %p',
];
$uploads = [2097152, 524288, 8388608, 1073741824, 100, 1048575, 134217728, '2097152', 0];

$format = ['locales' => []];
foreach ($formatLocales as $code) {
    bma_activate($code, $localeDir);
    $row = ['formatNumber' => [], 'formatByteDown' => [], 'timespanFormat' => [], 'localisedDate' => [], 'upload' => []];
    foreach ($numberValues as $v) {
        foreach ($numberParams as $p) {
            $row['formatNumber'][] = [$v, $p, Util::formatNumber($v, ...$p)];
        }
    }

    foreach ($byteValues as $v) {
        foreach ($byteParams as $p) {
            $row['formatByteDown'][] = [$v, $p, Util::formatByteDown($v, ...$p)];
        }
    }

    foreach ($spans as $s) {
        $row['timespanFormat'][] = [$s, Util::timespanFormat($s)];
    }

    foreach ($timestamps as $ts) {
        foreach ($dateFormats as $f) {
            $row['localisedDate'][] = [$ts, $f, Util::localisedDate(new DateTimeImmutable('@' . $ts), $f)];
        }
    }

    foreach ($uploads as $u) {
        $row['upload'][] = [$u, Util::getFormattedMaximumUploadSize($u)];
    }

    $format['locales'][$code] = $row;
}

// PHP runtime pieces the helpers rely on
$runtime = ['round' => [], 'number_format' => [], 'sprintf' => []];
mt_srand(20261008);
$roundValues = [0.285, 1.005, 2.675, 5.015, 1.955, 0.125, 2.5, -2.5, 1e15 + 0.3, 123456.789, -0.0049, 0.5, 1.45];
for ($i = 0; $i < 300; $i++) {
    $roundValues[] = round(mt_rand(0, 10 ** 7) / 10 ** mt_rand(0, 7), 7) * (mt_rand(0, 4) === 0 ? -1 : 1);
}

foreach ($roundValues as $v) {
    foreach ([0, 1, 2, 3, 4] as $places) {
        $runtime['round'][] = [$v, $places, round($v, $places)];
        $runtime['number_format'][] = [$v, $places, number_format($v, $places, '.', ',')];
    }
}

$sprintfCases = [
    ['%s', ['abc']], ['%1s', [123]], ['%2s', [1]], ['%2s', [123]], ['%d', ['12abc']], ['%01.4f', [0.00005]],
    ['%01.4f', [1.23456]], ['%01.4f', [0.000049999]], ['%.2f', [0.125]], ['%.2f', [0.375]], ['%.0f', [2.5]],
    ['%5.1f', [-3.14159]], ['%-5s|', ['ab']], ['%05d', [-42]], ['%+d', [7]], ["%'*8s", ['x']], ['%u', [-1]],
    ['%x %X %o %b', [255, 255, 8, 5]], ['%2$s %1$s', ['a', 'b']], ['%1$d row deleted.', [5]], ['100%%', []],
    ['%s', [1.0]], ['%s', [0.1 + 0.2]], ['%s', [1e20]], ['%s', [1.5e-7]], ['%s', [123456789012345678.0]],
    ['%e', [12345.678]], ['%.3e', [0.00012345]], ['%c', [65]], ['%10.4f|', [3.14159265]], ['%-10d|', [42]],
    ['%s', [true]], ['%s', [false]], ['%d', [3.99]], ['%d', [-3.99]], ['%.1s', ['abc']], ['%f', [1.5]],
];
foreach ($sprintfCases as [$f, $args]) {
    $runtime['sprintf'][] = [$f, $args, sprintf($f, ...$args)];
}

$format['runtime'] = $runtime;
bma_write_fixture($out . '/format.json', $format);

// ---------------------------------------------------------------------------
// BBCode in messages (Sanitize::convertBBCode)
// ---------------------------------------------------------------------------
$bbMessages = [
    'Plain text',
    'Line one[br]Line two',
    '[em]emphasis[/em] [strong]bold[/strong] [code]x = 1[/code] [kbd]Ctrl[/kbd] [sup]2[/sup]',
    'See [doc@faq1-2]FAQ 1.2[/doc].',
    'See [doc@cfg_MaxExactCount]documentation[/doc]',
    'Guess [doc@setup_script]setup[/doc]',
    '[doc@config@cfg_Servers_host]host[/doc]',
    '[doc@page@]empty anchor[/doc]',
    '[a@https://www.phpmyadmin.net/translate/@_blank]contributing[/a]',
    '[a@https://example.com/?a=1&b=2]link[/a]',
    '[a@./index.php?route=/server/sql]internal[/a]',
    '[a@http://insecure.example.com/]http[/a]',
    '[a@javascript:alert(1)]bad[/a]',
    '[a@https://example.com/@bad-target]target[/a]',
    '[a@https://example.com/@0]zero target[/a]',
    '[a@./docs/html/index.html@documentation]docs[/a]',
    '<b>html</b> & "quotes" \'single\'',
    '[dochelpicon]',
    'Unknown [foo]tag[/foo] [doc@bad page]x[/doc]',
    'You are using an incomplete translation, please help to make it better by [a@https://www.phpmyadmin.net/translate/@_blank]contributing[/a].',
];
$bb = ['locales' => []];
foreach (['en', 'de', 'fr'] as $code) {
    bma_activate($code, $localeDir);
    $rows = [];
    foreach ($bbMessages as $msg) {
        $rows[] = [$msg, Sanitize::convertBBCode($msg), Sanitize::convertBBCode($msg, true)];
    }

    $bb['locales'][$code] = $rows;
}

bma_write_fixture($out . '/bbcode.json', $bb);

// ---------------------------------------------------------------------------
// LanguageManager: language list and selectLanguage()
// ---------------------------------------------------------------------------
/** @param array<string,mixed> $cfg */
function bma_lm(array $shipped, array $cfg): LanguageManager
{
    Config::$instance = null;
    $config = Config::getInstance();
    foreach ($cfg as $k => $v) {
        $config->set($k, $v);
    }

    $lm = new LanguageManager($config);
    // listLocaleDir() reads LOCALE_PATH; feed it the shipped list instead (same order: en first)
    $locales = ['en', ...$shipped];
    $filter = $config->config->FilterLanguages;
    if ($filter !== '') {
        $f = preg_grep('@' . $filter . '@', $locales);
        $locales = $f !== false ? $f : $locales;
    }

    (new ReflectionProperty(LanguageManager::class, 'availableLocales'))->setValue($lm, $locales);

    return $lm;
}

$lm = bma_lm($shipped, []);
$languages = ['sorted' => [], 'selection' => []];
foreach ($lm->sortedLanguages() as $key => $lang) {
    $languages['sorted'][] = [
        // templates print getName()|raw, so the browser shows the entities decoded
        $key, $lang->getCode(), html_entity_decode($lang->getName(), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        $lang->getEnglishName(), html_entity_decode($lang->getNativeName(), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        $lang->getMySQLLocale(), $lang->isRTL(),
    ];
}

$selectionCases = [
    ['name' => 'nothing → DefaultLang en'],
    ['name' => 'Lang forced', 'cfg' => ['Lang' => 'de'], 'get' => 'fr', 'accept' => 'ja'],
    ['name' => 'Lang forced, unsupported → falls through', 'cfg' => ['Lang' => 'xx'], 'get' => 'fr'],
    ['name' => 'POST beats GET', 'post' => 'cs', 'get' => 'fr'],
    ['name' => 'GET beats cookie', 'get' => 'fr', 'cookie' => 'de'],
    ['name' => 'GET uppercase', 'get' => 'PT_BR'],
    ['name' => 'GET unsupported, cookie used', 'get' => 'xx', 'cookie' => 'de'],
    ['name' => 'cookie beats Accept-Language', 'cookie' => 'de', 'accept' => 'fr'],
    ['name' => 'cookie unsupported', 'cookie' => 'af', 'accept' => 'fr'],
    ['name' => 'Accept-Language simple', 'accept' => 'de'],
    ['name' => 'Accept-Language region', 'accept' => 'de-AT'],
    ['name' => 'Accept-Language list (no spaces)', 'accept' => 'xx,fr;q=0.8,de;q=0.5'],
    ['name' => 'Accept-Language list with spaces', 'accept' => 'xx, fr;q=0.8'],
    ['name' => 'Accept-Language q value', 'accept' => 'ja;q=0.9'],
    ['name' => 'Accept-Language pt-br', 'accept' => 'pt-BR,pt;q=0.9'],
    ['name' => 'Accept-Language pt', 'accept' => 'pt'],
    ['name' => 'Accept-Language zh-TW', 'accept' => 'zh-TW'],
    ['name' => 'Accept-Language zh-HK', 'accept' => 'zh-hk'],
    ['name' => 'Accept-Language zh-SG', 'accept' => 'zh-SG'],
    ['name' => 'Accept-Language en-GB', 'accept' => 'en-GB'],
    ['name' => 'Accept-Language en-US', 'accept' => 'en-US,en;q=0.9'],
    ['name' => 'Accept-Language ar-LY (not shipped) → ar', 'accept' => 'ar-LY,ar'],
    ['name' => 'Accept-Language sr-Latn', 'accept' => 'sr-Latn'],
    ['name' => 'Accept-Language by name', 'accept' => 'german'],
    ['name' => 'Accept-Language wildcard', 'accept' => '*'],
    ['name' => 'User-Agent', 'ua' => 'Mozilla/5.0 (X11; U; Linux i686; de; rv:1.9) Gecko'],
    ['name' => 'User-Agent with brackets', 'ua' => 'Opera/9.80 [fr] Presto'],
    ['name' => 'Accept-Language before User-Agent', 'accept' => 'cs', 'ua' => 'Mozilla/5.0 (de)'],
    ['name' => 'DefaultLang', 'cfg' => ['DefaultLang' => 'fr']],
    ['name' => 'DefaultLang unsupported', 'cfg' => ['DefaultLang' => 'xx']],
    ['name' => 'FilterLanguages', 'cfg' => ['FilterLanguages' => '^(de|fr|en)$'], 'accept' => 'cs,fr'],
    ['name' => 'FilterLanguages excludes cookie', 'cfg' => ['FilterLanguages' => '^(de|en)'], 'cookie' => 'fr'],
    ['name' => 'FilterLanguages invalid regex', 'cfg' => ['FilterLanguages' => '(de'], 'accept' => 'fr'],
];
foreach ($selectionCases as $c) {
    $_POST = isset($c['post']) ? ['lang' => $c['post']] : [];
    $_GET = isset($c['get']) ? ['lang' => $c['get']] : [];
    $_COOKIE = isset($c['cookie']) ? ['pma_lang' => $c['cookie']] : [];
    $_SERVER['HTTP_ACCEPT_LANGUAGE'] = $c['accept'] ?? '';
    $_SERVER['HTTP_USER_AGENT'] = $c['ua'] ?? '';
    $lm = @bma_lm($shipped, $c['cfg'] ?? []);
    $lang = $lm->selectLanguage();
    $warning = false;
    try {
        $lm->showWarnings();
    } catch (Throwable) {
        $warning = true;
    }

    $languages['selection'][] = $c + [
        'expected' => $lang->getCode(),
        'warning' => $warning,
        'available' => array_keys($lm->availableLanguages()),
        'hasChoice' => $lm->hasChoice(),
    ];
}

unset($_SERVER['HTTP_ACCEPT_LANGUAGE'], $_SERVER['HTTP_USER_AGENT']);
bma_write_fixture($out . '/languages.json', $languages);
