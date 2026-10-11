<?php
/**
 * Controls emitted by phpMyAdmin's PHP HTML helpers rather than by a Twig template.
 *
 * Usage: php tools/parity/php/helpers.php /path/to/phpmyadmin
 *
 * Scans src/ with token_get_all for calls of
 *   Generator::getNavigationLink($link, $text, $icon, $id)   → link (navigation panel controls)
 *   Generator::linkOrButton($url, $params, $text, …)         → link
 *   Util::pageselector($name, …)                              → select (page selector)
 * and reads their literal arguments: __('…') labels and string literal ids/names.
 *
 * Output: [{file, line, helper, kind, id, name, label}]
 */

declare(strict_types=1);

$pmaRoot = rtrim($argv[1] ?? getenv('PMA_PATH') ?: '/home/user/ref/pma', '/') . '/';

const HELPERS = [
    'Generator::getNavigationLink' => 'link',
    'Generator::linkOrButton' => 'link',
    'Util::pageselector' => 'select',
];

/** @return list<string> */
function phpFiles(string $dir): array
{
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
            $out[] = $file->getPathname();
        }
    }

    sort($out);

    return $out;
}

/**
 * Splits the argument tokens of a call (from the "(" index) into one token list per argument.
 *
 * @param list<mixed> $tokens
 *
 * @return list<list<mixed>>
 */
function callArgs(array $tokens, int $i): array
{
    $args = [[]];
    $depth = 0;
    $n = count($tokens);
    for ($i++; $i < $n; $i++) {
        $t = $tokens[$i];
        $text = is_array($t) ? null : $t;
        if ($text === '(' || $text === '[' || $text === '{') {
            $depth++;
        } elseif ($text === ')' || $text === ']' || $text === '}') {
            if ($depth === 0) {
                return $args;
            }

            $depth--;
        } elseif ($text === ',' && $depth === 0) {
            $args[] = [];
            continue;
        }

        $args[count($args) - 1][] = $t;
    }

    return $args;
}

/** @param list<mixed> $arg */
function literal(array $arg): ?string
{
    $meaningful = array_values(array_filter(
        $arg,
        static fn ($t): bool => ! (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT], true)),
    ));
    if (count($meaningful) === 1 && is_array($meaningful[0]) && $meaningful[0][0] === T_CONSTANT_ENCAPSED_STRING) {
        return eval('return ' . $meaningful[0][1] . ';');
    }

    return null;
}

/** @param list<mixed> $arg */
function gettextLabel(array $arg): ?string
{
    $n = count($arg);
    for ($i = 0; $i < $n; $i++) {
        $t = $arg[$i];
        if (! is_array($t) || ! in_array(ltrim($t[1], '\\'), ['__', '_pgettext'], true)) {
            continue;
        }

        $inner = callArgs($arg, $i + 1);
        $msg = literal(ltrim($t[1], '\\') === '_pgettext' ? ($inner[1] ?? []) : ($inner[0] ?? []));
        if ($msg !== null) {
            return $msg;
        }
    }

    return null;
}

$out = [];
foreach (phpFiles($pmaRoot . 'src/') as $path) {
    $file = substr($path, strlen($pmaRoot));
    $tokens = token_get_all((string) file_get_contents($path));
    $n = count($tokens);
    for ($i = 0; $i + 2 < $n; $i++) {
        $t = $tokens[$i];
        if (! is_array($t) || ! in_array($t[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED], true)) {
            continue;
        }

        $class = substr($t[1], (int) strrpos('\\' . $t[1], '\\'));
        if (! is_array($tokens[$i + 1]) || $tokens[$i + 1][0] !== T_DOUBLE_COLON || ! is_array($tokens[$i + 2])) {
            continue;
        }

        $helper = $class . '::' . $tokens[$i + 2][1];
        if (! isset(HELPERS[$helper]) || ($tokens[$i + 3] ?? null) !== '(') {
            continue;
        }

        // skip the definition itself
        if (str_ends_with($file, 'Html/Generator.php') && $helper !== 'Util::pageselector' && str_contains($helper, 'Generator')) {
            $prev = $tokens[$i - 2] ?? null;
            if (is_array($prev) && $prev[0] === T_FUNCTION) {
                continue;
            }
        }

        $args = callArgs($tokens, $i + 3);
        $row = ['file' => $file, 'line' => $t[2], 'helper' => $helper, 'kind' => HELPERS[$helper], 'id' => null, 'name' => null, 'label' => null];
        if ($helper === 'Generator::getNavigationLink') {
            $row['label'] = gettextLabel($args[1] ?? []);
            $row['id'] = literal($args[3] ?? []);
        } elseif ($helper === 'Generator::linkOrButton') {
            $row['label'] = gettextLabel($args[2] ?? []);
        } else {
            $row['name'] = literal($args[0] ?? []);
            $row['label'] = gettextLabel($args[5] ?? []);
        }

        $out[] = $row;
    }
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
