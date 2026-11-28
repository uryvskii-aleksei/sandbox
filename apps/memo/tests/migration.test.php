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
    query('ALTER TABLE cards ALTER COLUMN height SET DEFAULT 190');
    query('ALTER TABLE cards ALTER COLUMN width SET DEFAULT 240');
    query('ALTER TABLE cards DROP COLUMN auto_height');
    query('INSERT INTO projects(owner_id,name) VALUES(?,?)', [$owner, 'Legacy migration fixture']);
    $project = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,name) VALUES(?,?)', [$project, 'Parent']);
    $parent = (int) database()->lastInsertId();
    query('INSERT INTO cards(project_id,parent_id,name,height) VALUES(?,?,?,?)', [$project, $parent, 'Child', 248]);
    $child = (int) database()->lastInsertId();
    query("UPDATE projects SET created_at='2024-01-01 00:00:00' WHERE id=?", [$project]);
    query("INSERT INTO card_details(card_id,updated_at) VALUES(?,'2024-02-01 00:00:00.123456')", [$parent]);
    query("INSERT INTO card_details(card_id,updated_at,opened_at) VALUES(?,'2024-03-01 00:00:00.000000','2024-03-01 00:00:00.000000')", [$child]);
    $media = bin2hex(random_bytes(16));
    query('INSERT INTO media(id,owner_id,filename,mime,content) VALUES(?,?,?,?,?)', [$media,$owner,'fixture.png','image/png','synthetic']);
    query('INSERT INTO field_groups(card_id,name) VALUES(?,?)', [$child,'Legacy media']);
    $group = (int) database()->lastInsertId();
    query('INSERT INTO fields(group_id,type,values_json) VALUES(?,?,?)', [$group,'image',json_encode(["/memo/api/media/$media"], JSON_THROW_ON_ERROR)]);
    query("DELETE FROM schema_migrations WHERE name IN ('card-links-v1','project-activity-v1','compact-card-height-v1','growing-card-title-v1','card-media-v1')");
    require '/var/www/memo/database/migrate.php';
    if (query('SELECT media_id FROM card_media WHERE card_id=?', [$child])->fetchColumn() !== $media) throw new RuntimeException('Legacy attachment did not remain associated with its card');
    $sizes = query('SELECT height FROM cards WHERE project_id=? ORDER BY id', [$project])->fetchAll(PDO::FETCH_COLUMN);
    if (array_map('intval', $sizes) !== [70,248]) throw new RuntimeException('Default card height did not compact or a custom height was changed');
    $geometry = query('SELECT width,auto_height FROM cards WHERE project_id=? ORDER BY id', [$project])->fetchAll(PDO::FETCH_NUM);
    if (array_map(static fn(array $row): array => array_map('intval', $row), $geometry) !== [[240,1],[240,0]])
        throw new RuntimeException('The title height mode did not preserve the prior resize');

    query('INSERT INTO cards(project_id,name) VALUES(?,?)', [$project, 'New default']);
    $newCard = (int) database()->lastInsertId();
    $newSize = query('SELECT width,height FROM cards WHERE id=?', [$newCard])->fetch(PDO::FETCH_NUM);
    if (array_map('intval', $newSize) !== [188,70]) throw new RuntimeException('New cards did not get the compact default size');
    query('DELETE FROM cards WHERE id=?', [$newCard]);
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
    query('UPDATE cards SET height=190 WHERE id=?', [$parent]);
    // Повтор миграции не воскрешает удалённые пользователем связи.
    require '/var/www/memo/database/migrate.php';
    if ((int) query('SELECT height FROM cards WHERE id=?', [$parent])->fetchColumn() !== 190) throw new RuntimeException('Repeated migration overwrote a saved resize');
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
