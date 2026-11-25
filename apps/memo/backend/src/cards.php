<?php
declare(strict_types=1);
namespace Memo;

function project(int $id, int $owner, bool $lock = false): array
{
    $row = query('SELECT id,name,owner_id FROM projects WHERE id=? AND owner_id=?' . ($lock ? ' FOR UPDATE' : ''), [$id, $owner])->fetch();
    if (!$row) fail(404, 'Проект не найден.');
    return ['id' => (int) $row['id'], 'name' => $row['name']];
}

function cardRow(int $id, int $owner): array
{
    $row = query('SELECT c.* FROM cards c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.owner_id=?', [$id, $owner])->fetch();
    if (!$row) fail(404, 'Карточка не найдена.');
    return $row;
}

function cardOutput(array $row): array
{
    $groups = query('SELECT * FROM field_groups WHERE card_id=? ORDER BY sort_order,id', [$row['id']])->fetchAll();
    $content = [];
    foreach ($groups as $group) {
        $fields = query('SELECT * FROM fields WHERE group_id=? ORDER BY sort_order,id', [$group['id']])->fetchAll();
        $content[] = ['id' => (int) $group['id'], 'name' => $group['name'], 'order' => (int) $group['sort_order'],
            'collapsed' => (bool) $group['collapsed'], 'fields' => array_map(static fn(array $field): array => [
                'id' => (int) $field['id'], 'type' => $field['type'], 'title' => $field['title'],
                'order' => (int) $field['sort_order'], 'value' => json_decode($field['values_json'], true, 64, JSON_THROW_ON_ERROR),
            ], $fields)];
    }
    return ['id' => (int) $row['id'], 'project' => (int) $row['project_id'], 'name' => $row['name'],
        'parent' => $row['parent_id'] === null ? null : (int) $row['parent_id'],
        'coordinates' => ['x' => (float) $row['x'], 'y' => (float) $row['y']],
        'version' => (int) $row['version'], 'content' => $content];
}

function validateParent(?int $parent, int $projectId, ?int $cardId): void
{
    $visited = [];
    while ($parent !== null) {
        if ($parent === $cardId || isset($visited[$parent])) fail(422, 'Связь создаёт цикл.');
        $visited[$parent] = true;
        $row = query('SELECT parent_id FROM cards WHERE id=? AND project_id=?', [$parent, $projectId])->fetch();
        if (!$row) fail(422, 'Родительская карточка должна находиться в этом проекте.');
        $parent = $row['parent_id'] === null ? null : (int) $row['parent_id'];
    }
}

function fieldValue(mixed $values, string $type): array
{
    if (!is_array($values) || !array_is_list($values) || count($values) > 100) fail(422, 'Некорректные значения поля.');
    foreach ($values as $value) {
        if (!is_string($value) || strlen($value) > 20000) fail(422, 'Слишком большое значение поля.');
        if (in_array($type, ['url', 'image', 'video', 'audio'], true) && $value !== '') {
            $media = preg_match('~^/(?:[a-zA-Z0-9_-]+/)*api/media/[a-f0-9]{32}$~', $value);
            $url = filter_var($value, FILTER_VALIDATE_URL);
            if (!$media && (!$url || !in_array(strtolower(parse_url($url, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true))) fail(422, 'Укажите HTTP(S)-ссылку или загруженный файл.');
        }
        if ($type === 'date' && $value !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) fail(422, 'Некорректная дата.');
    }
    return $values;
}

function keepOnly(string $table, string $column, int $ownerId, array $ids): void
{
    // Имена таблиц и столбцов передаются только из фиксированных вызовов ниже.
    $extra = $ids ? ' AND id NOT IN (' . implode(',', array_fill(0, count($ids), '?')) . ')' : '';
    query("DELETE FROM $table WHERE $column=?" . $extra, [$ownerId, ...$ids]);
}

function saveContent(int $cardId, mixed $content): void
{
    if (!is_array($content) || !array_is_list($content) || count($content) > 30) fail(422, 'В карточке допустимо до 30 групп.');
    $groups = [];
    foreach ($content as $order => $group) {
        if (!is_array($group)) fail(422, 'Некорректная группа.');
        $id = (int) ($group['id'] ?? 0);
        $name = text($group['name'] ?? '', 128, true);
        $collapsed = (int) (bool) ($group['collapsed'] ?? false);
        if ($id > 0) {
            if (in_array($id, $groups, true) || !query('SELECT id FROM field_groups WHERE id=? AND card_id=?', [$id, $cardId])->fetch()) fail(422, 'Группа не принадлежит карточке.');
            query('UPDATE field_groups SET name=?,sort_order=?,collapsed=? WHERE id=?', [$name, $order, $collapsed, $id]);
        } else {
            query('INSERT INTO field_groups(card_id,name,sort_order,collapsed) VALUES(?,?,?,?)', [$cardId, $name, $order, $collapsed]);
            $id = (int) database()->lastInsertId();
        }
        $groups[] = $id;
        $items = $group['fields'] ?? [];
        if (!is_array($items) || !array_is_list($items) || count($items) > 100) fail(422, 'В группе допустимо до 100 полей.');
        $fields = [];
        foreach ($items as $position => $field) {
            if (!is_array($field)) fail(422, 'Некорректное поле.');
            $fieldId = (int) ($field['id'] ?? 0);
            $type = $field['type'] ?? '';
            if (!in_array($type, ['textarea', 'url', 'date', 'image', 'video', 'audio'], true)) fail(422, 'Неизвестный тип поля.');
            $title = text($field['title'] ?? '', 128, true);
            $value = json_encode(fieldValue($field['value'] ?? [''], $type), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            if ($fieldId > 0) {
                if (in_array($fieldId, $fields, true) || !query('SELECT id FROM fields WHERE id=? AND group_id=?', [$fieldId, $id])->fetch()) fail(422, 'Поле не принадлежит группе.');
                query('UPDATE fields SET type=?,title=?,values_json=?,sort_order=? WHERE id=?', [$type, $title, $value, $position, $fieldId]);
            } else {
                query('INSERT INTO fields(group_id,type,title,values_json,sort_order) VALUES(?,?,?,?,?)', [$id, $type, $title, $value, $position]);
                $fieldId = (int) database()->lastInsertId();
            }
            $fields[] = $fieldId;
        }
        keepOnly('fields', 'group_id', $id, $fields);
    }
    keepOnly('field_groups', 'card_id', $cardId, $groups);
}

function saveCard(int $id, int $owner, array $body, bool $positionOnly = false): array
{
    database()->beginTransaction();
    try {
        $row = cardRow($id, $owner);
        project((int) $row['project_id'], $owner, true);
        $row = query('SELECT * FROM cards WHERE id=? FOR UPDATE', [$id])->fetch();
        if ((int) ($body['version'] ?? 0) !== (int) $row['version']) fail(409, 'Карточка уже изменилась. Обновите проект перед сохранением.');
        $point = coordinates($body['coordinates'] ?? null);
        if ($positionOnly) query('UPDATE cards SET x=?,y=?,version=version+1 WHERE id=?', [$point['x'], $point['y'], $id]);
        else {
            $name = text($body['name'] ?? '');
            $parent = empty($body['parent']) ? null : positiveId($body['parent']);
            validateParent($parent, (int) $row['project_id'], $id);
            query('UPDATE cards SET name=?,parent_id=?,x=?,y=?,version=version+1 WHERE id=?', [$name, $parent, $point['x'], $point['y'], $id]);
            saveContent($id, $body['content'] ?? []);
        }
        database()->commit();
    } catch (\Throwable $error) {
        if (database()->inTransaction()) database()->rollBack();
        throw $error;
    }
    return cardOutput(cardRow($id, $owner));
}
