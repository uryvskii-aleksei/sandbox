<?php

declare(strict_types=1);

final class RequestError extends RuntimeException
{
}

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function database(): PDO
{
    $root = realpath($_SERVER['DOCUMENT_ROOT']);
    if ($root === false) {
        throw new RuntimeException('Document root not found');
    }
    $requested = getenv('WAVE_DB_PATH') ?: dirname($root) . '/wave-data/wave.sqlite3';
    $directory = realpath(dirname($requested));
    if (
        $directory === false || $directory === $root ||
        str_starts_with($directory, rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)
    ) {
        throw new RuntimeException('Private database directory not configured');
    }
    $path = $directory . DIRECTORY_SEPARATOR . basename($requested);
    if (is_link($path)) {
        throw new RuntimeException('Database file must not be a symlink');
    }
    umask(0077);
    $db = new PDO('sqlite:' . $path);
    $db->exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    $db->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ratings (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            clip_id TEXT NOT NULL,
            value INTEGER NOT NULL CHECK (value IN (-1, 1)),
            PRIMARY KEY (user_id, clip_id)
        );
        CREATE TABLE IF NOT EXISTS auth_attempts (
            client TEXT NOT NULL,
            bucket INTEGER NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (client, bucket)
        );'
    );
    return $db;
}

function knownClips(): array
{
    return array_column(json_decode(file_get_contents(__DIR__ . '/catalog.json'), true, 512, JSON_THROW_ON_ERROR), 'id');
}

function throttleAuth(PDO $db): void
{
    $bucket = intdiv(time(), 900);
    $client = hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    $db->prepare('DELETE FROM auth_attempts WHERE bucket < ?')->execute([$bucket - 1]);
    $attempt = $db->prepare(
        'INSERT INTO auth_attempts (client, bucket, count) VALUES (?, ?, 1)
         ON CONFLICT (client, bucket) DO UPDATE SET count = count + 1 WHERE count < 12'
    );
    $attempt->execute([$client, $bucket]);
    if ($attempt->rowCount() === 0) {
        throw new RequestError('Слишком много попыток. Попробуйте через 15 минут.', 429);
    }
}

function readBody(): array
{
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($type !== 'application/json') {
        throw new RequestError('Ожидается запрос JSON.', 415);
    }
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if (strlen($raw) > 8192) {
        throw new RequestError('Запрос слишком большой.', 413);
    }
    try {
        $body = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RequestError('Некорректный запрос.', 400);
    }
    if (!is_array($body)) {
        throw new RequestError('Некорректный запрос.', 400);
    }
    return $body;
}

function sessionState(?PDO $db = null): array
{
    $ratings = [];
    if (isset($_SESSION['user_id'])) {
        $db ??= database();
        $query = $db->prepare('SELECT clip_id, value FROM ratings WHERE user_id = ?');
        $query->execute([$_SESSION['user_id']]);
        $ratings = $query->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    return [
        'username' => $_SESSION['username'] ?? null,
        'ratings' => (object) $ratings,
        'csrf' => $_SESSION['csrf'],
    ];
}

function rotateSession(array $state): void
{
    if (!session_regenerate_id(true)) {
        throw new RuntimeException('Could not rotate session');
    }
    $_SESSION = $state + ['csrf' => bin2hex(random_bytes(32))];
}

function authenticate(PDO $db, array $body, bool $register): void
{
    $login = $body['login'] ?? null;
    $password = $body['password'] ?? null;
    if (!is_string($login) || !is_string($password)) {
        throw new RequestError('Укажите имя пользователя и пароль.', 400);
    }
    $login = strtolower(trim($login));
    if (!preg_match('/^[a-z0-9_]{3,24}$/D', $login)) {
        throw new RequestError('Имя должно содержать от 3 до 24 латинских букв, цифр или знаков подчёркивания.', 400);
    }
    if (strlen($password) > 72 || str_contains($password, "\0") || $password === '') {
        throw new RequestError('Пароль должен занимать не больше 72 байт.', 400);
    }
    if ($register && preg_match_all('/./us', $password) < 12) {
        throw new RequestError('В пароле должно быть не меньше 12 символов.', 400);
    }

    throttleAuth($db);
    if (!$register) {
        $query = $db->prepare('SELECT id, password_hash FROM users WHERE username = ?');
        $query->execute([$login]);
        $user = $query->fetch(PDO::FETCH_ASSOC);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            throw new RequestError('Имя пользователя или пароль не совпадают.', 401);
        }
    }
    $hash = $register ? password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]) : null;

    $db->beginTransaction();
    try {
        if ($register) {
            $query = $db->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?) ON CONFLICT (username) DO NOTHING');
            $query->execute([$login, $hash]);
            if ($query->rowCount() === 0) {
                throw new RequestError('Это имя уже занято.', 409);
            }
        }
        $id = $register ? (int) $db->lastInsertId() : (int) $user['id'];
        $ratings = $body['ratings'] ?? [];
        if (is_array($ratings) && $ratings !== []) {
            $insert = $db->prepare(
                'INSERT INTO ratings (user_id, clip_id, value) VALUES (?, ?, ?) ON CONFLICT (user_id, clip_id) DO NOTHING'
            );
            foreach (knownClips() as $clip) {
                if (in_array($ratings[$clip] ?? null, [-1, 1], true)) {
                    $insert->execute([$id, $clip, $ratings[$clip]]);
                }
            }
        }
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    rotateSession(['user_id' => $id, 'username' => $login]);
}

function rate(PDO $db, array $body): void
{
    $clip = $body['id'] ?? null;
    $value = $body['value'] ?? null;
    if (!in_array($clip, knownClips(), true) || !in_array($value, [-1, 0, 1], true)) {
        throw new RequestError('Некорректная оценка клипа.', 400);
    }
    $id = $_SESSION['user_id'];
    if ($value === 0) {
        $db->prepare('DELETE FROM ratings WHERE user_id = ? AND clip_id = ?')->execute([$id, $clip]);
    } else {
        $db->prepare(
            'INSERT INTO ratings (user_id, clip_id, value) VALUES (?, ?, ?)
             ON CONFLICT (user_id, clip_id) DO UPDATE SET value = excluded.value'
        )->execute([$id, $clip, $value]);
    }
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        throw new RequestError('Метод недоступен.', 405);
    }

    session_name('wave_session');
    session_start([
        'use_only_cookies' => true,
        'use_strict_mode' => true,
        'cookie_httponly' => true,
        'cookie_secure' => PHP_SAPI !== 'cli-server',
        'cookie_samesite' => 'Strict',
        'cookie_path' => '/wave/',
    ]);
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));

    if ($method === 'GET') {
        respond(sessionState());
    }

    $body = readBody();
    $csrf = $body['csrf'] ?? null;
    if (!is_string($csrf) || !hash_equals($_SESSION['csrf'], $csrf)) {
        throw new RequestError('Сессия обновилась. Попробуйте ещё раз.', 403);
    }
    $action = $body['action'] ?? null;
    switch ($action) {
        case 'login':
        case 'register':
            $db = database();
            authenticate($db, $body, $action === 'register');
            respond(sessionState($db));
        case 'logout':
            rotateSession([]);
            respond(sessionState());
        case 'rate':
            if (!isset($_SESSION['user_id'])) {
                throw new RequestError('Войдите, чтобы сохранить оценку в аккаунте.', 401);
            }
            $db = database();
            rate($db, $body);
            respond(sessionState($db));
        default:
            throw new RequestError('Неизвестное действие.', 400);
    }
} catch (RequestError $error) {
    respond(['error' => $error->getMessage()], $error->getCode());
} catch (Throwable $error) {
    error_log('Wave API: ' . get_class($error));
    respond(['error' => 'Аккаунт временно недоступен. Попробуйте позже.'], 503);
}
