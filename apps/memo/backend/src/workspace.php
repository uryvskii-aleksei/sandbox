<?php
declare(strict_types=1);
namespace Memo;

function ownedTransaction(int $owner, callable $work): mixed
{
    database()->beginTransaction();
    try {
        // Один порядок блокировок для связей, карточек, корзины и создания входящих.
        query('SELECT id FROM users WHERE id=? FOR UPDATE', [$owner]);
        $result = $work();
        database()->commit();
        return $result;
    } catch (\Throwable $error) {
        if (database()->inTransaction()) database()->rollBack();
        throw $error;
    }
}

function receipted(int $owner, string $operation, array $body, callable $work): mixed
{
    return ownedTransaction($owner, static function () use ($owner, $operation, $body, $work) {
        $key = $body['requestId'] ?? null;
        if ($key === null) return $work();
        if (!is_string($key) || !preg_match('/^[a-zA-Z0-9-]{16,64}$/', $key)) fail(422, 'Некорректный идентификатор операции.');
        $hash = hash('sha256', json_encode($body, JSON_THROW_ON_ERROR));
        $old = query('SELECT * FROM request_receipts WHERE owner_id=? AND request_id=?', [$owner, $key])->fetch();
        if ($old) {
            if ($old['operation'] !== $operation || !hash_equals($old['payload_hash'], $hash)) fail(409, 'Идентификатор операции уже использован.');
            return json_decode($old['response_json'], true, 64, JSON_THROW_ON_ERROR);
        }
        $result = $work();
        // Для сохранения достаточно последней квитанции. Старую версию защищает 409.
        if (str_starts_with($operation, 'save:') || str_starts_with($operation, 'position:')) {
            query('DELETE FROM request_receipts WHERE owner_id=? AND operation=?', [$owner, $operation]);
        }
        query('INSERT INTO request_receipts(owner_id,request_id,operation,payload_hash,response_json) VALUES(?,?,?,?,?)',
            [$owner, $key, $operation, $hash, json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        return $result;
    });
}

function projectList(int $owner, bool $trash = false): array
{
    $deleted = $trash ? 'IS NOT NULL' : 'IS NULL';
    $order = $trash ? 'p.id DESC' : 'COALESCE(p.updated_at,p.created_at) DESC,p.id DESC';
    $rows = query("SELECT p.id,p.public_id,p.name,COALESCE(d.inbox,0) AS inbox,d.deleted_at,
        (SELECT COUNT(*) FROM cards c LEFT JOIN card_details cd ON cd.card_id=c.id WHERE c.project_id=p.id AND cd.deleted_at IS NULL) AS cards
        FROM projects p LEFT JOIN project_details d ON d.project_id=p.id
        WHERE p.owner_id=? AND d.deleted_at $deleted ORDER BY COALESCE(d.inbox,0) DESC,$order", [$owner])->fetchAll();
    return array_map(static fn(array $row): array => ['id' => (int) $row['id'], 'publicId' => ensurePublicId('projects', $row), 'name' => $row['name'],
        'inbox' => (bool) $row['inbox'], 'deletedAt' => $row['deleted_at'], 'cards' => (int) $row['cards']], $rows);
}

function inboxProject(int $owner): int
{
    $row = query('SELECT p.id FROM projects p JOIN project_details d ON d.project_id=p.id WHERE p.owner_id=? AND d.inbox=1', [$owner])->fetch();
    if ($row) return (int) $row['id'];
    query('INSERT INTO projects(public_id,owner_id,name) VALUES(?,?,?)', [newPublicId(), $owner, 'Входящие']);
    $id = (int) database()->lastInsertId();
    query('INSERT INTO project_details(project_id,inbox) VALUES(?,1)', [$id]);
    return $id;
}

function touchProject(int $id): void
{
    query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP(6) WHERE id=?', [$id]);
}

function touchCardProject(int $id): void
{
    query('UPDATE projects p JOIN cards c ON c.project_id=p.id SET p.updated_at=CURRENT_TIMESTAMP(6) WHERE c.id=?', [$id]);
}

function touchCard(int $id): void
{
    query('INSERT INTO card_details(card_id) VALUES(?) ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP(6)', [$id]);
    touchCardProject($id);
}

function folderId(mixed $value): ?int
{
    return $value === null ? null : positiveId($value);
}

function validateFolder(?int $folder, int $project, int $owner): void
{
    if ($folder === null) return;
    $row = cardRow($folder, $owner);
    if ($row['kind'] !== 'folder' || (int) $row['project_id'] !== $project) fail(422, 'Выберите папку этого проекта.');
}

function projectFolders(int $project): array
{
    $rows = query("SELECT c.id,c.public_id,c.name,c.folder_id FROM cards c LEFT JOIN card_details d ON d.card_id=c.id
        WHERE c.project_id=? AND c.kind='folder' AND d.deleted_at IS NULL ORDER BY c.name,c.id", [$project])->fetchAll();
    return array_map(static fn(array $row): array => ['id' => (int) $row['id'], 'publicId' => ensurePublicId('cards', $row), 'name' => $row['name'],
        'folder' => folderId($row['folder_id'])], $rows);
}

function moveCardToBoard(array $row, int $owner, array $body): void
{
    $project = positiveId($body['project'] ?? null);
    $folder = folderId($body['folder'] ?? null);
    project($project, $owner);
    if ((int) ($body['version'] ?? 0) !== (int) $row['version']) fail(409, 'Карточка изменилась. Сначала обновите её.');
    validateFolder($folder, $project, $owner);
    if ($row['kind'] === 'folder') {
        if ($project !== (int) $row['project_id']) fail(422, 'Папки можно перемещать только внутри проекта.');
        $ancestors = [];
        for ($current = $folder; $current !== null; $current = folderId(cardRow($current, $owner)['folder_id'])) {
            if ($current === (int) $row['id'] || isset($ancestors[$current])) fail(422, 'Папку нельзя поместить внутрь самой себя.');
            $ancestors[$current] = true;
        }
    }
    if ($project === (int) $row['project_id'] && $folder === folderId($row['folder_id'])) return;
    if ($folder !== null) {
        requireLinkedSelection($owner, (int) $row['project_id'], folderId($row['folder_id']), [(int) $row['id']]);
    }
    $point = nextCardPosition($project, $folder);
    query('UPDATE cards SET project_id=?,folder_id=?,x=?,y=?,version=version+1 WHERE id=?',
        [$project, $folder, $point['x'], $point['y'], $row['id']]);
    touchCard((int) $row['id']);
    if ($project !== (int) $row['project_id']) touchProject((int) $row['project_id']);
}

function requireLinkedSelection(int $owner, int $project, ?int $folder, array $selectedIds): void
{
    if (!$selectedIds) return;
    $selected = array_fill_keys($selectedIds, true);
    $local = array_fill_keys(query('SELECT id FROM cards WHERE project_id=? AND folder_id <=> ?', [$project, $folder])->fetchAll(\PDO::FETCH_COLUMN), true);
    foreach (linkRows($owner) as $link) {
        $source = $link['source'];
        $target = $link['target'];
        if (isset($local[$source], $local[$target]) && (isset($selected[$source]) !== isset($selected[$target]))) {
            fail(409, 'Для переноса в папку выделите всю группу связанных карточек на этом полотне.');
        }
    }
}

function moveBoardSelection(int $project, int $owner, array $body): array
{
    if (!isset($body['requestId'])) fail(422, 'Укажите идентификатор операции.');
    return receipted($owner, 'move-selection:' . $project, $body, static function () use ($project, $owner, $body): array {
        project($project, $owner);
        $folder = folderId($body['folder'] ?? null);
        validateFolder($folder, $project, $owner);
        $cards = $body['cards'] ?? [];
        $marks = $body['marks'] ?? [];
        if (!is_array($cards) || !array_is_list($cards) || !is_array($marks) || !array_is_list($marks) || (!$cards && !$marks)) {
            fail(422, 'Выберите элементы на полотне.');
        }
        $cardRows = [];
        foreach ($cards as $card) {
            if (!is_array($card)) fail(422, 'Укажите карточку и её версию.');
            $id = positiveId($card['id'] ?? null);
            $row = cardRow($id, $owner);
            if ((int) $row['project_id'] !== $project || folderId($row['folder_id']) !== $folder) fail(409, 'Карточка уже на другом полотне.');
            if (($card['version'] ?? null) !== (int) $row['version']) fail(409, 'Карточка изменилась. Сначала обновите полотно.');
            $cardRows[$id] = $row;
        }
        $markRows = [];
        foreach (array_unique(array_map(__NAMESPACE__ . '\\positiveId', $marks)) as $id) {
            $row = query('SELECT * FROM board_marks WHERE id=? AND project_id=? AND folder_id <=> ?', [$id, $project, $folder])->fetch();
            if (!$row) fail(409, 'Элемент разметки уже на другом полотне.');
            $markRows[$id] = $row;
        }

        $destination = $folder;
        if (array_key_exists('destination', $body)) {
            $destination = positiveId($body['destination']);
            $destinationRow = cardRow($destination, $owner);
            if ($destinationRow['kind'] !== 'folder' || (int) $destinationRow['project_id'] !== $project ||
                folderId($destinationRow['folder_id']) !== $folder || isset($cardRows[$destination])) {
                fail(422, 'Выберите другую папку на текущем полотне.');
            }
            requireLinkedSelection($owner, $project, $folder, array_keys($cardRows));
            $left = INF;
            $top = INF;
            foreach (array_merge($cardRows, $markRows) as $row) {
                $left = min($left, (float) $row['x'], (float) ($row['end_x'] ?? $row['x']));
                $top = min($top, (float) $row['y'], (float) ($row['end_y'] ?? $row['y']));
            }
            $bottom = query('SELECT MAX(bottom) FROM (
                SELECT c.y+c.height AS bottom FROM cards c LEFT JOIN card_details d ON d.card_id=c.id
                WHERE c.project_id=? AND c.folder_id=? AND d.deleted_at IS NULL
                UNION ALL SELECT GREATEST(y, COALESCE(end_y,y)) FROM board_marks WHERE project_id=? AND folder_id=?
            ) AS contents', [$project, $destination, $project, $destination])->fetchColumn();
            $offset = ['x' => 80 - $left, 'y' => max(0, (float) $bottom) + 80 - $top];
        } else {
            $offset = coordinates($body['offset'] ?? null);
        }
        $shift = static fn($x, $y): array => array_values(coordinates(['x' => (float) $x + $offset['x'], 'y' => (float) $y + $offset['y']]));
        $savedCards = [];
        foreach ($cardRows as $id => $row) {
            [$x, $y] = $shift($row['x'], $row['y']);
            query('UPDATE cards SET folder_id=?,x=?,y=?,version=version+1 WHERE id=?', [$destination, $x, $y, $id]);
            touchCard($id);
            $savedCards[] = cardOutput(cardRow($id, $owner));
        }
        $savedMarks = [];
        foreach ($markRows as $id => $row) {
            [$x, $y] = $shift($row['x'], $row['y']);
            [$endX, $endY] = $row['end_x'] === null ? [null, null] : $shift($row['end_x'], $row['end_y']);
            query('UPDATE board_marks SET folder_id=?,x=?,y=?,end_x=?,end_y=? WHERE id=?', [$destination, $x, $y, $endX, $endY, $id]);
            $savedMarks[] = boardMarkOutput(query('SELECT * FROM board_marks WHERE id=?', [$id])->fetch());
        }
        if ($savedMarks && !$savedCards) touchProject($project);
        return ['cards' => $savedCards, 'marks' => $savedMarks];
    });
}

function nextCardPosition(int $projectId, ?int $folder = null): array
{
    $points = query('SELECT c.x,c.y,c.width,c.height FROM cards c LEFT JOIN card_details d ON d.card_id=c.id WHERE c.project_id=? AND c.folder_id <=> ? AND d.deleted_at IS NULL', [$projectId, $folder])->fetchAll();
    $columnStep = 386;
    $rowStep = 385;
    $columns = (int) floor((100000 - 80) / $columnStep);
    $rows = (int) floor((100000 - 80) / $rowStep);
    $occupied = [];
    foreach ($points as $point) {
        $left = max(0, (int) floor(((float) $point['x'] - $columnStep - 80) / $columnStep) + 1);
        $right = min($columns, (int) ceil(((float) $point['x'] + $point['width'] + 60 - 80) / $columnStep) - 1);
        $top = max(0, (int) ceil(((float) $point['y'] - 310 - 80) / $rowStep));
        $bottom = min($rows, (int) floor(((float) $point['y'] + $point['height'] + 60 - 80) / $rowStep));
        for ($row = $top; $row <= $bottom; $row++) for ($column = $left; $column <= $right; $column++) $occupied[$row * ($columns + 1) + $column] = true;
    }
    // Заполняем по три колонки, затем следующий блок. Координаты остаются допустимыми.
    for ($band = 0; $band <= $columns; $band += 3) for ($row = 0; $row <= $rows; $row++) for ($column = $band; $column <= min($columns, $band + 2); $column++) {
        if (!isset($occupied[$row * ($columns + 1) + $column])) return ['x' => 80 + $column * $columnStep, 'y' => 80 + $row * $rowStep];
    }
    fail(422, 'На полотне нет свободного места. Создайте другой проект.');
}

function linkRows(int $owner, bool $includeDeleted = false): array
{
    $visible = $includeDeleted ? '' : ' AND sd.deleted_at IS NULL AND td.deleted_at IS NULL AND spd.deleted_at IS NULL AND tpd.deleted_at IS NULL';
    $rows = query('SELECT l.*,s.name AS source_name,t.name AS target_name,s.project_id AS source_project,t.project_id AS target_project
        FROM card_links l JOIN cards s ON s.id=l.source_id JOIN cards t ON t.id=l.target_id
        JOIN projects sp ON sp.id=s.project_id JOIN projects tp ON tp.id=t.project_id
        LEFT JOIN card_details sd ON sd.card_id=s.id LEFT JOIN card_details td ON td.card_id=t.id
        LEFT JOIN project_details spd ON spd.project_id=sp.id LEFT JOIN project_details tpd ON tpd.project_id=tp.id
        WHERE sp.owner_id=? AND tp.owner_id=?' . $visible . ' ORDER BY l.source_id,l.target_id', [$owner, $owner])->fetchAll();
    return array_map(static fn(array $row): array => ['source' => (int) $row['source_id'], 'target' => (int) $row['target_id'],
        'label' => $row['label'], 'sourceName' => $row['source_name'], 'targetName' => $row['target_name'],
        'sourceProject' => (int) $row['source_project'], 'targetProject' => (int) $row['target_project']], $rows);
}

function validateLink(int $owner, int $source, int $target): void
{
    cardRow($source, $owner); cardRow($target, $owner);
    if ($source === $target) fail(422, 'Нельзя связать карточку с самой собой.');
    $outgoing = [];
    // Учитываем также корзину: восстановление не должно возвращать цикл.
    foreach (linkRows($owner, true) as $link) {
        $outgoing[$link['source']][] = $link['target'];
    }
    $pending = [$target]; $visited = [];
    while ($pending) {
        $id = array_pop($pending);
        if ($id === $source) fail(422, 'Эта связь создаёт цикл в дереве.');
        if (isset($visited[$id])) continue;
        $visited[$id] = true;
        foreach ($outgoing[$id] ?? [] as $next) $pending[] = $next;
    }
}

function putLink(int $owner, array $body): array
{
    $source = positiveId($body['source'] ?? null); $target = positiveId($body['target'] ?? null);
    validateLink($owner, $source, $target);
    $label = text($body['label'] ?? '', 128, true);
    $previous = query('SELECT label FROM card_links WHERE source_id=? AND target_id=?', [$source, $target])->fetch();
    query('INSERT INTO card_links(source_id,target_id,label) VALUES(?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)', [$source, $target, $label]);
    query('UPDATE cards SET parent_id=COALESCE(parent_id,?) WHERE id=?', [$source, $target]);
    if (!$previous || $previous['label'] !== $label) {
        query('UPDATE cards SET version=version+1 WHERE id=?', [$target]);
        touchCard($target);
        touchCardProject($source);
    }
    return array_values(array_filter(linkRows($owner), static fn(array $link): bool => $link['source'] === $source && $link['target'] === $target))[0];
}

function deleteLink(int $owner, array $body): void
{
    $source = positiveId($body['source'] ?? null); $target = positiveId($body['target'] ?? null);
    cardRow($source, $owner); cardRow($target, $owner);
    $deleted = query('DELETE FROM card_links WHERE source_id=? AND target_id=?', [$source, $target])->rowCount();
    $next = query('SELECT source_id FROM card_links WHERE target_id=? ORDER BY source_id LIMIT 1', [$target])->fetchColumn();
    query('UPDATE cards SET parent_id=? WHERE id=?', [$next === false ? null : (int) $next, $target]);
    if ($deleted > 0) {
        query('UPDATE cards SET version=version+1 WHERE id=?', [$target]);
        touchCard($target);
        touchCardProject($source);
    }
}

function rewireLink(int $owner, array $body): array
{
    if (!isset($body['requestId'])) fail(422, 'Укажите идентификатор операции.');
    return receipted($owner, 'rewire-link', $body, static function () use ($owner, $body): array {
        $source = positiveId($body['source'] ?? null); $target = positiveId($body['target'] ?? null);
        $newSource = positiveId($body['newSource'] ?? null); $newTarget = positiveId($body['newTarget'] ?? null);
        cardRow($source, $owner); cardRow($target, $owner);
        $previous = query('SELECT label FROM card_links WHERE source_id=? AND target_id=? FOR UPDATE', [$source, $target])->fetch();
        if (!$previous) fail(404, 'Связь не найдена.');
        if ($source === $newSource && $target === $newTarget) {
            return array_values(array_filter(linkRows($owner), static fn(array $link): bool => $link['source'] === $source && $link['target'] === $target))[0];
        }
        query('DELETE FROM card_links WHERE source_id=? AND target_id=?', [$source, $target]);
        // Проверяем граф без старой пары. Ошибка откатывает удаление, квитанция появится только после успеха.
        validateLink($owner, $newSource, $newTarget);
        if (query('SELECT 1 FROM card_links WHERE source_id=? AND target_id=?', [$newSource, $newTarget])->fetch()) fail(409, 'Между этими карточками уже есть связь.');
        query('INSERT INTO card_links(source_id,target_id,label) VALUES(?,?,?)', [$newSource, $newTarget, $previous['label']]);
        foreach (array_unique([$target, $newTarget]) as $id) {
            $row = cardRow($id, $owner);
            // Сохраняем совместимого основного родителя, пока соответствующая связь существует.
            $parent = query('SELECT source_id FROM card_links WHERE target_id=? ORDER BY (source_id=?) DESC,source_id LIMIT 1', [$id, $row['parent_id'] ?? 0])->fetchColumn();
            query('UPDATE cards SET parent_id=?,version=version+1 WHERE id=?', [$parent === false ? null : (int) $parent, $id]);
            touchCard($id);
        }
        touchCardProject($source);
        if ($newSource !== $source) touchCardProject($newSource);
        return array_values(array_filter(linkRows($owner), static fn(array $link): bool => $link['source'] === $newSource && $link['target'] === $newTarget))[0];
    });
}

function captureCard(int $owner, array $body): array
{
    return receipted($owner, 'capture', $body, static function () use ($owner, $body): array {
        $projectId = isset($body['project']) ? positiveId($body['project']) : inboxProject($owner);
        project($projectId, $owner);
        $folder = folderId($body['folder'] ?? null);
        validateFolder($folder, $projectId, $owner);
        $kind = $body['kind'] ?? 'record';
        if (!in_array($kind, ['record', 'folder'], true)) fail(422, 'Неизвестный тип блока.');
        $parent = empty($body['parent']) ? null : positiveId($body['parent']);
        validateParent($parent, $projectId, null);
        $note = text($body['text'] ?? '', 20000, true);
        $firstLine = preg_split('/\R/u', $note)[0] ?? '';
        $shortTitle = implode('', array_slice(preg_split('//u', $firstLine, -1, PREG_SPLIT_NO_EMPTY), 0, 128));
        $name = text($body['name'] ?? $shortTitle, 128, true);
        if ($name === '') $name = $kind === 'folder' ? 'Новая папка' : 'Новая запись';
        $point = isset($body['coordinates']) ? coordinates($body['coordinates']) : nextCardPosition($projectId, $folder);
        query('INSERT INTO cards(public_id,project_id,folder_id,kind,name,x,y) VALUES(?,?,?,?,?,?,?)', [newPublicId(), $projectId, $folder, $kind, $name, $point['x'], $point['y']]);
        $id = (int) database()->lastInsertId();
        $content = $body['content'] ?? [['id' => -1, 'name' => 'Заметка', 'fields' => [
            ['id' => -1, 'type' => 'textarea', 'title' => '', 'value' => [$note]],
        ]]];
        if ($kind === 'record') {
            saveContent($id, $content);
            if (isset($body['document'])) saveDocument($id, $body['document']);
        }
        touchCard($id);
        if ($parent !== null) putLink($owner, ['source' => $parent, 'target' => $id]);
        return cardOutput(cardRow($id, $owner));
    });
}

function copyBoardCard(int $source, int $owner, array $body): array
{
    return receipted($owner, 'copy-card:' . $source, $body, static function () use ($source, $owner, $body): array {
        $root = cardRow($source, $owner);
        $project = positiveId($body['project'] ?? null);
        $folder = folderId($body['folder'] ?? null);
        project($project, $owner);
        validateFolder($folder, $project, $owner);
        $point = coordinates($body['coordinates'] ?? null);
        $children = [];
        if ($root['kind'] === 'folder') {
            $rows = query('SELECT c.* FROM cards c LEFT JOIN card_details d ON d.card_id=c.id
                WHERE c.project_id=? AND c.folder_id IS NOT NULL AND d.deleted_at IS NULL ORDER BY c.id',
                [$root['project_id']])->fetchAll();
            foreach ($rows as $row) $children[$row['folder_id']][] = $row;
        }
        $copies = [];
        $pending = [$root];
        for ($index = 0; $index < count($pending); $index++) {
            $row = $pending[$index];
            $original = (int) $row['id'];
            if (isset($copies[$original])) continue;
            $top = $original === $source;
            $destination = $top ? $folder : $copies[$row['folder_id']];
            query('INSERT INTO cards(public_id,project_id,folder_id,kind,name,x,y,width,height,auto_height) VALUES(?,?,?,?,?,?,?,?,?,?)',
                [newPublicId(), $project, $destination, $row['kind'], $row['name'], $top ? $point['x'] : $row['x'],
                    $top ? $point['y'] : $row['y'], $row['width'], $row['height'], $row['auto_height']]);
            $id = (int) database()->lastInsertId();
            $copies[$original] = $id;
            touchCard($id);
            query('INSERT INTO card_documents(card_id,document,search_text)
                SELECT ?,document,search_text FROM card_documents WHERE card_id=?', [$id, $original]);
            foreach (query('SELECT * FROM field_groups WHERE card_id=? ORDER BY sort_order,id', [$original])->fetchAll() as $group) {
                query('INSERT INTO field_groups(card_id,name,sort_order,collapsed) VALUES(?,?,?,?)',
                    [$id, $group['name'], $group['sort_order'], $group['collapsed']]);
                $groupId = (int) database()->lastInsertId();
                query('INSERT INTO fields(group_id,type,title,values_json,sort_order)
                    SELECT ?,type,title,values_json,sort_order FROM fields WHERE group_id=? ORDER BY sort_order,id',
                    [$groupId, $group['id']]);
            }
            if ($row['kind'] === 'folder') {
                query('INSERT INTO board_marks(project_id,folder_id,kind,label,label_scale,x,y,end_x,end_y)
                    SELECT ?,?,kind,label,label_scale,x,y,end_x,end_y FROM board_marks WHERE folder_id=?',
                    [$project, $id, $original]);
                foreach ($children[$original] ?? [] as $child) $pending[] = $child;
            }
        }
        if (count($copies) > 1) {
            // Связи между копиями повторяют рёбра исходного ациклического графа.
            foreach (linkRows($owner) as $link) {
                if (!isset($copies[$link['source']], $copies[$link['target']])) continue;
                $from = $copies[$link['source']];
                $to = $copies[$link['target']];
                query('INSERT INTO card_links(source_id,target_id,label) VALUES(?,?,?)', [$from, $to, $link['label']]);
                query('UPDATE cards SET parent_id=COALESCE(parent_id,?) WHERE id=?', [$from, $to]);
            }
        }
        return cardOutput(cardRow($copies[$source], $owner));
    });
}

function searchCards(int $owner): array
{
    $term = text($_GET['q'] ?? '', 128, true);
    $filter = $_GET['filter'] ?? 'all';
    if (!in_array($filter, ['all', 'pinned', 'recent', 'inbox', 'rediscover'], true)) fail(422, 'Неизвестный фильтр.');
    $where = ''; $params = [$owner];
    if ($term !== '') {
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $term) . '%';
        $where .= " AND (c.name LIKE ? ESCAPE '!' OR cd.search_text LIKE ? ESCAPE '!' OR (cd.card_id IS NULL AND EXISTS(SELECT 1 FROM field_groups g LEFT JOIN fields f ON f.group_id=g.id WHERE g.card_id=c.id AND (g.name LIKE ? ESCAPE '!' OR f.title LIKE ? ESCAPE '!' OR f.values_json LIKE ? ESCAPE '!'))))";
        array_push($params, $like, $like, $like, $like, $like);
    }
    if ($filter === 'pinned') $where .= ' AND d.pinned=1';
    if ($filter === 'inbox') $where .= ' AND pd.inbox=1';
    $order = $filter === 'recent' ? '(d.opened_at IS NOT NULL) DESC,COALESCE(d.opened_at,d.updated_at,p.created_at) DESC,c.id DESC' : 'COALESCE(d.updated_at,p.created_at) DESC,c.id DESC';
    if ($filter === 'rediscover') $order = 'COALESCE(d.opened_at,d.updated_at,p.created_at) ASC,c.id ASC';
    $rows = query('SELECT c.* FROM cards c JOIN projects p ON p.id=c.project_id
        LEFT JOIN card_details d ON d.card_id=c.id LEFT JOIN project_details pd ON pd.project_id=p.id LEFT JOIN card_documents cd ON cd.card_id=c.id
        WHERE p.owner_id=? AND d.deleted_at IS NULL AND pd.deleted_at IS NULL' . $where . ' ORDER BY ' . $order . ' LIMIT 101', $params)->fetchAll();
    return ['cards' => array_map(__NAMESPACE__ . '\\cardOutput', array_slice($rows, 0, 100)), 'hasMore' => count($rows) > 100];
}

function templateProject(int $owner, array $body): array
{
    $name = text($body['name'] ?? '');
    $template = text($body['template'] ?? 'blank', 16);
    if (!in_array($template, ['blank', 'family', 'outline', 'retro', 'tasks'], true)) fail(422, 'Неизвестный шаблон.');
    return receipted($owner, 'create-project', $body, static function () use ($owner, $name, $template): array {
        query('INSERT INTO projects(public_id,owner_id,name,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP(6))', [newPublicId(), $owner, $name]);
        $projectId = (int) database()->lastInsertId();
        $nodes = match ($template) {
            'family' => [['Родитель 1', 40, 60, 'Имя, даты жизни и воспоминания.'], ['Родитель 2', 420, 60, 'Имя, даты жизни и воспоминания.'], ['Ребёнок', 230, 360, 'Замените примеры участниками вашей семьи.']],
            'outline' => [['Тема', 280, 40, 'Главная мысль конспекта.'], ['Основные идеи', 0, 350, 'Запишите ключевые тезисы.'], ['Источники', 300, 350, 'Ссылки и материалы.'], ['Вопросы', 600, 350, 'Что хочется изучить дальше?']],
            'retro' => [['Что мешало', 110, 225, 'Что стоит изменить в следующий раз?'], ['Что получилось', 720, 225, 'Что помогло и что стоит повторить?'], ['Что было ожидаемо', 1030, 225, 'Что прошло по плану?'], ['Следующие шаги', 110, 764, 'Действие, ответственный и срок.']],
            'tasks' => [['Собрать требования', 40, 145, 'Опишите результат и укажите срок.'], ['Подготовить черновик', 360, 145, 'Запишите текущий шаг.'], ['Согласовать план', 680, 145, 'Укажите результат или ссылку.']],
            default => [],
        };
        $ids = [];
        foreach ($nodes as [$title, $x, $y, $note]) {
            query('INSERT INTO cards(public_id,project_id,name,x,y) VALUES(?,?,?,?,?)', [newPublicId(), $projectId, $title, $x, $y]);
            $id = (int) database()->lastInsertId(); $ids[] = $id;
            saveContent($id, [['id' => -1, 'name' => $template === 'family' ? 'О человеке' : 'Заметка', 'fields' => [['id' => -1, 'type' => 'textarea', 'value' => [$note]]]]]);
            touchCard($id);
        }
        $pairs = match ($template) {
            'family' => [[0, 2], [1, 2]],
            'outline' => [[0, 1], [0, 2], [0, 3]],
            default => [],
        };
        foreach ($pairs as [$source, $target]) putLink($owner, ['source' => $ids[$source], 'target' => $ids[$target]]);
        if ($template === 'retro') {
            $frames = [
                [$name, 40, 95, 1370, 1000],
                ['Плохо', 76, 175, 654, 650],
                ['Хорошо', 686, 175, 1334, 650],
                ['Что будем делать?', 76, 730, 1334, 964],
            ];
            foreach ($frames as [$label, $left, $top, $right, $bottom]) {
                insertBoardMark($projectId, null, 'square', ['x' => $left, 'y' => $top], ['x' => $right, 'y' => $bottom], $label);
            }
        } elseif ($template === 'tasks') {
            foreach (['Сделать', 'В работе', 'Готово'] as $index => $label) {
                $x = $index * 320;
                insertBoardMark($projectId, null, 'label', ['x' => $x + 40, 'y' => 40], null, $label);
                if ($index > 0) insertBoardMark($projectId, null, 'line', ['x' => $x, 'y' => 40], ['x' => $x, 'y' => 620], '');
            }
        }
        return project($projectId, $owner) + ['cards' => count($ids)];
    });
}

function trashContents(int $owner): array
{
    $rows = query('SELECT c.* FROM cards c JOIN projects p ON p.id=c.project_id JOIN card_details d ON d.card_id=c.id
        LEFT JOIN project_details pd ON pd.project_id=p.id WHERE p.owner_id=? AND d.deleted_at IS NOT NULL AND pd.deleted_at IS NULL ORDER BY d.deleted_at DESC,c.id DESC', [$owner])->fetchAll();
    return ['cards' => array_map(__NAMESPACE__ . '\\cardOutput', $rows), 'projects' => projectList($owner, true)];
}

function trashCard(array $card): void
{
    if ($card['kind'] === 'folder' && query('SELECT c.id FROM cards c LEFT JOIN card_details d ON d.card_id=c.id WHERE c.project_id=? AND c.folder_id=? AND d.deleted_at IS NULL LIMIT 1', [$card['project_id'], $card['id']])->fetch()) {
        fail(409, 'Сначала переместите или удалите элементы внутри папки.');
    }
    query('INSERT INTO card_details(card_id,deleted_at) VALUES(?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE deleted_at=CURRENT_TIMESTAMP', [$card['id']]);
    touchProject((int) $card['project_id']);
}

function trashBoardSelection(int $projectId, int $owner, array $body): void
{
    receipted($owner, 'trash-selection:' . $projectId, $body, static function () use ($projectId, $owner, $body): array {
        project($projectId, $owner);
        $folder = folderId($body['folder'] ?? null);
        validateFolder($folder, $projectId, $owner);
        $cards = $body['cards'] ?? [];
        $marks = $body['marks'] ?? [];
        if (!is_array($cards) || !array_is_list($cards) || !is_array($marks) || !array_is_list($marks) || (!$cards && !$marks)) {
            fail(422, 'Выберите элементы на полотне.');
        }
        foreach (array_unique(array_map(__NAMESPACE__ . '\\positiveId', $cards)) as $id) {
            $card = cardRow($id, $owner);
            if ((int) $card['project_id'] !== $projectId || folderId($card['folder_id']) !== $folder) fail(404, 'Карточка уже на другом полотне.');
            trashCard($card);
        }
        foreach (array_unique(array_map(__NAMESPACE__ . '\\positiveId', $marks)) as $id) {
            $deleted = query('DELETE FROM board_marks WHERE id=? AND project_id=? AND folder_id <=> ?', [$id, $projectId, $folder]);
            if (!$deleted->rowCount()) fail(404, 'Элемент разметки уже недоступен.');
        }
        if ($marks && !$cards) touchProject($projectId);
        return [];
    });
}

function exportProject(int $id, int $owner): array
{
    $project = project($id, $owner);
    $cards = array_map(__NAMESPACE__ . '\\cardOutput', query('SELECT c.* FROM cards c LEFT JOIN card_details d ON d.card_id=c.id WHERE c.project_id=? AND d.deleted_at IS NULL ORDER BY c.id', [$id])->fetchAll());
    $links = array_values(array_filter(linkRows($owner), static fn(array $link): bool => $link['sourceProject'] === $id || $link['targetProject'] === $id));
    $media = [];
    $values = [];
    foreach ($cards as $card) {
        foreach ($card['content'] as $group) foreach ($group['fields'] as $field) array_push($values, ...$field['value']);
        if (isset($card['document'])) {
            array_walk_recursive($card['document'], static function ($value, $key) use (&$values): void {
                if (in_array($key, ['src', 'href'], true)) $values[] = $value;
            });
        }
    }
    foreach ($values as $value) {
        if (preg_match('~/api/media/([a-f0-9]{32})$~', $value, $match) && !isset($media[$match[1]])) {
            $file = query('SELECT filename,mime,content FROM media WHERE id=? AND owner_id=?', [$match[1], $owner])->fetch();
            if ($file) $media[$match[1]] = ['url' => $value, 'filename' => $file['filename'], 'mime' => $file['mime'], 'base64' => base64_encode($file['content'])];
        }
    }
    return ['format' => 'memo-project', 'version' => 1, 'exportedAt' => gmdate('c'), 'project' => $project,
        'cards' => $cards, 'links' => $links, 'media' => array_values($media),
        'marks' => array_map(static fn(array $row): array => boardMarkOutput($row) + ['folder' => folderId($row['folder_id'])],
            query('SELECT m.* FROM board_marks m LEFT JOIN card_details d ON d.card_id=m.folder_id WHERE m.project_id=? AND d.deleted_at IS NULL ORDER BY m.id', [$id])->fetchAll())];
}

function boardMarkOutput(array $row): array
{
    return ['id' => (int) $row['id'], 'kind' => $row['kind'], 'at' => ['x' => (float) $row['x'], 'y' => (float) $row['y']],
        ...($row['kind'] !== 'label'
            ? ['end' => ['x' => (float) $row['end_x'], 'y' => (float) $row['end_y']],
                ...($row['kind'] !== 'line' && $row['label'] !== '' ? ['text' => $row['label']] : [])]
            : ['text' => $row['label'], 'scale' => (float) $row['label_scale']])];
}

function validateMarkGeometry(string $kind, array $at, array $end): void
{
    $width = abs($end['x'] - $at['x']);
    $height = abs($end['y'] - $at['y']);
    if ($kind === 'line') {
        if (hypot($width, $height) < 1) fail(422, 'У линии должны быть разные начало и конец.');
    } elseif ($width < 1 || $height < 1) {
        fail(422, 'У фигуры должны быть положительные ширина и высота.');
    } elseif ($kind === 'circle' && abs($width - $height) > 0.001) {
        fail(422, 'У круга должны быть одинаковые ширина и высота.');
    }
}

function createBoardMark(int $project, int $owner, array $body): array
{
    return receipted($owner, 'board-mark:' . $project, $body, static function () use ($project, $owner, $body): array {
        project($project, $owner);
        $folder = folderId($body['folder'] ?? null);
        validateFolder($folder, $project, $owner);
        return storeBoardMark($project, $folder, $body);
    });
}

function storeBoardMark(int $project, ?int $folder, array $body): array
{
    $at = coordinates($body['at'] ?? null);
    $kind = $body['kind'] ?? '';
    if (!in_array($kind, ['label', 'line', 'square', 'circle'], true)) fail(422, 'Неизвестный элемент полотна.');
    $end = $kind === 'label' ? null : coordinates($body['end'] ?? null);
    if ($end) validateMarkGeometry($kind, $at, $end);
    $label = $kind === 'line' ? '' : text($body['text'] ?? '', 128, $kind !== 'label');
    $scale = $body['scale'] ?? 1;
    if ($kind === 'label' && ((!is_float($scale) && !is_int($scale)) || !is_finite($scale) || $scale < 0.4 || $scale > 4)) fail(422, 'Недопустимый размер подписи.');
    return insertBoardMark($project, $folder, $kind, $at, $end, $label, $kind === 'label' ? $scale : 1);
}

function insertBoardMark(int $project, ?int $folder, string $kind, array $at, ?array $end, string $label, float $scale = 1): array
{
    query('INSERT INTO board_marks(project_id,folder_id,kind,label,label_scale,x,y,end_x,end_y) VALUES(?,?,?,?,?,?,?,?,?)',
        [$project, $folder, $kind, $label, $scale, $at['x'], $at['y'], $end['x'] ?? null, $end['y'] ?? null]);
    $id = (int) database()->lastInsertId();
    touchProject($project);
    return boardMarkOutput(query('SELECT * FROM board_marks WHERE id=?', [$id])->fetch());
}

function changeBoardMark(int $id, int $owner, ?array $body): ?array
{
    return ownedTransaction($owner, static function () use ($id, $owner, $body): ?array {
        $row = query('SELECT m.* FROM board_marks m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND p.owner_id=?', [$id, $owner])->fetch();
        if (!$row) {
            if ($body === null) return null;
            fail(404, 'Элемент полотна не найден.');
        }
        $project = (int) $row['project_id'];
        project($project, $owner);
        validateFolder(folderId($row['folder_id']), $project, $owner);
        if ($body === null) {
            query('DELETE FROM board_marks WHERE id=?', [$id]);
            touchProject($project);
            return null;
        }
        $mark = boardMarkOutput($row);
        $at = array_key_exists('at', $body) ? coordinates($body['at']) : $mark['at'];
        $end = $mark['end'] ?? null;
        if (array_key_exists('end', $body)) {
            if ($row['kind'] === 'label') fail(422, 'У подписи одна точка размещения.');
            $end = coordinates($body['end']);
        }
        if ($end) validateMarkGeometry($row['kind'], $at, $end);
        if (array_key_exists('text', $body)) {
            if ($row['kind'] === 'line') fail(422, 'У линии нет подписи.');
            $row['label'] = text($body['text'], 128, $row['kind'] !== 'label');
        }
        if (array_key_exists('scale', $body)) {
            $scale = $body['scale'];
            if ($row['kind'] !== 'label' || (!is_float($scale) && !is_int($scale)) || !is_finite($scale) || $scale < 0.4 || $scale > 4) fail(422, 'Недопустимый размер подписи.');
            $row['label_scale'] = $scale;
        }
        query('UPDATE board_marks SET label=?,label_scale=?,x=?,y=?,end_x=?,end_y=? WHERE id=?',
            [$row['label'], $row['label_scale'], $at['x'], $at['y'], $end['x'] ?? null, $end['y'] ?? null, $id]);
        touchProject($project);
        return boardMarkOutput(query('SELECT * FROM board_marks WHERE id=?', [$id])->fetch());
    });
}
