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
foreach (['width' => 240, 'height' => 70] as $column => $default) {
    $definition = $pdo->query("SHOW COLUMNS FROM cards WHERE Field = '$column'")->fetch();
    if (!$definition) {
        $pdo->exec("ALTER TABLE cards ADD COLUMN $column SMALLINT UNSIGNED NOT NULL DEFAULT $default");
    } elseif ($column === 'height' && (int) $definition['Default'] !== $default) {
        $pdo->exec("ALTER TABLE cards ALTER COLUMN height SET DEFAULT $default");
    }
}
$markKind = $pdo->query("SHOW COLUMNS FROM board_marks WHERE Field = 'kind'")->fetch();
if ($markKind && $markKind['Type'] === "enum('label','line')") {
    $pdo->exec("ALTER TABLE board_marks MODIFY COLUMN kind ENUM('label','line','square','circle') NOT NULL");
}
if (!$pdo->query("SHOW COLUMNS FROM board_marks WHERE Field = 'label_scale'")->fetch()) {
    $pdo->exec('ALTER TABLE board_marks ADD COLUMN label_scale DOUBLE NOT NULL DEFAULT 1');
}
if (!$pdo->query("SHOW COLUMNS FROM projects WHERE Field = 'updated_at'")->fetch()) {
    $pdo->exec('ALTER TABLE projects ADD COLUMN updated_at DATETIME(6) NULL');
}
foreach (['projects', 'cards'] as $table) {
    if (!$pdo->query("SHOW COLUMNS FROM $table WHERE Field = 'public_id'")->fetch()) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN public_id CHAR(33) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE");
    }
    while ($rows = $pdo->query("SELECT id,public_id FROM $table WHERE public_id IS NULL ORDER BY id LIMIT 500")->fetchAll()) {
        foreach ($rows as $row) \Memo\ensurePublicId($table, $row);
    }
}
$pdo->beginTransaction();
try {
    $marker = $pdo->prepare('INSERT IGNORE INTO schema_migrations(name) VALUES(?)');
    $marker->execute(['compact-card-height-v1']);
    if ($marker->rowCount() === 1) {
        $pdo->exec('UPDATE cards SET height=70,version=version+1 WHERE height=190');
    }
    $marker->execute(['card-links-v1']);
    if ($marker->rowCount() === 1) {
        $pdo->exec("INSERT IGNORE INTO card_links(source_id,target_id) SELECT parent_id,id FROM cards WHERE parent_id IS NOT NULL");
    }
    $marker->execute(['project-activity-v1']);
    if ($marker->rowCount() === 1) {
        // У старых проектов используем сохранённые правки карточек. Первое открытие старой карточки могло создать обе даты сразу.
        $pdo->exec('UPDATE projects p JOIN (
            SELECT c.project_id, MAX(GREATEST(d.updated_at, COALESCE(d.deleted_at, d.updated_at))) AS last_edit
            FROM cards c JOIN card_details d ON d.card_id=c.id
            WHERE d.opened_at IS NULL OR d.opened_at<>d.updated_at OR d.deleted_at IS NOT NULL
            GROUP BY c.project_id
        ) activity ON activity.project_id=p.id
        SET p.updated_at=activity.last_edit WHERE p.updated_at IS NULL AND activity.last_edit>p.created_at');
    }
    $pdo->commit();
} catch (\Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $error;
}
echo "Схема Memo готова. Существующие таблицы и данные не удалялись.\n";
