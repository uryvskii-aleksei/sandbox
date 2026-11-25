<?php
declare(strict_types=1);
require_once '/var/www/memo/src/bootstrap.php';
use function Memo\query;
use function Memo\database;
if (getenv('APP_ENV') !== 'development' || !str_ends_with((string) getenv('DB_NAME'), '_test')) throw new RuntimeException('Isolated test database required');
query('INSERT INTO users(email,password_hash) VALUES(?,?)', ['migration-' . bin2hex(random_bytes(8)) . '@example.test', 'synthetic']);
$owner = (int) database()->lastInsertId();
try {
    query('INSERT INTO projects(owner_id,name) VALUES(?,?)', [$owner, 'Legacy migration fixture']);
    $project = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,name) VALUES(?,?)', [$project, 'Parent']);
    $parent = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,parent_id,name) VALUES(?,?,?)', [$project, $parent, 'Child']);
    $child = (int) database()->lastInsertId();
    query("DELETE FROM schema_migrations WHERE name='card-links-v1'");
    require '/var/www/memo/database/migrate.php';
    if ((int) query('SELECT COUNT(*) FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child])->fetchColumn() !== 1) throw new RuntimeException('Legacy edge was not preserved');
    query('DELETE FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child]);
    // Повтор миграции не воскрешает удалённые пользователем связи.
    require '/var/www/memo/database/migrate.php';
    if ((int) query('SELECT COUNT(*) FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child])->fetchColumn() !== 0) throw new RuntimeException('Migration resurrected an edge');
    echo "Legacy graph migration and repeatability verified.\n";
} finally {
    query('DELETE FROM users WHERE id=?', [$owner]);
}
