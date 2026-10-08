<?php

/**
 * Data tables of @bettermyadmin/kbs, produced by EXECUTING phpMyAdmin code, so the msgids, rule
 * expressions and variable maps are byte-identical to the reference.
 *
 *   BMA_NO_MYSQL=1 php packages/kbs/scripts/generate.php
 *
 * Output (packages/kbs/src/generated/):
 *   advisor-rules.json      Rules::getGeneric() and Rules::getBeforeMySql80003() (untranslated msgids)
 *   status-variables.json   Server\Status\VariablesController::getDescriptions() + Data sections/links labels
 *   engines.json            StorageEngine subclasses: getVariables(), getVariablesLikePattern(),
 *                           getMysqlHelpPage(), getInfoPages() labels
 *   merged-ultraslim.json   is copied from vendor/williamdes/mariadb-mysql-kbs/dist (v1.3.0)
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Advisory\Rules;
use PhpMyAdmin\Controllers\Server\Status\VariablesController;
use PhpMyAdmin\Engines;
use PhpMyAdmin\StorageEngine;

$out = dirname(__DIR__) . '/src/generated';
@mkdir($out, 0777, true);

$write = static function (string $file, array $data) use ($out): void {
    $data = ['_generated' => [
        'by' => 'packages/kbs/scripts/generate.php',
        'pma' => trim((string) @shell_exec('git -C ' . escapeshellarg(ROOT_PATH) . ' rev-parse --short HEAD')),
    ]] + $data;
    file_put_contents($out . '/' . $file, bma_json($data) . "\n");
    fwrite(STDERR, 'wrote ' . $out . '/' . $file . "\n");
};

// ---------------------------------------------------------------- advisor rules
$write('advisor-rules.json', [
    'generic' => Rules::getGeneric(),
    'beforeMySql80003' => Rules::getBeforeMySql80003(),
]);

// ---------------------------------------------------------------- status variable descriptions
$controller = (new ReflectionClass(VariablesController::class))->newInstanceWithoutConstructor();
$descriptions = (new ReflectionMethod(VariablesController::class, 'getDescriptions'))->invoke($controller);
$write('status-variables.json', ['descriptions' => $descriptions]);

// ---------------------------------------------------------------- storage engines
$engines = [];
foreach (
    [
        'binlog' => Engines\Binlog::class,
        'innobase' => Engines\Innobase::class,
        'innodb' => Engines\Innodb::class,
        'memory' => Engines\Memory::class,
        'merge' => Engines\Merge::class,
        'mrg_myisam' => Engines\MrgMyisam::class,
        'myisam' => Engines\Myisam::class,
        'ndbcluster' => Engines\Ndbcluster::class,
        'pbxt' => Engines\Pbxt::class,
        'performance_schema' => Engines\PerformanceSchema::class,
    ] as $key => $class
) {
    /** @var StorageEngine $engine */
    $engine = (new ReflectionClass($class))->newInstanceWithoutConstructor();
    $engine->engine = '{engine}';
    // getInfoPages() of InnoDB depends on the support level: record the pages offered at SUPPORT_YES
    $engine->support = 2;
    $engines[$key] = [
        'variables' => (object) $engine->getVariables(),
        'like' => $engine->getVariablesLikePattern(),
        'helpPage' => $engine->getMysqlHelpPage(),
        'infoPages' => (object) $engine->getInfoPages(),
    ];
}

$write('engines.json', ['engines' => $engines]);
