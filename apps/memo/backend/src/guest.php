<?php
declare(strict_types=1);
namespace Memo;

function guestList(mixed $value): array
{
    if (!is_array($value) || !array_is_list($value)) fail(422, 'Некорректное гостевое полотно.');
    foreach ($value as $item) {
        if (!is_array($item)) fail(422, 'Некорректный элемент гостевого полотна.');
    }
    return $value;
}

function requireGuestDag(array $incoming, array $outgoing, string $message): void
{
    $ready = array_keys($incoming, 0, true);
    $visited = 0;
    while ($ready) {
        $source = array_pop($ready);
        $visited++;
        foreach ($outgoing[$source] ?? [] as $target) {
            if (--$incoming[$target] === 0) $ready[] = $target;
        }
    }
    if ($visited !== count($incoming)) fail(422, $message);
}

function importGuestProject(int $owner, array $body): array
{
    if (!isset($body['requestId'])) fail(422, 'Укажите идентификатор переноса.');
    return receipted($owner, 'import-guest', $body, static function () use ($owner, $body): array {
        $name = text($body['name'] ?? '');
        $cards = [];
        foreach (guestList($body['cards'] ?? null) as $card) {
            $id = positiveId($card['id'] ?? null);
            $kind = $card['kind'] ?? 'record';
            if (isset($cards[$id]) || !in_array($kind, ['record', 'folder'], true)) fail(422, 'Некорректная карточка.');
            $cards[$id] = [
                'kind' => $kind, 'name' => text($card['name'] ?? ''),
                'folder' => folderId($card['folder'] ?? null),
                'point' => coordinates($card['coordinates'] ?? null),
                'size' => cardSize($card['size'] ?? null),
                'autoHeight' => cardAutoHeight($card['autoHeight'] ?? true),
                'document' => $kind === 'record' ? ($card['document'] ?? null) : null,
            ];
        }
        $incoming = array_fill_keys(array_keys($cards), 0);
        $folderOutgoing = [];
        $folderIncoming = $incoming;
        foreach ($cards as $id => $card) {
            $parent = $card['folder'];
            if ($parent === null) continue;
            if (($cards[$parent]['kind'] ?? null) !== 'folder') fail(422, 'Папка гостевой карточки не найдена.');
            $folderOutgoing[$parent][] = $id;
            $folderIncoming[$id]++;
        }
        requireGuestDag($folderIncoming, $folderOutgoing, 'Гостевые папки образуют цикл.');

        $links = [];
        $outgoing = [];
        foreach (guestList($body['links'] ?? null) as $link) {
            $source = positiveId($link['source'] ?? null);
            $target = positiveId($link['target'] ?? null);
            if (!isset($cards[$source], $cards[$target]) || isset($links[$source][$target])) fail(422, 'Некорректная связь гостевого полотна.');
            $links[$source][$target] = text($link['label'] ?? '', 128, true);
            $outgoing[$source][] = $target;
            $incoming[$target]++;
        }
        requireGuestDag($incoming, $outgoing, 'Гостевые связи образуют цикл.');

        query('INSERT INTO projects(public_id,owner_id,name) VALUES(?,?,?)', [newPublicId(), $owner, $name]);
        $projectId = (int) database()->lastInsertId();
        $map = [];
        foreach ($cards as $id => $card) {
            query('INSERT INTO cards(public_id,project_id,kind,name,x,y,width,height,auto_height) VALUES(?,?,?,?,?,?,?,?,?)',
                [newPublicId(),$projectId,$card['kind'],$card['name'],$card['point']['x'],$card['point']['y'],
                    $card['size']['width'],$card['size']['height'],(int) $card['autoHeight']]);
            $map[$id] = (int) database()->lastInsertId();
            if ($card['document'] !== null) saveDocument($map[$id], $card['document']);
        }
        foreach ($cards as $id => $card) {
            if ($card['folder'] !== null) query('UPDATE cards SET folder_id=? WHERE id=?', [$map[$card['folder']], $map[$id]]);
        }
        foreach ($links as $source => $targets) {
            foreach ($targets as $target => $label) {
                query('INSERT INTO card_links(source_id,target_id,label) VALUES(?,?,?)', [$map[$source], $map[$target], $label]);
                query('UPDATE cards SET parent_id=COALESCE(parent_id,?) WHERE id=?', [$map[$source], $map[$target]]);
            }
        }
        foreach (guestList($body['marks'] ?? null) as $mark) {
            $folder = folderId($mark['folder'] ?? null);
            if ($folder !== null && ($cards[$folder]['kind'] ?? null) !== 'folder') fail(422, 'Папка гостевой разметки не найдена.');
            storeBoardMark($projectId, $folder === null ? null : $map[$folder], $mark);
        }
        return project($projectId, $owner);
    });
}
