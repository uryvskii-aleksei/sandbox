<?php
declare(strict_types=1);
namespace Memo;

ini_set('display_errors', '0');
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/cards.php';
require_once __DIR__ . '/workspace.php';
require_once __DIR__ . '/preview.php';

function route(): never
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    startSession();
    $method = $_SERVER['REQUEST_METHOD'];
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
    $path = preg_replace('~^.*?/api(?:/|$)~', '/', $path);
    if (!in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) fail(405, 'Метод не поддерживается.');
    if ($method !== 'GET') checkCsrf();
    if ($method === 'GET' && $path === '/health') { query('SELECT 1'); respond(['status' => 'ready']); }
    if ($method === 'GET' && $path === '/session') respond(['user' => currentUser(), 'csrfToken' => $_SESSION['csrf']]);

    if ($method === 'POST' && in_array($path, ['/auth/register', '/auth/login'], true)) {
        $body = jsonBody();
        $email = strtolower(text($body['email'] ?? '', 254));
        $password = $body['password'] ?? '';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !is_string($password) || strlen($password) < 8 || strlen($password) > 72) fail(422, 'Укажите email и пароль от 8 до 72 байт.');
        $attempts = (int) ($_SESSION['login_attempts'] ?? 0);
        if (($_SESSION['login_since'] ?? 0) < time() - 900) { $attempts = 0; $_SESSION['login_since'] = time(); }
        if ($attempts >= 15) fail(429, 'Слишком много попыток. Попробуйте через 15 минут.');
        $_SESSION['login_attempts'] = $attempts + 1;
        if ($path === '/auth/register') {
            if (query('SELECT id FROM users WHERE email=?', [$email])->fetch()) fail(409, 'Такой email уже зарегистрирован.');
            try { query('INSERT INTO users(email,password_hash) VALUES(?,?)', [$email, password_hash($password, PASSWORD_DEFAULT)]); }
            catch (\PDOException $error) { if ($error->getCode() === '23000') fail(409, 'Такой email уже зарегистрирован.'); throw $error; }
            $id = (int) database()->lastInsertId();
        } else {
            $user = query('SELECT * FROM users WHERE email=?', [$email])->fetch();
            if (!$user || !password_verify($password, $user['password_hash'])) fail(401, 'Неверный email или пароль.');
            $id = (int) $user['id'];
        }
        session_regenerate_id(true); $_SESSION['user'] = $id; $_SESSION['login_attempts'] = 0;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['user' => currentUser(), 'csrfToken' => $_SESSION['csrf']]);
    }
    if ($method === 'POST' && $path === '/auth/logout') {
        $_SESSION = ['csrf' => bin2hex(random_bytes(32))]; session_regenerate_id(true);
        respond(['user' => null, 'csrfToken' => $_SESSION['csrf']]);
    }
    $user = requireUser(); $owner = $user['id'];
    if ($path === '/search' && $method === 'GET') respond(searchCards($owner));
    if ($path === '/trash' && $method === 'GET') respond(trashContents($owner));
    if ($path === '/capture' && $method === 'POST') respond(captureCard($owner, jsonBody()), 201);
    if ($path === '/links') {
        if ($method === 'GET') respond(linkRows($owner));
        if ($method === 'PUT') {
            $body = jsonBody(); respond(ownedTransaction($owner, static fn(): array => putLink($owner, $body)));
        }
        if ($method === 'PATCH') respond(rewireLink($owner, jsonBody()));
        if ($method === 'DELETE') {
            $body = jsonBody(); ownedTransaction($owner, static fn() => deleteLink($owner, $body)); respond(null);
        }
    }
    if ($path === '/projects' && $method === 'GET') {
        respond(projectList($owner));
    }
    if ($path === '/projects' && $method === 'POST') {
        $body = jsonBody();
        respond(templateProject($owner, text($body['name'] ?? ''), text($body['template'] ?? 'blank', 16)), 201);
    }
    if (preg_match('~^/projects/(\d+)/(restore|export)$~', $path, $match)) {
        $id = positiveId($match[1]);
        if ($match[2] === 'export' && $method === 'GET') respond(exportProject($id, $owner));
        if ($match[2] === 'restore' && $method === 'POST') {
            respond(ownedTransaction($owner, static function () use ($id, $owner): array {
                if (!query('SELECT id FROM projects WHERE id=? AND owner_id=?', [$id, $owner])->fetch()) fail(404, 'Проект не найден.');
                query('UPDATE project_details SET deleted_at=NULL WHERE project_id=?', [$id]);
                return project($id, $owner);
            }));
        }
    }
    if (preg_match('~^/projects/(\d+)$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        if ($method === 'PATCH') { $body = jsonBody(); query('UPDATE projects SET name=? WHERE id=? AND owner_id=?', [text($body['name'] ?? ''), $id, $owner]); respond(project($id, $owner)); }
        if ($method === 'DELETE') {
            ownedTransaction($owner, static function () use ($id, $owner): void {
                $current = project($id, $owner);
                if ($current['inbox']) fail(422, 'Входящие нельзя удалить. Переместите или удалите отдельные записи.');
                query('INSERT INTO project_details(project_id,deleted_at) VALUES(?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE deleted_at=CURRENT_TIMESTAMP', [$id]);
            }); respond(null);
        }
        if ($method === 'GET') respond(project($id, $owner));
    }
    if ($method === 'GET' && preg_match('~^/projects/(\d+)/folders$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        respond(projectFolders($id));
    }
    if (preg_match('~^/projects/(\d+)/marks$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        if ($method === 'POST') respond(createBoardMark($id, $owner, jsonBody()), 201);
        if ($method === 'GET') {
            $folder = ($_GET['folder'] ?? 'root') === 'root' ? null : folderId($_GET['folder']);
            validateFolder($folder, $id, $owner);
            respond(array_map(__NAMESPACE__ . '\\boardMarkOutput', query('SELECT * FROM board_marks WHERE project_id=? AND folder_id <=> ? ORDER BY id', [$id, $folder])->fetchAll()));
        }
    }
    if ($method === 'POST' && preg_match('~^/projects/(\d+)/trash-selection$~', $path, $match)) {
        trashBoardSelection(positiveId($match[1]), $owner, jsonBody());
        respond(null);
    }
    if (preg_match('~^/marks/(\d+)$~', $path, $match) && in_array($method, ['PATCH', 'DELETE'], true)) {
        respond(changeBoardMark(positiveId($match[1]), $owner, $method === 'PATCH' ? jsonBody() : null));
    }
    if (preg_match('~^/projects/(\d+)/cards$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        if ($method === 'GET') {
            $filter = ''; $params = [$id];
            if (isset($_GET['folder'])) {
                $folder = $_GET['folder'] === 'root' ? null : folderId($_GET['folder']);
                validateFolder($folder, $id, $owner);
                $filter = ' AND c.folder_id <=> ?';
                $params[] = $folder;
            }
            respond(array_map(__NAMESPACE__ . '\\cardOutput', query('SELECT c.* FROM cards c LEFT JOIN card_details d ON d.card_id=c.id WHERE c.project_id=? AND d.deleted_at IS NULL' . $filter . ' ORDER BY c.id', $params)->fetchAll()));
        }
        if ($method === 'POST') {
            $body = jsonBody(); $point = coordinates($body['coordinates'] ?? ['x' => 80, 'y' => 80]);
            $parent = empty($body['parent']) ? null : positiveId($body['parent']);
            $created = ownedTransaction($owner, static function () use ($id, $owner, $parent, $point, $body): array {
                project($id, $owner, true); validateParent($parent, $id, null);
                query('INSERT INTO cards(project_id,parent_id,name,x,y) VALUES(?,?,?,?,?)', [$id, $parent, text($body['name'] ?? 'Без имени'), $point['x'], $point['y']]);
                $cardId = (int) database()->lastInsertId();
                if ($parent !== null) putLink($owner, ['source' => $parent, 'target' => $cardId]);
                touchCard($cardId);
                return cardOutput(cardRow($cardId, $owner));
            });
            respond($created, 201);
        }
    }
    if (preg_match('~^/cards/(\d+)/(restore|metadata|visit|move)$~', $path, $match)) {
        $id = positiveId($match[1]); $operation = $match[2];
        if ($method === 'POST') {
            $body = jsonBody();
            respond(ownedTransaction($owner, static function () use ($id, $owner, $operation, $body): array {
                $row = cardRow($id, $owner, $operation === 'restore');
                project((int) $row['project_id'], $owner);
                if ($operation === 'restore') {
                    validateFolder(folderId($row['folder_id']), (int) $row['project_id'], $owner);
                    query('UPDATE card_details SET deleted_at=NULL WHERE card_id=?', [$id]);
                }
                if ($operation === 'metadata') {
                    if (!is_bool($body['pinned'] ?? null)) fail(422, 'Укажите состояние закрепления.');
                    query('INSERT INTO card_details(card_id,pinned) VALUES(?,?) ON DUPLICATE KEY UPDATE pinned=VALUES(pinned)', [$id, (int) $body['pinned']]);
                }
                if ($operation === 'visit') query('INSERT INTO card_details(card_id,opened_at) VALUES(?,CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE opened_at=CURRENT_TIMESTAMP(6)', [$id]);
                if ($operation === 'move') moveCardToBoard($row, $owner, $body);
                return cardOutput(cardRow($id, $owner));
            }));
        }
    }
    if (preg_match('~^/cards/(\d+)(/position)?$~', $path, $match)) {
        $id = positiveId($match[1]);
        $includeDeleted = $method === 'GET' && empty($match[2]) && ($_GET['includeDeleted'] ?? '') === '1';
        $row = cardRow($id, $owner, $includeDeleted);
        if ($method === 'GET' && empty($match[2])) respond(cardOutput($row));
        if ($method === 'PUT' && empty($match[2])) respond(saveCard($id, $owner, jsonBody()));
        if ($method === 'PATCH' && !empty($match[2])) respond(saveCard($id, $owner, jsonBody(), true));
        if ($method === 'DELETE' && empty($match[2])) {
            ownedTransaction($owner, static function () use ($id, $owner): void {
                $card = cardRow($id, $owner);
                trashCard($card);
            }); respond(null);
        }
    }
    if ($method === 'POST' && $path === '/preview') respond(preview(text(jsonBody()['url'] ?? '', 2048)));
    if ($method === 'POST' && $path === '/media') {
        $file = $_FILES['file'] ?? null;
        if (!$file || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 5 * 1024 * 1024) fail(422, 'Выберите файл до 5 МБ.');
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        if (!in_array($mime, ['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/mp4','video/mp4','video/webm'], true)) fail(422, 'Этот тип файла не поддерживается.');
        $id = bin2hex(random_bytes(16));
        query('INSERT INTO media(id,owner_id,filename,mime,content) VALUES(?,?,?,?,?)', [$id, $owner, text(basename($file['name']), 255), $mime, file_get_contents($file['tmp_name'])]);
        $prefix = strstr(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/api/', true) ?: '';
        respond(['url' => $prefix . '/api/media/' . $id], 201);
    }
    if ($method === 'GET' && preg_match('~^/media/([a-f0-9]{32})$~', $path, $match)) {
        $file = query('SELECT mime,content FROM media WHERE id=? AND owner_id=?', [$match[1], $owner])->fetch();
        if (!$file) fail(404, 'Файл не найден.');
        header('Content-Type: ' . $file['mime']); header('Content-Length: ' . strlen($file['content']));
        header('Content-Disposition: inline'); echo $file['content']; exit;
    }
    fail(404, 'Маршрут не найден.');
}

try { route(); }
catch (\Throwable $error) {
    $status = $error instanceof HttpError ? $error->status : 500;
    http_response_code($status);
    if ($status === 500) error_log('Memo request failed: ' . get_class($error));
    echo json_encode(['ok' => false, 'error' => $error instanceof HttpError ? $error->getMessage() : 'Не удалось выполнить запрос.'], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}
