<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/wave') {
    header('Location: /wave/', true, 301);
    return;
}
if ($path === '/wave/api.php') {
    require __DIR__ . '/site/api.php';
    return;
}

$prefix = '/wave/';
$wave = str_starts_with($path, $prefix);
$root = $wave ? __DIR__ . '/site' : __DIR__ . '/../amodu/site';
$relative = $wave ? substr($path, strlen($prefix)) : ltrim($path, '/');
$types = [
    'html' => 'text/html; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'json' => 'application/json',
    'jpg' => 'image/jpeg',
    'webp' => 'image/webp',
];
$file = realpath($root . '/' . ($relative === '' ? 'index.html' : $relative));
$type = $types[pathinfo($file ?: '', PATHINFO_EXTENSION)] ?? null;
if (!$type || !str_starts_with($file, realpath($root) . '/') || !is_file($file)) {
    http_response_code(404);
    return;
}
header('Content-Type: ' . $type);
readfile($file);
