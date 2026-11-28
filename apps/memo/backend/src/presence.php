<?php
declare(strict_types=1);
namespace Memo;

function boardCursors(int $project, int $actor, array $body): array
{
    $client = $body['clientId'] ?? null;
    if (!is_string($client) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $client)) {
        fail(422, 'Некорректный идентификатор вкладки.');
    }
    $folder = folderId($body['folder'] ?? null);
    $cursor = isset($body['cursor']) ? coordinates($body['cursor']) : null;
    project($project, $actor);
    validateFolder($folder, $project, $actor);
    session_write_close();

    if ($cursor === null) {
        query('DELETE FROM board_cursors WHERE project_id=? AND user_id=? AND client_id=?',
            [$project, $actor, $client]);
    } else {
        query('INSERT INTO board_cursors(project_id,user_id,client_id,folder_id,x,y,expires_at)
            VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP(6) + INTERVAL 4 SECOND)
            ON DUPLICATE KEY UPDATE folder_id=VALUES(folder_id),x=VALUES(x),y=VALUES(y),expires_at=VALUES(expires_at)',
            [$project, $actor, $client, $folder ?? 0, $cursor['x'], $cursor['y']]);
        query('DELETE FROM board_cursors WHERE project_id=? AND expires_at <= CURRENT_TIMESTAMP(6) LIMIT 32', [$project]);
    }
    $rows = query('SELECT presence.user_id,presence.client_id,presence.x,presence.y,u.email
        FROM board_cursors presence
        JOIN projects p ON p.id=presence.project_id
        JOIN users u ON u.id=presence.user_id
        WHERE presence.project_id=? AND presence.folder_id=? AND presence.user_id<>?
        AND presence.expires_at > CURRENT_TIMESTAMP(6)
        AND (p.owner_id=presence.user_id OR EXISTS (
            SELECT 1 FROM project_members m WHERE m.project_id=presence.project_id AND m.user_id=presence.user_id))
        ORDER BY presence.expires_at DESC LIMIT 32', [$project, $folder ?? 0, $actor])->fetchAll();
    return array_map(static fn(array $row): array => [
        'id' => $row['client_id'], 'user' => (int) $row['user_id'],
        'name' => explode('@', $row['email'], 2)[0],
        'point' => ['x' => (float) $row['x'], 'y' => (float) $row['y']],
    ], $rows);
}
