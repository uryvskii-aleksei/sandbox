<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$source = dirname(__DIR__) . '/src/bootstrap.php';
require_once is_file($source) ? $source : dirname(__DIR__) . '/backend/bootstrap.php';
$schema = file_get_contents(__DIR__ . '/schema.sql');
\Memo\database()->exec($schema);
$pdo = \Memo\database();
// Старые карточки остаются записями на корневом полотне.
if (!$pdo->query("SHOW COLUMNS FROM cards WHERE Field = 'kind'")->fetch()) {
    $pdo->exec("ALTER TABLE cards ADD COLUMN kind ENUM('record','folder') NOT NULL DEFAULT 'record'");
}
if (!$pdo->query("SHOW COLUMNS FROM cards WHERE Field = 'folder_id'")->fetch()) {
    $pdo->exec('ALTER TABLE cards ADD COLUMN folder_id INT UNSIGNED NULL, ADD INDEX card_board (project_id, folder_id)');
}
foreach (['width' => 240, 'height' => 190] as $column => $default) {
    if (!$pdo->query("SHOW COLUMNS FROM cards WHERE Field = '$column'")->fetch()) {
        $pdo->exec("ALTER TABLE cards ADD COLUMN $column SMALLINT UNSIGNED NOT NULL DEFAULT $default");
    }
}
$markKind = $pdo->query("SHOW COLUMNS FROM board_marks WHERE Field = 'kind'")->fetch();
if ($markKind && $markKind['Type'] === "enum('label','line')") {
    $pdo->exec("ALTER TABLE board_marks MODIFY COLUMN kind ENUM('label','line','square','circle') NOT NULL");
}
if (!$pdo->query("SHOW COLUMNS FROM board_marks WHERE Field = 'label_scale'")->fetch()) {
    $pdo->exec('ALTER TABLE board_marks ADD COLUMN label_scale DOUBLE NOT NULL DEFAULT 1');
}
$pdo->beginTransaction();
try {
    $marker = $pdo->prepare('INSERT IGNORE INTO schema_migrations(name) VALUES(?)');
    $marker->execute(['card-links-v1']);
    if ($marker->rowCount() === 1) {
        $pdo->exec("INSERT IGNORE INTO card_links(source_id,target_id) SELECT parent_id,id FROM cards WHERE parent_id IS NOT NULL");
    }
    $pdo->commit();
} catch (\Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $error;
}
echo "Схема Memo готова. Существующие таблицы и данные не удалялись.\n";
