<?php
declare(strict_types=1);
namespace Memo;

function mediaReferences(array $card): array
{
    $values = [];
    foreach ($card['content'] as $group) foreach ($group['fields'] as $field) array_push($values, ...$field['value']);
    if (isset($card['document'])) {
        array_walk_recursive($card['document'], static function ($value, $key) use (&$values): void {
            if (in_array($key, ['src', 'href'], true)) $values[] = $value;
        });
    }
    $references = [];
    foreach ($values as $value) {
        if (is_string($value) && preg_match('~^(?:/[a-zA-Z0-9_-]+)*/api/media/([a-f0-9]{32})$~D', $value, $match)) $references[$match[1]] = $value;
    }
    return $references;
}

function accessibleMedia(string $id, int $actor, bool $withContent = true): array|false
{
    $scope = projectAccess('p');
    $columns = $withContent ? 'm.filename,m.mime,m.content' : 'm.id';
    return query("SELECT $columns FROM media m WHERE m.id=? AND (m.owner_id=? OR EXISTS (
        SELECT 1 FROM card_media cm JOIN cards c ON c.id=cm.card_id JOIN projects p ON p.id=c.project_id
        LEFT JOIN card_details d ON d.card_id=c.id LEFT JOIN project_details pd ON pd.project_id=p.id
        WHERE cm.media_id=m.id AND d.deleted_at IS NULL AND pd.deleted_at IS NULL AND $scope
    ))", [$id, $actor, $actor, memberAccount($actor)])->fetch();
}

function syncCardMedia(int $id, int $actor): void
{
    $previous = query('SELECT media_id FROM card_media WHERE card_id=?', [$id])->fetchAll(\PDO::FETCH_COLUMN);
    $files = array_keys(mediaReferences(cardOutput(cardRow($id, $actor), $actor)));
    foreach (array_diff($files, $previous) as $file) {
        if (!accessibleMedia($file, $actor, false)) fail(422, 'Вложение недоступно.');
        query('INSERT INTO card_media(card_id,media_id) VALUES(?,?)', [$id, $file]);
    }
    foreach (array_diff($previous, $files) as $file) query('DELETE FROM card_media WHERE card_id=? AND media_id=?', [$id, $file]);
}

function migrateCardMedia(): void
{
    $last = 0;
    while ($cards = query("SELECT c.*,p.owner_id FROM cards c JOIN projects p ON p.id=c.project_id
        LEFT JOIN card_documents cd ON cd.card_id=c.id WHERE c.id>? AND
        (CAST(cd.document AS CHAR) LIKE '%/api/media/%' OR EXISTS (
            SELECT 1 FROM field_groups g JOIN fields f ON f.group_id=g.id
            WHERE g.card_id=c.id AND CAST(f.values_json AS CHAR) LIKE '%/api/media/%'))
        ORDER BY c.id LIMIT 200", [$last])->fetchAll()) {
        foreach ($cards as $card) {
            $last = (int) $card['id'];
            foreach (array_keys(mediaReferences(cardOutput($card))) as $file) {
                query('INSERT IGNORE INTO card_media(card_id,media_id) SELECT ?,id FROM media WHERE id=? AND owner_id=?', [$last, $file, $card['owner_id']]);
            }
        }
    }
}
