<?php
/**
 * Dumps every phpMyAdmin route by executing its own routing definition.
 *
 * Usage: php tools/parity/php/routes.php /path/to/phpmyadmin
 *
 * pma: src/Routing/Routes.php::collect (reads the #[Route] attributes of every controller and
 * feeds FastRoute's RouteCollector). We hand it a RouteCollector subclass that records each
 * addRoute() call, then also run FastRoute's own parser on each path so the output carries the
 * parsed variables and optional segments exactly as the dispatcher sees them.
 */

declare(strict_types=1);

$pmaRoot = rtrim($argv[1] ?? getenv('PMA_PATH') ?: '/home/user/ref/pma', '/') . '/';

if (! defined('ROOT_PATH')) {
    define('ROOT_PATH', $pmaRoot);
}

require $pmaRoot . 'vendor/autoload.php';

$collector = new class (new FastRoute\RouteParser\Std(), new FastRoute\DataGenerator\GroupCountBased())
    extends FastRoute\RouteCollector {
    /** @var list<array{methods: list<string>, path: string, controller: string}> */
    public array $recorded = [];

    /** @inheritDoc */
    public function addRoute($httpMethod, $route, $handler): void
    {
        $this->recorded[] = [
            'methods' => array_values((array) $httpMethod),
            'path' => $route,
            'controller' => (string) $handler,
        ];
        parent::addRoute($httpMethod, $route, $handler);
    }
};

PhpMyAdmin\Routing\Routes::collect($collector);

$parser = new FastRoute\RouteParser\Std();
$routes = [];
foreach ($collector->recorded as $r) {
    $variants = [];
    foreach ($parser->parse($r['path']) as $segments) {
        $variant = '';
        foreach ($segments as $segment) {
            $variant .= is_string($segment) ? $segment : '{' . $segment[0] . '}';
        }

        $variants[] = $variant;
    }

    sort($r['methods']);
    $controller = $r['controller'];
    $prefix = 'PhpMyAdmin\\Controllers\\';
    if (str_starts_with($controller, $prefix)) {
        $controller = substr($controller, strlen($prefix));
    }

    $file = (new ReflectionClass($r['controller']))->getFileName();
    $routes[] = [
        'path' => $r['path'],
        'methods' => $r['methods'],
        'controller' => str_replace('\\', '/', $controller),
        'file' => $file === false ? null : substr($file, strlen(realpath($pmaRoot)) + 1),
        'variants' => $variants,
    ];
}

foreach ($routes as &$route) {
    $route['scope'] = 'app';
}

unset($route);

// The setup script has no #[Route] attributes: Routing::callSetupController dispatches with a
// `match ($route)` over literal paths. Read those arms from the method's own source.
$method = new ReflectionMethod(PhpMyAdmin\Routing\Routing::class, 'callSetupController');
$lines = file((string) $method->getFileName());
$body = implode('', array_slice($lines, $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));
$uses = [];
preg_match_all('/^use (PhpMyAdmin\\\\Controllers\\\\[^;]+);/m', (string) file_get_contents((string) $method->getFileName()), $useMatches);
foreach ($useMatches[1] as $fqcn) {
    $uses[substr($fqcn, strrpos($fqcn, '\\') + 1)] = $fqcn;
}

preg_match_all("/^\\s*((?:'[^']*'\\s*,\\s*)*'[^']*')\\s*=>\\s*(\\w+)::class/m", $body, $arms, PREG_SET_ORDER);
foreach ($arms as $arm) {
    preg_match_all("/'([^']*)'/", $arm[1], $paths);
    $fqcn = $uses[$arm[2]] ?? $arm[2];
    $controller = str_replace('\\', '/', substr($fqcn, strlen('PhpMyAdmin\\Controllers\\')));
    $file = (new ReflectionClass($fqcn))->getFileName();
    foreach ($paths[1] as $path) {
        $routes[] = [
            'path' => $path,
            'methods' => ['GET', 'POST'],
            'controller' => $controller,
            'file' => $file === false ? null : substr($file, strlen(realpath($pmaRoot)) + 1),
            'variants' => [$path],
            'scope' => 'setup',
        ];
    }
}

echo json_encode($routes, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
