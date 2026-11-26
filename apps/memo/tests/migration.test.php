<?php
declare(strict_types=1);
require_once '/var/www/memo/src/bootstrap.php';
use function Memo\query;
use function Memo\database;
if (getenv('APP_ENV') !== 'development' || !str_ends_with((string) getenv('DB_NAME'), '_test')) throw new RuntimeException('Isolated test database required');
query('INSERT INTO users(email,password_hash) VALUES(?,?)', ['migration-' . bin2hex(random_bytes(8)) . '@example.test', 'synthetic']);
$owner = (int) database()->lastInsertId();
try {
    // В отдельной тестовой БД воспроизводим схему прежнего релиза.
    foreach (['projects', 'cards'] as $table) query("ALTER TABLE $table DROP COLUMN public_id");
    query('INSERT INTO projects(owner_id,name) VALUES(?,?)', [$owner, 'Legacy migration fixture']);
    $project = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,name) VALUES(?,?)', [$project, 'Parent']);
    $parent = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,parent_id,name) VALUES(?,?,?)', [$project, $parent, 'Child']);
    $child = (int) database()->lastInsertId();
    query("UPDATE projects SET created_at='2024-01-01 00:00:00' WHERE id=?", [$project]);
    query("INSERT INTO card_details(card_id,updated_at) VALUES(?,'2024-02-01 00:00:00.123456')", [$parent]);
    query("INSERT INTO card_details(card_id,updated_at,opened_at) VALUES(?,'2024-03-01 00:00:00.000000','2024-03-01 00:00:00.000000')", [$child]);
    query("DELETE FROM schema_migrations WHERE name IN ('card-links-v1','project-activity-v1')");
    require '/var/www/memo/database/migrate.php';
    $lastEdit = query('SELECT updated_at FROM projects WHERE id=?', [$project])->fetchColumn();
    if ($lastEdit !== '2024-02-01 00:00:00.123456') throw new RuntimeException('Project activity did not preserve the last saved card edit');
    if ((int) query('SELECT COUNT(*) FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child])->fetchColumn() !== 1) throw new RuntimeException('Legacy edge was not preserved');
    $projectPublicId = query('SELECT public_id FROM projects WHERE id=?', [$project])->fetchColumn();
    $cardPublicIds = query('SELECT public_id FROM cards WHERE project_id=? ORDER BY id', [$project])->fetchAll(PDO::FETCH_COLUMN);
    if (count(array_unique([$projectPublicId, ...$cardPublicIds])) !== 3) throw new RuntimeException('Migrated IDs must be distinct');
    foreach ([$projectPublicId, ...$cardPublicIds] as $publicId) {
        if (!is_string($publicId) || !preg_match('/^m[a-f0-9]{32}$/D', $publicId)) throw new RuntimeException('Legacy entity has no public ID');
    }
    query('DELETE FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child]);
    // Повтор миграции не воскрешает удалённые пользователем связи.
    require '/var/www/memo/database/migrate.php';
    if ((int) query('SELECT COUNT(*) FROM card_links WHERE source_id=? AND target_id=?', [$parent,$child])->fetchColumn() !== 0) throw new RuntimeException('Migration resurrected an edge');
    if (query('SELECT updated_at FROM projects WHERE id=?', [$project])->fetchColumn() !== $lastEdit) throw new RuntimeException('Migration changed project activity on repeat');
    if (query('SELECT public_id FROM projects WHERE id=?', [$project])->fetchColumn() !== $projectPublicId
        || query('SELECT public_id FROM cards WHERE project_id=? ORDER BY id', [$project])->fetchAll(PDO::FETCH_COLUMN) !== $cardPublicIds) {
        throw new RuntimeException('Migration changed existing public IDs');
    }
    echo "Legacy graph migration, project activity and stable workspace IDs verified.\n";
} finally {
    query('DELETE FROM users WHERE id=?', [$owner]);
}
