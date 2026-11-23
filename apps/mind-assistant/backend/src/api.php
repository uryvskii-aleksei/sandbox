<?php
declare(strict_types=1);
namespace MindAssistant;

ini_set('display_errors', '0');
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/cards.php';
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
    if ($path === '/projects' && $method === 'GET') {
        $rows = query('SELECT p.id,p.name,COUNT(c.id) AS cards FROM projects p LEFT JOIN cards c ON c.project_id=p.id WHERE p.owner_id=? GROUP BY p.id,p.name ORDER BY p.id DESC', [$owner])->fetchAll();
        respond(array_map(static fn(array $row): array => ['id' => (int) $row['id'], 'name' => $row['name'], 'cards' => (int) $row['cards']], $rows));
    }
    if ($path === '/projects' && $method === 'POST') {
        $body = jsonBody(); query('INSERT INTO projects(owner_id,name) VALUES(?,?)', [$owner, text($body['name'] ?? '')]);
        respond(project((int) database()->lastInsertId(), $owner) + ['cards' => 0], 201);
    }
    if (preg_match('~^/projects/(\d+)$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        if ($method === 'PATCH') { $body = jsonBody(); query('UPDATE projects SET name=? WHERE id=? AND owner_id=?', [text($body['name'] ?? ''), $id, $owner]); respond(project($id, $owner)); }
        if ($method === 'DELETE') { query('DELETE FROM projects WHERE id=? AND owner_id=?', [$id, $owner]); respond(null); }
        if ($method === 'GET') respond(project($id, $owner));
    }
    if (preg_match('~^/projects/(\d+)/cards$~', $path, $match)) {
        $id = positiveId($match[1]); project($id, $owner);
        if ($method === 'GET') respond(array_map(__NAMESPACE__ . '\\cardOutput', query('SELECT * FROM cards WHERE project_id=? ORDER BY id', [$id])->fetchAll()));
        if ($method === 'POST') {
            $body = jsonBody(); $point = coordinates($body['coordinates'] ?? ['x' => 80, 'y' => 80]);
            $parent = empty($body['parent']) ? null : positiveId($body['parent']);
            database()->beginTransaction();
            try {
                project($id, $owner, true); validateParent($parent, $id, null);
                query('INSERT INTO cards(project_id,parent_id,name,x,y) VALUES(?,?,?,?,?)', [$id, $parent, text($body['name'] ?? 'Без имени'), $point['x'], $point['y']]);
                $cardId = (int) database()->lastInsertId(); database()->commit();
            } catch (\Throwable $error) { if (database()->inTransaction()) database()->rollBack(); throw $error; }
            respond(cardOutput(cardRow($cardId, $owner)), 201);
        }
    }
    if (preg_match('~^/cards/(\d+)(/position)?$~', $path, $match)) {
        $id = positiveId($match[1]); cardRow($id, $owner);
        if ($method === 'PUT' && empty($match[2])) respond(saveCard($id, $owner, jsonBody()));
        if ($method === 'PATCH' && !empty($match[2])) respond(saveCard($id, $owner, jsonBody(), true));
        if ($method === 'DELETE' && empty($match[2])) { query('DELETE FROM cards WHERE id=?', [$id]); respond(null); }
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
    if ($status === 500) error_log('MindAssistant request failed: ' . get_class($error));
    echo json_encode(['ok' => false, 'error' => $error instanceof HttpError ? $error->getMessage() : 'Не удалось выполнить запрос.'], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}
