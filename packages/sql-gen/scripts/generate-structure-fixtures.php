<?php

/**
 * Golden fixtures for the Structure-page builders of @bettermyadmin/sql-gen, produced by EXECUTING
 * phpMyAdmin: Query\Generator (add index / primary / rename / partition maintenance),
 * Table\Indexes::getSqlQueryForIndexCreateOrEdit / getSqlQueryForRename (Index built from the
 * posted `index[...]` array or from SHOW INDEXES rows), Index::findDuplicates,
 * MoveColumnsController::generateAlterTableSql (SHOW CREATE TABLE of live tables),
 * SaveController::columnNeedsAlterTable, CreateAddField::getPartitionsDefinition.
 *
 *   php packages/sql-gen/scripts/generate-structure-fixtures.php
 *
 * Needs the reference checkout (PMA_PATH) and a MySQL server (BMA_MYSQL_*) for the CREATE TABLE
 * statements of the move-columns cases; it creates and drops the database `m2tbl_fixtures`.
 */

declare(strict_types=1);

require dirname(__DIR__, 2) . '/mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Controllers\Table\Structure\MoveColumnsController;
use PhpMyAdmin\Controllers\Table\Structure\SaveController;
use PhpMyAdmin\CreateAddField;
use PhpMyAdmin\Indexes\Index;
use PhpMyAdmin\Message;
use PhpMyAdmin\Query\Generator;
use PhpMyAdmin\SqlParser\Context;
use PhpMyAdmin\Table\Indexes;
use PhpMyAdmin\Util;

$out = dirname(__DIR__) . '/test/fixtures';

$names = ['a', 'my col', 'we`ird', '1', 'é'];

// ---------------------------------------------------------------------------
// Generator: row actions and bulk index buttons
// ---------------------------------------------------------------------------
$addIndex = [];
foreach (['INDEX', 'UNIQUE', 'SPATIAL', 'FULLTEXT'] as $type) {
    foreach ([['a'], ['a', 'my col'], ['we`ird', '1', 'é']] as $cols) {
        foreach (['t', 'my`table'] as $table) {
            $addIndex[] = ['type' => $type, 'table' => $table, 'columns' => $cols, 'sql' => Generator::getAddIndexSql($type, $table, $cols)];
        }
    }
}

$addPrimary = [];
foreach (['t', 'my`table'] as $table) {
    foreach ($names as $col) {
        foreach ([false, true] as $has) {
            $addPrimary[] = ['table' => $table, 'column' => $col, 'hasPrimary' => $has, 'sql' => Generator::getAddPrimaryKeyStatement($table, $col, $has)];
        }
    }
}

$partitionOps = [];
foreach (['ANALYZE', 'CHECK', 'OPTIMIZE', 'REBUILD', 'REPAIR', 'TRUNCATE', 'DROP', 'COALESCE'] as $op) {
    foreach ([['p0'], ['p0', 'p1', 'p2']] as $parts) {
        $partitionOps[] = ['table' => 'my`t', 'operation' => $op, 'partitions' => $parts, 'sql' => Generator::getQueryForPartitioningTable('my`t', $op, $parts)];
    }
}

$rename = [];
foreach ([['mysql', 50612], ['mysql', 50700], ['mysql', 80400], ['mariadb', 100501], ['mariadb', 100502]] as $server) {
    foreach ([['idx', 'idx2'], ['PRIMARY', ''], ['PRIMARY', 'PRIMARY'], ['PRIMARY', 'pk'], ['idx', 'PRIMARY'], ['we`ird', 'é']] as [$old, $new]) {
        $dbi = bma_dbi($server[0], $server[1]);
        $dbi->getCache()->cacheTableData('db', ['t' => ['ENGINE' => 'InnoDB', 'TABLE_TYPE' => 'BASE TABLE']]);
        $index = new Index([
            'Key_name' => $old,
            'Index_type' => 'BTREE',
            'Non_unique' => $old === 'PRIMARY' ? '0' : '1',
            'Index_comment' => 'c',
        ]);
        $index->addColumn(['Column_name' => 'a', 'Seq_in_index' => '1', 'Collation' => 'A', 'Sub_part' => null]);
        $index->addColumn(['Column_name' => 'b', 'Seq_in_index' => '2', 'Collation' => 'D', 'Sub_part' => '5']);
        $index->setName($new);
        $indexes = new Indexes($dbi);
        $sql = $indexes->getSqlQueryForRename($old, $index, 'db', 't');
        $error = $indexes->getError();
        $rename[] = [
            'server' => ['vendor' => $server[0], 'version' => $server[1]],
            'old' => $old,
            'new' => $new,
            'sql' => $sql,
            'error' => $error instanceof Message ? $error->getMessage() : null,
        ];
    }
}

// ---------------------------------------------------------------------------
// Indexes::getSqlQueryForIndexCreateOrEdit with the posted index[...] array
// ---------------------------------------------------------------------------
$indexCases = [];
$columnSets = [
    'single' => ['names' => ['a'], 'sub_parts' => [''], 'collations' => ['']],
    'composite' => ['names' => ['a', 'my col', 'we`ird'], 'sub_parts' => ['10', '', '0'], 'collations' => ['A', 'D', '']],
    'ignored rows' => ['names' => ['', 'a', ''], 'sub_parts' => ['5', '7', ''], 'collations' => ['D', '', 'A']],
    'all ignored' => ['names' => ['', ''], 'sub_parts' => ['', ''], 'collations' => ['', '']],
    'duplicate name' => ['names' => ['a', 'b', 'a'], 'sub_parts' => ['1', '2', '3'], 'collations' => ['A', '', 'D']],
    'odd sizes' => ['names' => ['a', 'b', '1'], 'sub_parts' => ['abc', ' 12 ', '-3'], 'collations' => ['X', '0', 'A']],
    'no collations key' => ['names' => ['a', 'b'], 'sub_parts' => ['4']],
];
$k = 0;
foreach (['PRIMARY', 'INDEX', 'UNIQUE', 'SPATIAL', 'FULLTEXT'] as $choice) {
    foreach (['', 'PRIMARY', 'idx_a', 'we`ird name'] as $name) {
        foreach ($columnSets as $label => $columns) {
            $k++;
            $types = ['', 'BTREE', 'HASH', 'RTREE'];
            $kbss = ['', '0', '8', '16abc', 'x'];
            $parsers = ['', 'ngram'];
            $comments = ['', "it's \"quoted\""];
            $olds = [null, 'PRIMARY', 'old`idx'];
            $post = [
                'Key_name' => $name,
                'Index_choice' => $choice,
                'Key_block_size' => $kbss[$k % count($kbss)],
                'Index_type' => $types[$k % count($types)],
                'Parser' => $parsers[$k % 2],
                'Index_comment' => $comments[($k >> 1) % 2],
                'columns' => $columns,
            ];
            $old = $olds[$k % 3];
            $tokudb = $k % 7 === 0;
            $dbi = bma_dbi('mysql', 80400);
            $dbi->getCache()->cacheTableData('d`b', ['t`x' => ['ENGINE' => $tokudb ? 'TokuDB' : 'InnoDB', 'TABLE_TYPE' => 'BASE TABLE']]);
            $indexes = new Indexes($dbi);
            $sql = $indexes->getSqlQueryForIndexCreateOrEdit($old, new Index($post), 'd`b', 't`x');
            $error = $indexes->getError();
            $indexCases[] = [
                'label' => "$choice/$name/$label",
                'post' => $post,
                'old' => $old,
                'tokudb' => $tokudb,
                'sql' => $sql,
                'error' => $error instanceof Message ? $error->getMessage() : null,
            ];
        }
    }
}

// The index as the edit form re-posts it: built from SHOW INDEXES rows (Index::getFromTable)
$showIndexes = [
    'pk + composite + fulltext' => [
        ['Key_name' => 'PRIMARY', 'Non_unique' => '0', 'Seq_in_index' => '1', 'Column_name' => 'id', 'Collation' => 'A', 'Cardinality' => '3', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => ''],
        ['Key_name' => 'name_idx', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'name', 'Collation' => 'A', 'Cardinality' => '3', 'Sub_part' => '10', 'Packed' => null, 'Null' => 'YES', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => 'my idx'],
        ['Key_name' => 'name_idx', 'Non_unique' => '1', 'Seq_in_index' => '2', 'Column_name' => 'qty', 'Collation' => 'D', 'Cardinality' => '2', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => 'my idx'],
        ['Key_name' => 'ft', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'name', 'Collation' => null, 'Cardinality' => '3', 'Sub_part' => null, 'Packed' => null, 'Null' => 'YES', 'Index_type' => 'FULLTEXT', 'Comment' => '', 'Index_comment' => ''],
        ['Key_name' => 'uq', 'Non_unique' => '0', 'Seq_in_index' => '1', 'Column_name' => 'code', 'Collation' => 'A', 'Cardinality' => '3', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'HASH', 'Comment' => 'disabled', 'Index_comment' => ''],
        ['Key_name' => 'dup', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'qty', 'Collation' => 'A', 'Cardinality' => '2', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => ''],
        ['Key_name' => 'dup2', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'qty', 'Collation' => 'A', 'Cardinality' => '2', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => 'different comment, same data'],
        ['Key_name' => 'sp', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'g', 'Collation' => 'A', 'Cardinality' => '0', 'Sub_part' => '32', 'Packed' => null, 'Null' => '', 'Index_type' => 'SPATIAL', 'Comment' => '', 'Index_comment' => ''],
        ['Key_name' => 'fn', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => null, 'Collation' => 'A', 'Cardinality' => '3', 'Sub_part' => null, 'Packed' => null, 'Null' => 'YES', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => '', 'Expression' => '(`qty` * 2)'],
        ['Key_name' => '1', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => '7', 'Collation' => 'A', 'Cardinality' => '3', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => ''],
    ],
    'no duplicates' => [
        ['Key_name' => 'a', 'Non_unique' => '1', 'Seq_in_index' => '1', 'Column_name' => 'x', 'Collation' => 'A', 'Cardinality' => '0', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => ''],
        ['Key_name' => 'b', 'Non_unique' => '0', 'Seq_in_index' => '1', 'Column_name' => 'x', 'Collation' => 'A', 'Cardinality' => '0', 'Sub_part' => null, 'Packed' => null, 'Null' => '', 'Index_type' => 'BTREE', 'Comment' => '', 'Index_comment' => ''],
    ],
];
$fromShowIndexes = [];
foreach ($showIndexes as $label => $rows) {
    // fresh registry: Index::loadIndexes caches per schema/table
    $table = 'tbl' . count($fromShowIndexes);
    $dbi = bma_dbi('mysql', 80400, $ext);
    $ext->addResult('SHOW INDEXES FROM `db`.`' . $table . '`', array_map('array_values', array_map(static fn ($r) => $r + ['Expression' => null], $rows)), array_keys($rows[0] + ['Expression' => null]));
    $dbi->getCache()->cacheTableData('db', [$table => ['ENGINE' => 'InnoDB', 'TABLE_TYPE' => 'BASE TABLE']]);
    $list = Index::getFromTable($dbi, $table, 'db');
    $indexes = [];
    foreach ($list as $index) {
        $columns = [];
        foreach ($index->getColumns() as $key => $col) {
            $columns[] = [
                'key' => (string) $key,
                'name' => $col->getName(),
                'seqInIndex' => $col->getSeqInIndex(),
                'collation' => $col->getCollation(),
                'cardinality' => $col->getCardinality(),
                'subPart' => $col->getSubPart(),
                'null' => $col->getCompareData()['Null'],
                'expression' => $col->getExpression(),
            ];
        }

        // the edit form re-posts the same index: names, sizes and collations as rendered (index_form.twig)
        $posted = [
            'Key_name' => $index->getName(),
            'Index_choice' => $index->getChoice(),
            'Key_block_size' => (string) $index->getKeyBlockSize(),
            'Index_type' => $index->getType(),
            'Parser' => $index->getParser(),
            'Index_comment' => $index->getComment(),
            'columns' => [
                'names' => array_map(static fn ($c) => $c->getName(), array_values($index->getColumns())),
                'sub_parts' => array_map(static fn ($c) => $index->getChoice() !== 'SPATIAL' ? (string) $c->getSubPart() : '', array_values($index->getColumns())),
                'collations' => array_map(static fn ($c) => (string) $c->getCollation(), array_values($index->getColumns())),
            ],
        ];
        $editIndexes = new Indexes($dbi);
        $editSql = $editIndexes->getSqlQueryForIndexCreateOrEdit($index->getName(), new Index($posted), 'db', $table);
        $indexes[] = [
            'name' => $index->getName(),
            'type' => $index->getType(),
            'choice' => $index->getChoice(),
            'nonUnique' => $index->getNonUnique(),
            'packed' => $index->getPacked(),
            'remarks' => $index->getRemarks(),
            'comment' => $index->getComment(),
            'columns' => $columns,
            'editSql' => $editSql,
        ];
    }

    $duplicates = [];
    $html = Index::findDuplicates($table, 'db');
    preg_match_all('/The indexes (.+?) and (.+?) seem to be equal/', strip_tags($html), $m, PREG_SET_ORDER);
    foreach ($m as $match) {
        $duplicates[] = [html_entity_decode($match[1]), html_entity_decode($match[2])];
    }

    $tableObj = $dbi->getTable('db', $table);
    $fromShowIndexes[] = [
        'label' => $label,
        'rows' => $rows,
        'indexes' => $indexes,
        'duplicates' => $duplicates,
        'columnsWithPrimaryOrUnique' => $tableObj->getColumnsWithIndex(Index::PRIMARY | Index::UNIQUE),
        'columnsWithAnyIndex' => $tableObj->getColumnsWithIndex(Index::PRIMARY | Index::UNIQUE | Index::INDEX | Index::SPATIAL | Index::FULLTEXT),
    ];
}

// ---------------------------------------------------------------------------
// MoveColumnsController::generateAlterTableSql on live SHOW CREATE TABLE output
// ---------------------------------------------------------------------------
$moveCases = [];
$m = $GLOBALS['bma_mysqli'];
if (! $m instanceof mysqli) {
    throw new RuntimeException('the move-columns fixtures need a MySQL server');
}

$m->query('DROP DATABASE IF EXISTS m2tbl_fixtures');
$m->query('CREATE DATABASE m2tbl_fixtures');
$m->select_db('m2tbl_fixtures');
$tables = [
    'simple' => 'CREATE TABLE simple (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL DEFAULT \'x\', qty INT, note TEXT)',
    'rich' => "CREATE TABLE rich (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        `my col` VARCHAR(50) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL COMMENT 'it''s',
        created TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        price DECIMAL(10,2) NOT NULL DEFAULT '0.00',
        kind ENUM('a','b''c','d,e') NOT NULL DEFAULT 'a',
        flags SET('x','y') DEFAULT NULL,
        doubled DECIMAL(12,2) GENERATED ALWAYS AS ((`price` * 2)) VIRTUAL,
        stored_name VARCHAR(60) AS (CONCAT(`my col`, '!')) STORED,
        bits BIT(4) DEFAULT b'0101',
        doc JSON,
        geo POINT NOT NULL SRID 0,
        `we``ird` CHAR(3) BINARY,
        PRIMARY KEY (id),
        UNIQUE KEY uq (price, kind),
        KEY k (`my col`(10)),
        SPATIAL KEY sp (geo),
        CONSTRAINT chk CHECK (price >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='table comment'",
];
foreach ($tables as $sql) {
    if (! $m->query($sql)) {
        throw new RuntimeException($m->error);
    }
}

$controller = (new ReflectionClass(MoveColumnsController::class))->newInstanceWithoutConstructor();
$generate = new ReflectionMethod(MoveColumnsController::class, 'generateAlterTableSql');
Context::load('MySql80400');
foreach (array_keys($tables) as $table) {
    $create = $m->query('SHOW CREATE TABLE `' . $table . '`')->fetch_row()[1];
    $cols = array_column($m->query('SHOW COLUMNS FROM `' . $table . '`')->fetch_all(MYSQLI_ASSOC), 'Field');
    $orders = [
        $cols,
        array_reverse($cols),
        array_merge(array_slice($cols, 1), [$cols[0]]),
        array_merge([end($cols)], array_slice($cols, 0, -1)),
        array_slice($cols, 1),
        array_merge($cols, ['missing']),
        array_merge(array_slice($cols, 0, -1), ['missing']),
    ];
    // a deterministic shuffle
    $shuffled = $cols;
    usort($shuffled, static fn ($a, $b) => strcmp(md5($a), md5($b)));
    $orders[] = $shuffled;
    foreach ($orders as $order) {
        $result = $generate->invoke($controller, $create, $order);
        $moveCases[] = [
            'table' => $table,
            'create' => $create,
            'order' => $order,
            'sql' => is_string($result) ? $result : null,
            'error' => $result instanceof Message ? $result->getMessage() : null,
        ];
    }
}

$m->query('DROP DATABASE m2tbl_fixtures');

// ---------------------------------------------------------------------------
// SaveController::columnNeedsAlterTable
// ---------------------------------------------------------------------------
$save = (new ReflectionClass(SaveController::class))->newInstanceWithoutConstructor();
$needs = new ReflectionMethod(SaveController::class, 'columnNeedsAlterTable');
$base = [
    'field_orig' => 'a', 'field_name' => 'a', 'field_type' => 'INT', 'field_type_orig' => 'INT',
    'field_length' => '', 'field_length_orig' => '', 'field_attribute' => '', 'field_attribute_orig' => '',
    'field_collation' => '', 'field_collation_orig' => '', 'field_null' => null, 'field_null_orig' => 'NO',
    'field_default_type' => 'NONE', 'field_default_type_orig' => 'NONE', 'field_default_value' => '',
    'field_default_value_orig' => '', 'field_extra' => null, 'field_extra_orig' => '', 'field_comments' => '',
    'field_comments_orig' => '', 'field_virtuality' => '', 'field_virtuality_orig' => '', 'field_move_to' => '',
];
$variants = [
    'unchanged' => [],
    'renamed' => ['field_name' => 'b'],
    'numeric rename equal' => ['field_orig' => '1', 'field_name' => '01'],
    'length 10 vs 10.0' => ['field_length' => '10.0', 'field_length_orig' => '10'],
    'length changed' => ['field_length' => '11'],
    'null ticked' => ['field_null' => 'YES'],
    'null orig YES, unticked' => ['field_null_orig' => 'YES'],
    'auto_increment lower-case orig' => ['field_extra' => 'AUTO_INCREMENT', 'field_extra_orig' => 'auto_increment'],
    'DEFAULT_GENERATED extra' => ['field_extra_orig' => 'DEFAULT_GENERATED'],
    'current_timestamp default' => ['field_default_type' => 'CURRENT_TIMESTAMP', 'field_default_type_orig' => 'CURRENT_TIMESTAMP', 'field_default_value_orig' => 'CURRENT_TIMESTAMP'],
    'collation absent' => ['field_collation' => null],
    'collation absent vs value' => ['field_collation' => null, 'field_collation_orig' => 'utf8mb4_bin'],
    'collation changed' => ['field_collation' => 'utf8mb4_bin', 'field_collation_orig' => 'utf8mb4_general_ci'],
    'virtuality absent' => ['field_virtuality' => null],
    'virtual column' => ['field_virtuality' => 'VIRTUAL'],
    'moved first' => ['field_move_to' => '-first'],
    'moved "0"' => ['field_move_to' => '0'],
    'on update attribute' => ['field_attribute' => 'on update CURRENT_TIMESTAMP'],
    'comment changed' => ['field_comments' => 'x'],
    'type changed' => ['field_type' => 'BIGINT'],
    'default 0 vs empty' => ['field_default_value' => '0'],
    'default 1e1 vs 10' => ['field_default_value' => '1e1', 'field_default_value_orig' => '10'],
];
$needsCases = [];
foreach ($variants as $label => $over) {
    $row = array_merge($base, $over);
    $_POST = [];
    foreach ($row as $key => $value) {
        if ($value === null) {
            continue;
        }

        $_POST[$key] = [0 => $value];
    }

    $posted = $_POST;
    $result = @$needs->invoke($save, 0);
    $needsCases[] = ['label' => $label, 'post' => array_map(static fn ($v) => $v[0], $posted), 'needs' => $result];
}

// ---------------------------------------------------------------------------
// PartitioningController::updatePartitioning ('ALTER TABLE `t` ' . getPartitionsDefinition())
// ---------------------------------------------------------------------------
$partitioning = [];
foreach (
    [
        ['partition_by' => 'HASH', 'partition_expr' => 'id', 'partition_count' => '4'],
        ['partition_by' => 'RANGE', 'partition_expr' => 'id', 'partition_count' => '2', 'partitions' => [
            ['name' => 'p0', 'value_type' => 'LESS THAN', 'value' => '100', 'engine' => '', 'comment' => '', 'data_directory' => '', 'index_directory' => '', 'max_rows' => '', 'min_rows' => '', 'tablespace' => '', 'node_group' => ''],
            ['name' => 'p1', 'value_type' => 'LESS THAN MAXVALUE', 'value' => '', 'engine' => '', 'comment' => 'last', 'data_directory' => '', 'index_directory' => '', 'max_rows' => '', 'min_rows' => '', 'tablespace' => '', 'node_group' => ''],
        ]],
        ['partition_by' => '', 'partition_expr' => '', 'partition_count' => '0'],
    ] as $post
) {
    bma_dbi('mysql', 80400);
    $_POST = $post;
    $partitioning[] = ['table' => 'my`t', 'post' => $post, 'sql' => 'ALTER TABLE ' . Util::backquote('my`t') . ' ' . (new CreateAddField(bma_dbi()))->getPartitionsDefinition()];
}

bma_write_fixture($out . '/structure.json', [
    'addIndex' => $addIndex,
    'addPrimary' => $addPrimary,
    'partitionOps' => $partitionOps,
    'partitioning' => $partitioning,
    'rename' => $rename,
    'indexCreateOrEdit' => $indexCases,
    'fromShowIndexes' => $fromShowIndexes,
    'moveColumns' => $moveCases,
    'columnNeedsAlterTable' => $needsCases,
]);
