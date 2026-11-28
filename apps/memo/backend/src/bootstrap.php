<?php
declare(strict_types=1);

namespace Memo;

use PDO;
use RuntimeException;

final class HttpError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function fail(int $status, string $message): never
{
    throw new HttpError($status, $message);
}

function config(): array
{
    static $config;
    if ($config !== null) return $config;
    $file = getenv('MEMO_CONFIG') ?: getenv('MIND_ASSISTANT_CONFIG') ?: dirname(__DIR__) . '/config.local.php';
    $local = is_file($file) ? require $file : [];
    $config = [];
    foreach (['DB_HOST' => 'db', 'DB_PORT' => '3306', 'DB_NAME' => 'mindassistant',
        'DB_USER' => 'mindassistant', 'DB_PASSWORD' => '', 'APP_ENV' => 'production',
        'MEMO_PUBLIC_URL' => '', 'MEMO_MAIL_FROM' => '', 'MEMO_MAIL_DIRECTORY' => ''] as $key => $default) {
        $value = getenv($key);
        $config[$key] = $value !== false ? $value : ($local[$key] ?? $default);
    }
    return $config;
}

function database(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) return $pdo;
    $cfg = config();
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $cfg['DB_NAME'])) throw new RuntimeException('Invalid database name');
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['DB_HOST'], (int) $cfg['DB_PORT'], $cfg['DB_NAME']);
    $pdo = new PDO($dsn, $cfg['DB_USER'], $cfg['DB_PASSWORD'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function query(string $sql, array $values = []): \PDOStatement
{
    $statement = database()->prepare($sql);
    $statement->execute($values);
    return $statement;
}

function jsonBody(): array
{
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) fail(415, 'Нужен JSON-запрос.');
    $raw = file_get_contents('php://input', false, null, 0, 1048577);
    if ($raw === false || strlen($raw) > 1048576) fail(413, 'Слишком большой запрос.');
    try { $body = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
    catch (\JsonException) { fail(400, 'Некорректный JSON.'); }
    if (!is_array($body) || !str_starts_with(ltrim($raw), '{')) fail(400, 'Ожидается объект.');
    return $body;
}

function text(mixed $value, int $maximum = 128, bool $empty = false): string
{
    if (!is_string($value) || !preg_match('//u', $value)) fail(422, 'Некорректный текст.');
    $value = trim($value);
    preg_match_all('/./us', $value, $characters);
    if ((!$empty && $value === '') || count($characters[0]) > $maximum) fail(422, 'Проверьте длину текста.');
    return $value;
}

function newPublicId(): string
{
    return 'm' . bin2hex(random_bytes(16));
}

function ensurePublicId(string $table, array $row): string
{
    if ($row['public_id'] !== null) return $row['public_id'];
    // Предыдущий релиз может создать строку без ID во время переключения или после отката.
    $id = newPublicId();
    if (query("UPDATE $table SET public_id=? WHERE id=? AND public_id IS NULL", [$id, $row['id']])->rowCount()) return $id;
    $existing = query("SELECT public_id FROM $table WHERE id=? FOR UPDATE", [$row['id']])->fetchColumn();
    if (!is_string($existing)) fail(404, 'Запись не найдена.');
    return $existing;
}

function positiveId(mixed $value): int
{
    $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4294967295]]);
    if ($id === false) fail(422, 'Некорректный идентификатор.');
    return $id;
}

function coordinates(mixed $value): array
{
    if (!is_array($value)) fail(422, 'Укажите положение карточки.');
    $result = [];
    foreach (['x', 'y'] as $key) {
        $number = $value[$key] ?? null;
        if ((!is_int($number) && !is_float($number)) || !is_finite((float) $number) || abs($number) > 100000) fail(422, 'Некорректные координаты.');
        $result[$key] = (float) $number;
    }
    return $result;
}

function startSession(): void
{
    session_name('mind_assistant');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/',
        'secure' => config()['APP_ENV'] === 'production', 'httponly' => true, 'samesite' => 'Lax']);
    ini_set('session.use_strict_mode', '1');
    session_start();
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}

function checkCsrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf'], $token)) {
        header('X-Memo-CSRF-Expired: 1');
        fail(403, 'Сессия формы устарела. Повторите действие.');
    }
}

function currentUser(): ?array
{
    if (!isset($_SESSION['user'])) return null;
    $user = query('SELECT id,email FROM users WHERE id=?', [$_SESSION['user']])->fetch();
    return $user ? ['id' => (int) $user['id'], 'email' => $user['email']] : null;
}

function requireUser(): array
{
    return currentUser() ?? fail(401, 'Войдите в аккаунт.');
}

function startUserSession(int $user, bool $emailVerified = false): array
{
    session_regenerate_id(true);
    $_SESSION = ['user' => $user, 'csrf' => bin2hex(random_bytes(32))];
    if ($emailVerified) $_SESSION['verified_email_user'] = $user;
    return ['user' => currentUser(), 'csrfToken' => $_SESSION['csrf']];
}

function respond(mixed $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}
