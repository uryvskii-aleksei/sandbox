<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$source = dirname(__DIR__) . '/src/bootstrap.php';
require is_file($source) ? $source : dirname(__DIR__) . '/backend/bootstrap.php';
$schema = file_get_contents(__DIR__ . '/schema.sql');
\Memo\database()->exec($schema);
echo "Схема Memo готова. Существующие таблицы и данные не удалялись.\n";
