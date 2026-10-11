<?php
/**
 * Lists where phpMyAdmin uses each msgid, by parsing its sources with its own tooling.
 *
 * Usage: php tools/parity/php/messages.php /path/to/phpmyadmin
 *
 * - Twig templates (resources/templates): parsed with phpMyAdmin's own Twig environment
 *   (Template::getTwigEnvironment); every PhpMyAdmin\Twig\Node\Expression\TransExpression node
 *   (the `t()` function: message / singular+plural+count / context) is a use.
 * - PHP (src): token_get_all; calls of __(), _gettext(), _ngettext(), _pgettext(), _npgettext()
 *   whose arguments are literal strings (concatenations of literals are joined).
 * - JavaScript (resources/js): the JS code reads window.Messages.<key>; the keys are defined in
 *   src/Controllers/JavaScriptMessagesController.php as `'key' => __('msgid')`. Each use of a key
 *   in resources/js is attributed to the JS file.
 *
 * Output: {"uses": [{msgid, plural, context, file, line, kind}], "jsKeys": {key: msgid}}
 */

declare(strict_types=1);

$pmaRoot = rtrim($argv[1] ?? getenv('PMA_PATH') ?: '/home/user/ref/pma', '/') . '/';

if (! defined('ROOT_PATH')) {
    define('ROOT_PATH', $pmaRoot);
}

require $pmaRoot . 'vendor/autoload.php';
require_once $pmaRoot . 'app/constants.php';

$uses = [];

/** @return list<string> */
function files(string $dir, string $suffix): array
{
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if ($file->isFile() && str_ends_with($file->getFilename(), $suffix)) {
            $out[] = $file->getPathname();
        }
    }

    sort($out);

    return $out;
}

function rel(string $root, string $path): string
{
    return substr($path, strlen($root));
}

// ---------------------------------------------------------------------------
// Twig
// ---------------------------------------------------------------------------

$twig = PhpMyAdmin\Template::getTwigEnvironment(null, false);
$templatesDir = $pmaRoot . 'resources/templates/';

$constant = static function (?Twig\Node\Node $node): ?string {
    if ($node instanceof Twig\Node\Expression\ConstantExpression) {
        $v = $node->getAttribute('value');

        return is_string($v) ? $v : null;
    }

    return null;
};

$walk = static function (Twig\Node\Node $node, string $file) use (&$walk, &$uses, $constant): void {
    if ($node instanceof PhpMyAdmin\Twig\Node\Expression\TransExpression) {
        $p = [];
        foreach ($node->getNode('arguments') as $name => $arg) {
            $p[$name] = $arg;
        }

        $msgid = $constant($p[0] ?? $p['message'] ?? $p['singular'] ?? null);
        $plural = $constant($p[1] ?? $p['plural'] ?? null);
        $context = $constant($p['context'] ?? null);
        if ($msgid !== null) {
            $uses[] = [
                'msgid' => $msgid,
                'plural' => $plural,
                'context' => $context,
                'file' => $file,
                'line' => $node->getTemplateLine(),
                'kind' => 'twig',
            ];
        }
    }

    foreach ($node as $child) {
        $walk($child, $file);
    }
};

foreach (files($templatesDir, '.twig') as $path) {
    $file = rel($pmaRoot, $path);
    $source = new Twig\Source((string) file_get_contents($path), substr($path, strlen($templatesDir)), $path);
    $ast = $twig->parse($twig->tokenize($source));
    $walk($ast, $file);
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

const GETTEXT_FUNCTIONS = [
    '__' => ['msgid'],
    '_gettext' => ['msgid'],
    '_ngettext' => ['msgid', 'plural'],
    '_pgettext' => ['context', 'msgid'],
    '_npgettext' => ['context', 'msgid', 'plural'],
];

/**
 * Reads the literal string arguments of a call starting at the "(" token index.
 *
 * @param list<mixed> $tokens
 *
 * @return list<string|null> one entry per argument; null when the argument is not literal
 */
function literalArgs(array $tokens, int $i): array
{
    $args = [];
    $current = '';
    $literal = true;
    $depth = 0;
    $n = count($tokens);
    for ($i++; $i < $n; $i++) {
        $t = $tokens[$i];
        $text = is_array($t) ? null : $t;
        if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        if ($text === '(' || $text === '[') {
            $depth++;
            $literal = false;
            continue;
        }

        if ($text === ')' || $text === ']') {
            if ($depth === 0) {
                $args[] = $literal && $current !== '' ? $current : null;

                return $args;
            }

            $depth--;
            continue;
        }

        if ($depth > 0) {
            continue;
        }

        if ($text === ',') {
            $args[] = $literal && $current !== '' ? $current : null;
            $current = '';
            $literal = true;
        } elseif ($text === '.') {
            continue;
        } elseif (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
            $current .= stringValue($t[1]);
        } else {
            $literal = false;
        }
    }

    return $args;
}

function stringValue(string $token): string
{
    // Single- and double-quoted PHP literals without interpolation (T_CONSTANT_ENCAPSED_STRING).
    return eval('return ' . $token . ';');
}

foreach (files($pmaRoot . 'src/', '.php') as $path) {
    $file = rel($pmaRoot, $path);
    $tokens = token_get_all((string) file_get_contents($path));
    $n = count($tokens);
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (! is_array($t) || ($t[0] !== T_STRING && $t[0] !== T_NAME_FULLY_QUALIFIED)) {
            continue;
        }

        $name = ltrim($t[1], '\\');
        if (! isset(GETTEXT_FUNCTIONS[$name])) {
            continue;
        }

        // previous meaningful token must not be `function`, `->`, `::`
        for ($p = $i - 1; $p >= 0 && is_array($tokens[$p]) && $tokens[$p][0] === T_WHITESPACE; $p--);
        if ($p >= 0 && is_array($tokens[$p]) && in_array($tokens[$p][0], [T_FUNCTION, T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_NULLSAFE_OBJECT_OPERATOR], true)) {
            continue;
        }

        for ($j = $i + 1; $j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE; $j++);
        if (($tokens[$j] ?? null) !== '(') {
            continue;
        }

        $args = literalArgs($tokens, $j);
        $named = [];
        foreach (GETTEXT_FUNCTIONS[$name] as $k => $role) {
            $named[$role] = $args[$k] ?? null;
        }

        if (($named['msgid'] ?? null) === null || $named['msgid'] === '') {
            continue;
        }

        $uses[] = [
            'msgid' => $named['msgid'],
            'plural' => $named['plural'] ?? null,
            'context' => $named['context'] ?? null,
            'file' => $file,
            'line' => $t[2],
            'kind' => 'php',
        ];
    }
}

// ---------------------------------------------------------------------------
// JavaScript messages
// ---------------------------------------------------------------------------

$jsKeys = [];
$controller = $pmaRoot . 'src/Controllers/JavaScriptMessagesController.php';
$tokens = token_get_all((string) file_get_contents($controller));
$n = count($tokens);
for ($i = 0; $i < $n; $i++) {
    $t = $tokens[$i];
    if (! is_array($t) || $t[0] !== T_CONSTANT_ENCAPSED_STRING) {
        continue;
    }

    for ($j = $i + 1; $j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE; $j++);
    if (! is_array($tokens[$j] ?? null) || $tokens[$j][0] !== T_DOUBLE_ARROW) {
        continue;
    }

    for ($k = $j + 1; $k < $n && is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE; $k++);
    if (! is_array($tokens[$k] ?? null) || ! in_array(ltrim($tokens[$k][1], '\\'), ['__', '_ngettext', '_pgettext'], true)) {
        continue;
    }

    for ($m = $k + 1; $m < $n && is_array($tokens[$m]) && $tokens[$m][0] === T_WHITESPACE; $m++);
    $args = literalArgs($tokens, $m);
    $fn = ltrim($tokens[$k][1], '\\');
    $msgid = $fn === '_pgettext' ? ($args[1] ?? null) : ($args[0] ?? null);
    if ($msgid !== null) {
        $jsKeys[stringValue($t[1])] = [
            'msgid' => $msgid,
            'plural' => $fn === '_ngettext' ? ($args[1] ?? null) : null,
            'context' => $fn === '_pgettext' ? ($args[0] ?? null) : null,
        ];
    }
}

foreach (array_merge(files($pmaRoot . 'resources/js/', '.ts'), files($pmaRoot . 'resources/js/', '.js')) as $path) {
    $file = rel($pmaRoot, $path);
    $lines = file($path) ?: [];
    foreach ($lines as $no => $line) {
        if (! preg_match_all('/\bMessages\.([A-Za-z0-9_]+)/', $line, $m)) {
            continue;
        }

        foreach ($m[1] as $key) {
            if (! isset($jsKeys[$key])) {
                continue;
            }

            $uses[] = $jsKeys[$key] + ['file' => $file, 'line' => $no + 1, 'kind' => 'js'];
        }
    }
}

echo json_encode(
    ['uses' => $uses, 'jsKeys' => $jsKeys],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
) . "\n";
