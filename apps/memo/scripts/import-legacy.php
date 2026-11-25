<?php
declare(strict_types=1);
namespace Memo\LegacyImport;

use PDO;
use RuntimeException;

final class ImportError extends RuntimeException {}

function demand(bool $valid, string $message): void
{
    if (!$valid) throw new ImportError($message);
}

function legacyId(mixed $value, bool $sentinel = false): int
{
    demand(is_int($value) && $value <= 2147483647 && $value >= ($sentinel ? -1 : 1), 'Invalid legacy identifier.');
    return $value;
}

/** Числовой json[] в раннем Go-дампе содержит UTF-8 байты всего JSON content. */
function legacyContent(mixed $content): array
{
    if ($content === null || $content === []) return [];
    if (is_array($content) && array_is_list($content) && is_int($content[0] ?? null)) {
        demand(count($content) <= 1048576, 'Legacy byte content is too large.');
        foreach ($content as $byte) demand(is_int($byte) && $byte >= 0 && $byte <= 255, 'Invalid legacy UTF-8 byte content.');
        $content = pack('C*', ...$content);
    }
    if (is_string($content)) {
        try { $content = json_decode($content, true, 64, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw new ImportError('Legacy content is not valid JSON.'); }
    }
    demand(is_array($content) && array_is_list($content) && count($content) <= 30, 'Unsupported legacy content structure.');
    return $content;
}

function ordered(array $items): array
{
    $ordered = [];
    foreach ($items as $index => $item) {
        demand(is_array($item), 'Invalid legacy ordered item.');
        $order = $item['order'] ?? $index;
        demand(is_int($order), 'Invalid legacy order.');
        $ordered[] = ['order' => $order, 'index' => $index, 'item' => $item];
    }
    usort($ordered, fn(array $a, array $b): int => [$a['order'], $a['index']] <=> [$b['order'], $b['index']]);
    return array_column($ordered, 'item');
}

function canonical(mixed $value): mixed
{
    if (!is_array($value)) return $value;
    if (!array_is_list($value)) ksort($value);
    return array_map(__NAMESPACE__ . '\\canonical', $value);
}

/** Сохраняет содержимое без усечения, отказывает при несовместимом контракте. */
function normalize(array $input): array
{
    demand(($input['version'] ?? null) === 1 && ($input['app'] ?? null) === 'mind-assistant-legacy', 'Unsupported legacy payload.');
    demand(is_string($input['sourceSha256'] ?? null) && preg_match('/^[a-f0-9]{64}$/', $input['sourceSha256']) === 1, 'Invalid source dump SHA-256.');
    demand(is_array($input['projects'] ?? null) && array_is_list($input['projects']) && count($input['projects']) > 0 && count($input['projects']) <= 1000, 'Invalid source projects.');
    demand(is_array($input['data'] ?? null) && array_is_list($input['data']) && count($input['data']) <= 5000, 'Invalid source cards.');
    $projects = []; $cards = []; $recovered = []; $orphans = 0; $defaulted = 0; $groupsCount = 0; $fieldsCount = 0; $decoded = 0;
    foreach ($input['projects'] as $row) {
        demand(is_array($row), 'Invalid source project.');
        $id = legacyId($row['id'] ?? null);
        demand(!isset($projects[$id]), 'Duplicate legacy project identifier.');
        $projects[$id] = ['key' => 'legacy:' . $id, 'name' => \Memo\text($row['name'] ?? null)];
    }
    foreach ($input['data'] as $row) {
        demand(is_array($row), 'Invalid source card.');
        $id = legacyId($row['id'] ?? null);
        demand(!isset($cards[$id]), 'Duplicate legacy card identifier.');
        $project = legacyId($row['project'] ?? null, true);
        $projectKey = $projects[$project]['key'] ?? 'recovered:' . $project;
        if (!isset($projects[$project])) {
            $orphans++;
            $recovered[$project] = ['key' => $projectKey, 'name' => $project > 0 ? 'Восстановленный проект ' . $project : 'Восстановленные записи без проекта (legacy ' . $project . ')'];
        }
        $coordinates = $row['coordinates'] ?? null;
        demand(is_array($coordinates) && array_key_exists('x', $coordinates) && array_key_exists('y', $coordinates), 'Missing legacy coordinates.');
        $usedDefault = false;
        foreach (['x', 'y'] as $axis) {
            if ($coordinates[$axis] === '') { $coordinates[$axis] = 0; $usedDefault = true; }
            elseif (is_string($coordinates[$axis]) && is_numeric($coordinates[$axis])) $coordinates[$axis] = (float) $coordinates[$axis];
        }
        if ($usedDefault) $defaulted++;
        $point = \Memo\coordinates($coordinates);
        $parent = legacyId($row['parent'] ?? null, true);
        $content = $row['content'] ?? null;
        if (is_array($content) && is_int($content[0] ?? null)) $decoded++;
        $groups = [];
        foreach (ordered(legacyContent($content)) as $group) {
            $fields = $group['fields'] ?? [];
            demand(is_array($fields) && array_is_list($fields) && count($fields) <= 100, 'Invalid legacy fields.');
            $normalizedFields = [];
            foreach (ordered($fields) as $field) {
                $type = $field['type'] ?? '';
                demand(in_array($type, ['textarea', 'url', 'date', 'image', 'video', 'audio'], true), 'Unsupported legacy field type.');
                $value = $field['value'] ?? [];
                if (is_string($value)) $value = [$value];
                $normalizedFields[] = ['type' => $type, 'title' => \Memo\text($field['title'] ?? '', 128, true), 'value' => \Memo\fieldValue($value, $type)];
                $fieldsCount++;
            }
            $groups[] = ['name' => \Memo\text($group['name'] ?? '', 128, true), 'collapsed' => (bool) ($group['collapsed'] ?? false), 'fields' => $normalizedFields];
            $groupsCount++;
        }
        $cards[$id] = ['legacyId' => $id, 'projectKey' => $projectKey, 'name' => \Memo\text($row['name'] ?? null), 'parent' => $parent > 0 ? $parent : null, 'coordinates' => $point, 'content' => $groups];
    }
    foreach ($cards as $card) {
        $parent = $card['parent']; $visited = [$card['legacyId'] => true];
        while ($parent !== null) {
            demand(isset($cards[$parent]) && $cards[$parent]['projectKey'] === $card['projectKey'], 'Missing or cross-project legacy parent.');
            demand(!isset($visited[$parent]), 'Legacy parent cycle.');
            $visited[$parent] = true; $parent = $cards[$parent]['parent'];
        }
    }
    ksort($projects); ksort($cards); ksort($recovered);
    $projectList = [...array_values($projects), ...array_values($recovered)];
    $normalized = ['mappingVersion' => 1, 'projects' => $projectList, 'cards' => array_values($cards)];
    return ['sourceSha256' => $input['sourceSha256'], 'payloadSha256' => hash('sha256', json_encode(['payload' => canonical($input), 'mapping' => $normalized], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)), 'content' => $normalized,
        'counts' => ['sourceProjects' => count($projects), 'recoveredProjects' => count($recovered), 'projects' => count($projectList), 'cards' => count($cards), 'orphanCards' => $orphans, 'groups' => $groupsCount, 'fields' => $fieldsCount, 'byteContentsDecoded' => $decoded, 'coordinatesDefaulted' => $defaulted]];
}

function ledgerExists(PDO $pdo): bool
{
    return (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='legacy_imports'")->fetchColumn() > 0;
}

function imported(PDO $pdo, array $normalized, int $owner): ?array
{
    if (!ledgerExists($pdo)) return null;
    $query = $pdo->prepare('SELECT * FROM legacy_imports WHERE source_sha256=?'); $query->execute([$normalized['sourceSha256']]);
    $row = $query->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    demand((int) $row['owner_id'] === $owner && hash_equals($row['payload_sha256'], $normalized['payloadSha256']), 'Source was already imported with another owner or payload.');
    return ['status' => 'already-imported', 'sourceSha256' => $normalized['sourceSha256'], 'ownerId' => $owner, 'counts' => $normalized['counts'], 'projectIds' => json_decode($row['project_ids_json'], true, 64, JSON_THROW_ON_ERROR), 'cardIds' => json_decode($row['card_ids_json'], true, 64, JSON_THROW_ON_ERROR)];
}

function execute(PDO $pdo, string $sql, array $values = []): \PDOStatement
{
    $query = $pdo->prepare($sql); $query->execute($values); return $query;
}

function verifyCard(PDO $pdo, int $id, int $project, ?int $parent, array $expected): void
{
    $row = execute($pdo, 'SELECT * FROM cards WHERE id=?', [$id])->fetch(PDO::FETCH_ASSOC);
    demand($row && $row['name'] === $expected['name'] && (int) $row['project_id'] === $project && ($row['parent_id'] === null ? null : (int) $row['parent_id']) === $parent && (float) $row['x'] === $expected['coordinates']['x'] && (float) $row['y'] === $expected['coordinates']['y'], 'Imported card verification failed.');
    $content = [];
    foreach (execute($pdo, 'SELECT * FROM field_groups WHERE card_id=? ORDER BY sort_order,id', [$id])->fetchAll(PDO::FETCH_ASSOC) as $group) {
        $fields = [];
        foreach (execute($pdo, 'SELECT * FROM fields WHERE group_id=? ORDER BY sort_order,id', [$group['id']])->fetchAll(PDO::FETCH_ASSOC) as $field) $fields[] = ['type' => $field['type'], 'title' => $field['title'], 'value' => json_decode($field['values_json'], true, 64, JSON_THROW_ON_ERROR)];
        $content[] = ['name' => $group['name'], 'collapsed' => (bool) $group['collapsed'], 'fields' => $fields];
    }
    demand($content === $expected['content'], 'Imported content verification failed.');
}

/** Plan не делает DDL/DML. Apply добавляет данные и запись журнала одной транзакцией. */
function importLegacy(PDO $pdo, array $input, string $email, string $orphanPolicy = 'reject', bool $apply = false): array
{
    demand(in_array($orphanPolicy, ['reject', 'recover'], true), 'Use orphan policy reject or recover.');
    demand(filter_var($email, FILTER_VALIDATE_EMAIL) !== false, 'A valid existing owner email is required.');
    $normalized = normalize($input);
    $owner = execute($pdo, 'SELECT id FROM users WHERE email=?', [strtolower($email)])->fetchColumn();
    demand($owner !== false, 'The requested owner account does not exist.'); $owner = (int) $owner;
    if ($existing = imported($pdo, $normalized, $owner)) return $existing;
    $blocked = $normalized['counts']['orphanCards'] > 0 && $orphanPolicy !== 'recover';
    if (!$apply) return ['status' => 'planned', 'canApply' => !$blocked, 'reason' => $blocked ? 'Explicit orphan-policy recover is required.' : null, 'sourceSha256' => $normalized['sourceSha256'], 'payloadSha256' => $normalized['payloadSha256'], 'ownerId' => $owner, 'counts' => $normalized['counts']];
    demand(!$blocked, 'Orphan records require explicit orphan-policy recover.');
    demand((int) $pdo->query("SELECT GET_LOCK('mind_assistant_legacy_import',10)")->fetchColumn() === 1, 'Another legacy import is running.');
    try {
        if ($existing = imported($pdo, $normalized, $owner)) return $existing;
        $pdo->exec("CREATE TABLE IF NOT EXISTS legacy_imports (source_sha256 CHAR(64) PRIMARY KEY, payload_sha256 CHAR(64) NOT NULL, owner_id INT UNSIGNED NOT NULL, project_ids_json JSON NOT NULL, card_ids_json JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->beginTransaction();
        $projects = []; $cards = [];
        foreach ($normalized['content']['projects'] as $project) {
            execute($pdo, 'INSERT INTO projects(owner_id,name) VALUES(?,?)', [$owner, $project['name']]);
            $projects[$project['key']] = (int) $pdo->lastInsertId();
        }
        foreach ($normalized['content']['cards'] as $card) {
            execute($pdo, 'INSERT INTO cards(project_id,parent_id,name,x,y) VALUES(?,NULL,?,?,?)', [$projects[$card['projectKey']], $card['name'], $card['coordinates']['x'], $card['coordinates']['y']]);
            $id = (int) $pdo->lastInsertId(); $cards[$card['legacyId']] = $id;
            foreach ($card['content'] as $order => $group) {
                execute($pdo, 'INSERT INTO field_groups(card_id,name,sort_order,collapsed) VALUES(?,?,?,?)', [$id, $group['name'], $order, (int) $group['collapsed']]);
                $groupId = (int) $pdo->lastInsertId();
                foreach ($group['fields'] as $position => $field) execute($pdo, 'INSERT INTO fields(group_id,type,title,values_json,sort_order) VALUES(?,?,?,?,?)', [$groupId, $field['type'], $field['title'], json_encode($field['value'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $position]);
            }
        }
        foreach ($normalized['content']['cards'] as $card) {
            if ($card['parent'] !== null) {
                execute($pdo, 'UPDATE cards SET parent_id=? WHERE id=?', [$cards[$card['parent']], $cards[$card['legacyId']]]);
                execute($pdo, "INSERT INTO card_links(source_id,target_id) VALUES(?,?)", [$cards[$card['parent']], $cards[$card['legacyId']]]);
            }
            verifyCard($pdo, $cards[$card['legacyId']], $projects[$card['projectKey']], $card['parent'] === null ? null : $cards[$card['parent']], $card);
        }
        execute($pdo, 'INSERT INTO legacy_imports(source_sha256,payload_sha256,owner_id,project_ids_json,card_ids_json) VALUES(?,?,?,?,?)', [$normalized['sourceSha256'], $normalized['payloadSha256'], $owner, json_encode($projects, JSON_THROW_ON_ERROR), json_encode($cards, JSON_THROW_ON_ERROR)]);
        $pdo->commit();
        return ['status' => 'imported', 'sourceSha256' => $normalized['sourceSha256'], 'ownerId' => $owner, 'counts' => $normalized['counts'], 'projectIds' => $projects, 'cardIds' => $cards];
    } catch (\Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } finally { $pdo->query("SELECT RELEASE_LOCK('mind_assistant_legacy_import')"); }
}

function main(array $args): void
{
    $action = array_shift($args); demand(in_array($action, ['plan', 'apply'], true), 'Use plan|apply --input PRIVATE_JSON --owner-email EMAIL [--orphan-policy reject|recover] [--app-root PATH] [--config PRIVATE_CONFIG].');
    $options = [];
    while ($args) {
        $key = array_shift($args); demand(in_array($key, ['--input', '--owner-email', '--orphan-policy', '--app-root', '--config'], true) && !isset($options[$key]) && count($args) > 0, 'Invalid legacy import arguments.');
        $options[$key] = array_shift($args);
    }
    demand(isset($options['--input'], $options['--owner-email']), 'Input and owner email are required.');
    $input = $options['--input']; demand(is_file($input) && !is_link($input) && filesize($input) <= 32 * 1024 * 1024, 'Expected a private payload up to 32 MiB.');
    $data = json_decode(file_get_contents($input), true, 128, JSON_THROW_ON_ERROR); demand(is_array($data), 'Invalid private payload.');
    $root = rtrim($options['--app-root'] ?? dirname(__DIR__), '/');
    $source = is_file($root . '/backend/src/bootstrap.php') ? $root . '/backend/src' : $root . '/backend';
    demand(is_file($source . '/bootstrap.php') && is_file($source . '/cards.php'), 'App root does not contain the Memo backend.');
    if (isset($options['--config'])) {
        demand(is_file($options['--config']) && !is_link($options['--config']) && (fileperms($options['--config']) & 0077) === 0, 'Private config with mode 600 is required.');
        // Явный config выбирает БД, а не случайные DB_* переменные родительской shell.
        foreach (['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'APP_ENV'] as $key) putenv($key);
        putenv('MEMO_CONFIG=' . $options['--config']);
    }
    require_once $source . '/bootstrap.php'; require_once $source . '/cards.php';
    echo json_encode(['ok' => true] + importLegacy(\Memo\database(), $data, $options['--owner-email'], $options['--orphan-policy'] ?? 'reject', $action === 'apply'), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try { main(array_slice($argv, 1)); }
    catch (\Throwable $error) { fwrite(STDERR, json_encode(['ok' => false, 'error' => $error instanceof ImportError ? $error->getMessage() : 'Legacy import failed: ' . get_class($error)], JSON_UNESCAPED_UNICODE) . PHP_EOL); exit(1); }
}
