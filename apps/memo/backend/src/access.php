<?php
declare(strict_types=1);
namespace Memo;

function projectAccess(string $alias): string
{
    return "($alias.owner_id=? OR EXISTS (SELECT 1 FROM project_members membership WHERE membership.project_id=$alias.id AND membership.user_id=?))";
}

function memberAccount(int $user): int
{
    // Прежняя регистрация не проверяет почту. Доступ участника требует входа по ссылке из почты.
    return ($_SESSION['verified_email_user'] ?? null) === $user ? $user : 0;
}

function requireProjectOwner(array $project): void
{
    if ($project['access'] !== 'owner') fail(403, 'Это действие доступно владельцу проекта.');
}

function lockProject(int $id): void
{
    query('SELECT id FROM projects WHERE id=? FOR UPDATE', [$id])->fetchColumn();
}
