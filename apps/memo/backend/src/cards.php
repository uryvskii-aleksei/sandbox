<?php
declare(strict_types=1);
namespace Memo;

function project(int $id, int $owner, bool $lock = false): array
{
    $row = query('SELECT p.id,p.public_id,p.name,p.owner_id,COALESCE(d.inbox,0) AS inbox FROM projects p LEFT JOIN project_details d ON d.project_id=p.id WHERE p.id=? AND p.owner_id=? AND d.deleted_at IS NULL' . ($lock ? ' FOR UPDATE' : ''), [$id, $owner])->fetch();
    if (!$row) fail(404, 'Проект не найден.');
    return ['id' => (int) $row['id'], 'publicId' => ensurePublicId('projects', $row),
        'name' => $row['name'], 'inbox' => (bool) $row['inbox'], 'deletedAt' => null];
}

function cardRow(int $id, int $owner, bool $includeDeleted = false): array
{
    $visible = $includeDeleted ? '' : ' AND d.deleted_at IS NULL AND pd.deleted_at IS NULL';
    $row = query('SELECT c.* FROM cards c JOIN projects p ON p.id=c.project_id LEFT JOIN card_details d ON d.card_id=c.id LEFT JOIN project_details pd ON pd.project_id=p.id WHERE c.id=? AND p.owner_id=?' . $visible, [$id, $owner])->fetch();
    if (!$row) fail(404, 'Карточка не найдена.');
    return $row;
}

function cardOutput(array $row): array
{
    $details = query('SELECT * FROM card_details WHERE card_id=?', [$row['id']])->fetch();
    $document = query('SELECT document FROM card_documents WHERE card_id=?', [$row['id']])->fetchColumn();
    $parent = $row['parent_id'];
    if ($parent !== null && !query('SELECT c.id FROM cards c LEFT JOIN card_details d ON d.card_id=c.id LEFT JOIN project_details pd ON pd.project_id=c.project_id WHERE c.id=? AND d.deleted_at IS NULL AND pd.deleted_at IS NULL', [$parent])->fetch()) $parent = null;
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
    return ['id' => (int) $row['id'], 'publicId' => ensurePublicId('cards', $row),
        'project' => (int) $row['project_id'], 'name' => $row['name'],
        'kind' => $row['kind'], 'folder' => $row['folder_id'] === null ? null : (int) $row['folder_id'],
        'parent' => $parent === null ? null : (int) $parent,
        'pinned' => (bool) ($details['pinned'] ?? false), 'deletedAt' => $details['deleted_at'] ?? null,
        'updatedAt' => $details['updated_at'] ?? null, 'openedAt' => $details['opened_at'] ?? null,
        'coordinates' => ['x' => (float) $row['x'], 'y' => (float) $row['y']],
        'size' => ['width' => (int) $row['width'], 'height' => (int) $row['height']],
        ...($document === false ? [] : ['document' => json_decode($document, true, 64, JSON_THROW_ON_ERROR)]),
        'version' => (int) $row['version'], 'content' => $content];
}

function validateParent(?int $parent, int $projectId, ?int $cardId): void
{
    if ($parent === null) return;
    if ($parent === $cardId) fail(422, 'Связь создаёт цикл.');
    if (!query('SELECT id FROM cards WHERE id=? AND project_id=?', [$parent, $projectId])->fetch()) fail(422, 'Родительская карточка должна находиться в этом проекте.');
    // Предки могут находиться в других проектах. Общий граф проверяется в putLink.
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

function checkedDocumentNode(mixed $node, array $allowed, int $depth, array &$index): array
{
    if (!is_array($node) || $depth > 16 || !in_array($node['type'] ?? null, $allowed, true)) fail(422, 'Недопустимый блок документа.');
    $type = $node['type'];
    $result = ['type' => $type];
    $blocks = ['paragraph', 'heading', 'bulletList', 'orderedList', 'memoMedia'];
    $children = match ($type) {
        'doc' => [...$blocks, 'memoSection'],
        'memoSection' => $blocks,
        'listItem' => $blocks,
        'paragraph', 'heading' => ['text', 'hardBreak'],
        'bulletList', 'orderedList' => ['listItem'],
        default => [],
    };
    if ($type === 'text') {
        $value = $node['text'] ?? null;
        if (!is_string($value) || $value === '') fail(422, 'Недопустимый текст документа.');
        $result['text'] = $value;
        $index[] = $value;
        $marks = $node['marks'] ?? [];
        if (!is_array($marks) || !array_is_list($marks) || count($marks) > 3) fail(422, 'Недопустимое форматирование.');
        foreach ($marks as $mark) {
            $markType = $mark['type'] ?? '';
            if (!in_array($markType, ['bold', 'italic', 'link'], true)) fail(422, 'Недопустимое форматирование.');
            if ($markType === 'link') {
                $href = text($mark['attrs']['href'] ?? '', 4096);
                fieldValue([$href], 'url');
                $index[] = $href;
                $result['marks'][] = ['type' => 'link', 'attrs' => ['href' => $href]];
            } else $result['marks'][] = ['type' => $markType];
        }
    }
    if ($type === 'heading') {
        $level = $node['attrs']['level'] ?? 2;
        if (!in_array($level, [2, 3], true)) fail(422, 'Недопустимый уровень заголовка.');
        $result['attrs'] = ['level' => $level];
    }
    if ($type === 'orderedList') {
        $start = $node['attrs']['start'] ?? 1;
        if (!is_int($start) || $start < 1 || $start > 10000) fail(422, 'Недопустимый номер списка.');
        $result['attrs'] = ['start' => $start];
    }
    if ($type === 'memoSection') {
        $id = $node['attrs']['id'] ?? null;
        if (!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $id)) fail(422, 'Некорректный идентификатор текстового блока.');
        $title = text($node['attrs']['title'] ?? '', 128, true);
        $result['attrs'] = ['id' => $id, 'title' => $title];
        if ($title !== '') $index[] = $title;
    }
    if ($type === 'memoMedia') {
        $media = $node['attrs']['kind'] ?? null;
        if (!in_array($media, ['image', 'video', 'audio'], true)) fail(422, 'Недопустимый вид вложения.');
        $src = text($node['attrs']['src'] ?? '', 4096);
        fieldValue([$src], $media);
        $title = text($node['attrs']['title'] ?? '', 128, true);
        array_push($index, $title, $src);
        $result['attrs'] = ['kind' => $media, 'src' => $src, 'title' => $title];
    }
    $content = $node['content'] ?? [];
    if (!is_array($content) || !array_is_list($content) || count($content) > 5000 || ($content && !$children)) fail(422, 'Недопустимое содержимое документа.');
    if (in_array($type, ['doc', 'memoSection', 'orderedList', 'bulletList', 'listItem'], true) && !$content) fail(422, 'Недопустимый пустой блок.');
    if ($type === 'listItem' && ($content[0]['type'] ?? null) !== 'paragraph') fail(422, 'Элемент списка должен начинаться с абзаца.');
    foreach ($content as $child) $result['content'][] = checkedDocumentNode($child, $children, $depth + 1, $index);
    if ($type === 'doc' && array_filter($result['content'], static fn(array $child): bool => $child['type'] === 'memoSection')) {
        $ids = [];
        foreach ($result['content'] as $child) {
            if ($child['type'] !== 'memoSection' || isset($ids[$child['attrs']['id']])) fail(422, 'Текстовые блоки должны иметь разные идентификаторы.');
            $ids[$child['attrs']['id']] = true;
        }
    }
    return $result;
}

function saveDocument(int $id, mixed $document): void
{
    $index = [];
    $value = json_encode(checkedDocumentNode($document, ['doc'], 0, $index), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if (strlen($value) > 400000) fail(422, 'Документ слишком большой.');
    query('INSERT INTO card_documents(card_id,document,search_text) VALUES(?,?,?) ON DUPLICATE KEY UPDATE document=VALUES(document),search_text=VALUES(search_text)',
        [$id, $value, implode(' ', $index)]);
}

function cardSize(mixed $value): array
{
    if (!is_array($value)) fail(422, 'Укажите размер карточки.');
    $width = $value['width'] ?? null; $height = $value['height'] ?? null;
    if (!is_int($width) || !is_int($height) || $width < 180 || $width > 920 || $height < 125 || $height > 760) fail(422, 'Недопустимый размер карточки.');
    return ['width' => $width, 'height' => $height];
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
    unset($body['publicId']);
    return receipted($owner, ($positionOnly ? 'position:' : 'save:') . $id, $body, static function () use ($id, $owner, $body, $positionOnly): array {
        $row = cardRow($id, $owner);
        project((int) $row['project_id'], $owner, true);
        $row = query('SELECT * FROM cards WHERE id=? FOR UPDATE', [$id])->fetch();
        if ((int) ($body['version'] ?? 0) !== (int) $row['version']) fail(409, 'Карточка уже изменилась. Обновите проект перед сохранением.');
        $point = coordinates($body['coordinates'] ?? null);
        if ($positionOnly) {
            $size = array_key_exists('size', $body) ? cardSize($body['size']) : $row;
            query('UPDATE cards SET x=?,y=?,width=?,height=?,version=version+1 WHERE id=?', [$point['x'], $point['y'], $size['width'], $size['height'], $id]);
        }
        else {
            $name = text($body['name'] ?? '');
            $parent = array_key_exists('parent', $body) ? (empty($body['parent']) ? null : positiveId($body['parent'])) : ($row['parent_id'] === null ? null : (int) $row['parent_id']);
            if ($parent !== ($row['parent_id'] === null ? null : (int) $row['parent_id'])) {
                validateParent($parent, (int) $row['project_id'], $id);
                if ($row['parent_id'] !== null) query("DELETE FROM card_links WHERE source_id=? AND target_id=?", [$row['parent_id'], $id]);
                if ($parent !== null) putLink($owner, ['source' => $parent, 'target' => $id]);
            }
            query('UPDATE cards SET name=?,parent_id=?,x=?,y=?,version=version+1 WHERE id=?', [$name, $parent, $point['x'], $point['y'], $id]);
            if ($row['kind'] === 'record') {
                if (isset($body['document'])) saveDocument($id, $body['document']);
                elseif (query('SELECT 1 FROM card_documents WHERE card_id=?', [$id])->fetch()) fail(409, 'Обновите Memo, чтобы сохранить визуальный документ.');
                else saveContent($id, $body['content'] ?? []);
            }
        }
        touchCard($id);
        return cardOutput(cardRow($id, $owner));
    });
}
