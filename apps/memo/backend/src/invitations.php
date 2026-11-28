<?php
declare(strict_types=1);
namespace Memo;

function inviteEmail(mixed $value): string
{
    $email = strtolower(text($value, 254));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'Укажите действительный email.');
    return $email;
}

function inviteToProject(int $projectId, array $sender, array $body): void
{
    $email = inviteEmail($body['email'] ?? '');
    $token = bin2hex(random_bytes(32));
    $name = ownedTransaction($sender['id'], static function () use ($projectId, $sender, $email, $token): string {
        $project = project($projectId, $sender['id'], true);
        if ($project['inbox']) fail(422, 'Проект «Входящие» доступен только владельцу.');
        $ownerEmail = query('SELECT u.email FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=?', [$projectId])->fetchColumn();
        if ($email === $sender['email'] || $email === $ownerEmail) fail(422, 'У этого адреса уже есть доступ.');
        $limit = (int) query('SELECT COUNT(*) FROM email_links WHERE sender_id=? AND created_at > CURRENT_TIMESTAMP - INTERVAL 1 HOUR', [$sender['id']])->fetchColumn();
        if ($limit >= 20) fail(429, 'Слишком много приглашений. Попробуйте позже.');
        storeEmailLink($email, $token, $projectId, $sender['id']);
        return $project['name'];
    });
    deliverEmailLink($email, $token, $name);
}

function requestEmailLogin(mixed $address): void
{
    $email = inviteEmail($address);
    $lastRequest = (int) ($_SESSION['email_login_requested'] ?? 0);
    if ($lastRequest > time() - 30) fail(429, 'Подождите полминуты перед повторной отправкой.');
    $_SESSION['email_login_requested'] = time();
    $id = query('SELECT id FROM users WHERE email=?', [$email])->fetchColumn();
    if ($id === false) return;
    $token = bin2hex(random_bytes(32));
    $issued = ownedTransaction((int) $id, static function () use ($email, $token): bool {
        if (query('SELECT 1 FROM email_links WHERE email=? AND project_id IS NULL AND created_at > CURRENT_TIMESTAMP - INTERVAL 2 MINUTE LIMIT 1', [$email])->fetch()) return false;
        storeEmailLink($email, $token);
        return true;
    });
    if ($issued) {
        try {
            deliverEmailLink($email, $token);
        } catch (HttpError $error) {
            // Отклик формы входа одинаков для существующего и неизвестного адреса.
            error_log('Memo email login delivery failed: ' . $error->status);
        }
    }
}

function storeEmailLink(string $email, string $token, ?int $project = null, ?int $sender = null): void
{
    $lifetime = $project === null ? '15 MINUTE' : '7 DAY';
    query("INSERT INTO email_links(token_hash,email,project_id,sender_id,expires_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP + INTERVAL $lifetime)",
        [hash('sha256', $token), $email, $project, $sender]);
}

function deliverEmailLink(string $email, string $token, ?string $project = null): void
{
    $config = config();
    $base = rtrim($config['MEMO_PUBLIC_URL'], '/');
    $url = parse_url($base);
    $local = $config['APP_ENV'] !== 'production' && in_array($url['host'] ?? '', ['127.0.0.1', 'localhost'], true);
    if (!isset($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) ||
        (($url['scheme'] ?? '') !== 'https' && (!$local || ($url['scheme'] ?? '') !== 'http'))) {
        fail(503, 'Почта Memo пока не настроена.');
    }
    $link = "$base/email-link#token=$token";
    $subject = $project === null ? 'Вход в Memo' : 'Приглашение в проект Memo';
    $action = $project === null ? 'Войти в Memo' : 'Принять приглашение';
    $escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $details = $project === null ? 'Ссылка действует 15 минут.' : 'Вас пригласили в проект «' . $escape($project) . '» с правом редактирования. Ссылка действует 7 дней.';
    $html = '<!doctype html><html lang="ru"><meta charset="utf-8"><body style="font:16px sans-serif;color:#13294e"><p>' . $details
        . '</p><p><a style="display:inline-block;background:#1f408a;padding:12px 18px;color:#fff;border-radius:6px;text-decoration:none" href="'
        . $escape($link) . '">' . $action . '</a></p></body></html>';
    $capture = $config['MEMO_MAIL_DIRECTORY'];
    if ($config['APP_ENV'] !== 'production' && $capture !== '') {
        if ((!is_dir($capture) && !@mkdir($capture, 0700, true) && !is_dir($capture)) ||
            @file_put_contents(rtrim($capture, '/') . '/' . hash('sha256', $token) . '.html', $html, LOCK_EX) === false) {
            fail(502, 'Не удалось сохранить письмо для локальной отладки.');
        }
        return;
    }

    $from = $config['MEMO_MAIL_FROM'];
    if (!filter_var($from, FILTER_VALIDATE_EMAIL) || !preg_match('/^[a-zA-Z0-9._%+@-]+$/D', $from)) fail(503, 'Почта Memo пока не настроена.');
    $headers = ['From' => "Memo <$from>", 'MIME-Version' => '1.0', 'Content-Type' => 'text/html; charset=UTF-8'];
    if (!mail($email, '=?UTF-8?B?' . base64_encode($subject) . '?=', $html, $headers, '-f' . $from)) {
        fail(502, 'Не удалось отправить письмо. Попробуйте ещё раз.');
    }
}

function redeemEmailLink(mixed $value): array
{
    if (!is_string($value) || !preg_match('/^[a-f0-9]{64}$/D', $value)) fail(422, 'Некорректная ссылка.');
    $hash = hash('sha256', $value);
    $signedIn = currentUser();
    $pdo = database();
    $pdo->beginTransaction();
    try {
        $link = query('SELECT * FROM email_links WHERE token_hash=? AND expires_at > CURRENT_TIMESTAMP FOR UPDATE', [$hash])->fetch();
        $sessionEmail = $signedIn === null ? null : strtolower($signedIn['email']);
        if (!$link || ($link['used_at'] !== null &&
            ($signedIn === null || memberAccount($signedIn['id']) !== $signedIn['id'] || $link['email'] !== $sessionEmail))) {
            fail(410, 'Ссылка использована или истекла. Запросите новую.');
        }
        if ($sessionEmail !== null && $sessionEmail !== $link['email']) fail(409, 'Ссылка предназначена другому аккаунту. Выйдите из Memo или откройте письмо в приватном окне.');
        $project = null;
        if ($link['project_id'] !== null) {
            $email = $link['email'];
            if ($link['used_at'] === null) query('INSERT INTO users(email,password_hash) VALUES(?,NULL) ON DUPLICATE KEY UPDATE id=id', [$email]);
            $user = (int) query('SELECT id FROM users WHERE email=?', [$email])->fetchColumn();
            $sender = (int) $link['sender_id'];
            // Проверяем текущее участие автора приглашения независимо от сессии получателя.
            $target = query('SELECT p.id,p.public_id FROM projects p LEFT JOIN project_details d ON d.project_id=p.id
                WHERE p.id=? AND d.deleted_at IS NULL AND ' . projectAccess('p') . ' FOR UPDATE',
                [$link['project_id'], $sender, $sender])->fetch();
            if (!$target) fail(410, 'Приглашение больше недоступно.');
            $project = ['id' => (int) $target['id'], 'publicId' => ensurePublicId('projects', $target)];
            if ($link['used_at'] === null) {
                query('INSERT INTO project_members(project_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE user_id=user_id', [$project['id'], $user]);
            } elseif (!query('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', [$project['id'], $user])->fetch()) {
                fail(410, 'Ссылка использована или истекла. Запросите новую.');
            }
        } else {
            $user = (int) query('SELECT id FROM users WHERE email=?', [$link['email']])->fetchColumn();
            if (!$user) fail(410, 'Ссылка использована или истекла. Запросите новую.');
        }
        if ($link['used_at'] === null) query('UPDATE email_links SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?', [$hash]);
        $pdo->commit();
    } catch (\Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    return startUserSession($user, true) + ['project' => $project['publicId'] ?? null];
}
