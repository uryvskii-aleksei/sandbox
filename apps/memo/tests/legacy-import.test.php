<?php
declare(strict_types=1);
require '/app/backend/src/bootstrap.php';
require '/app/backend/src/cards.php';
require '/app/scripts/import-legacy.php';

use function Memo\LegacyImport\importLegacy;
use function Memo\LegacyImport\normalize;
use function Memo\LegacyImport\ledgerExists;

function expect(bool $condition, string $label): void
{
    if (!$condition) throw new RuntimeException($label);
}

function refused(callable $operation, string $label): void
{
    try { $operation(); }
    catch (Throwable) { return; }
    throw new RuntimeException($label);
}

$pdo = \Memo\database();
$pdo->exec(file_get_contents('/app/backend/database/schema.sql'));
$hash = password_hash('Synthetic-local-password', PASSWORD_DEFAULT);
$statement = $pdo->prepare('INSERT INTO users(email,password_hash) VALUES(?,?)');
$statement->execute(['owner@example.test', $hash]); $owner = (int) $pdo->lastInsertId();
$statement->execute(['other@example.test', $hash]); $other = (int) $pdo->lastInsertId();
$statement = $pdo->prepare('INSERT INTO projects(owner_id,name) VALUES(?,?)');
$statement->execute([$other, 'Existing unrelated project']); $existingProject = (int) $pdo->lastInsertId();
$statement = $pdo->prepare('INSERT INTO cards(project_id,name,x,y) VALUES(?,?,?,?)');
$statement->execute([$existingProject, 'Keep the existing card', 20, 30]); $existingCard = (int) $pdo->lastInsertId();
$before = $pdo->query('SELECT * FROM cards WHERE id=' . $existingCard)->fetch(PDO::FETCH_ASSOC);

$groups = [
    ['name' => 'Second', 'order' => 9, 'collapsed' => true, 'fields' => [['type' => 'textarea', 'order' => 0, 'value' => 'Второй текст']]],
    ['name' => 'First', 'order' => 2, 'fields' => [['type' => 'textarea', 'order' => 0, 'value' => ['Первый текст', 'Another value']]]],
];
$bytes = array_values(unpack('C*', json_encode($groups, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)));
$fixture = ['version' => 1, 'app' => 'mind-assistant-legacy', 'sourceSha256' => str_repeat('a', 64),
    'projects' => [['id' => 1, 'name' => 'Legacy project', 'pages' => 5]],
    'data' => [
        ['id' => 4, 'name' => 'Parent', 'project' => 1, 'parent' => 0, 'coordinates' => ['x' => -12.5, 'y' => 20], 'content' => $bytes],
        ['id' => 5, 'name' => 'Child', 'project' => 1, 'parent' => 4, 'coordinates' => ['x' => 40, 'y' => 50], 'content' => []],
        ['id' => 6, 'name' => 'Orphan', 'project' => 0, 'parent' => 0, 'coordinates' => ['x' => 1, 'y' => 2], 'content' => []],
        ['id' => 7, 'name' => 'Other', 'project' => 1, 'parent' => 0, 'coordinates' => ['x' => 80, 'y' => 90], 'content' => []],
        ['id' => 9, 'name' => 'Default coordinates', 'project' => 1, 'parent' => -1, 'coordinates' => ['x' => '', 'y' => ''], 'content' => null],
    ]];
$normalized = normalize($fixture);
expect($normalized['counts'] === ['sourceProjects' => 1, 'recoveredProjects' => 1, 'projects' => 2, 'cards' => 5, 'orphanCards' => 1, 'groups' => 2, 'fields' => 2, 'byteContentsDecoded' => 1, 'coordinatesDefaulted' => 1], 'Wrong normalization aggregates');
expect($fixture['data'][0]['content'] === $bytes && $fixture['data'][4]['coordinates']['x'] === '', 'Normalization mutated input');
$separate = $fixture; $separate['data'][4]['project'] = 99;
$separateMapping = normalize($separate);
expect($separateMapping['counts']['projects'] === 3 && $separateMapping['content']['cards'][2]['projectKey'] !== $separateMapping['content']['cards'][4]['projectKey'], 'Different absent source projects were merged');
$plan = importLegacy($pdo, $fixture, 'owner@example.test');
expect($plan['status'] === 'planned' && !$plan['canApply'], 'Default orphan policy must block apply');
expect(!ledgerExists($pdo) && (int) $pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 1, 'Plan changed the database');
refused(fn() => importLegacy($pdo, $fixture, 'owner@example.test', 'reject', true), 'Rejected orphan policy changed data');
refused(fn() => importLegacy($pdo, $fixture, 'missing@example.test', 'recover', true), 'Missing owner was accepted');
$result = importLegacy($pdo, $fixture, 'owner@example.test', 'recover', true);
expect($result['status'] === 'imported' && count($result['projectIds']) === 2 && count($result['cardIds']) === 5, 'Import did not finish');
expect((int) $pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 3, 'Existing project was replaced');
expect($pdo->query('SELECT * FROM cards WHERE id=' . $existingCard)->fetch(PDO::FETCH_ASSOC) === $before, 'Existing unrelated card changed');
$cards = $result['cardIds'];
$parent = \Memo\cardOutput(\Memo\cardRow($cards[4], $owner));
$child = \Memo\cardOutput(\Memo\cardRow($cards[5], $owner));
$orphan = \Memo\cardOutput(\Memo\cardRow($cards[6], $owner));
$default = \Memo\cardOutput(\Memo\cardRow($cards[9], $owner));
expect($child['parent'] === $parent['id'] && $orphan['project'] === $result['projectIds']['recovered:0'], 'Parent or orphan mapping was lost');
expect($default['coordinates'] === ['x' => 0.0, 'y' => 0.0] && $default['parent'] === null, 'Sentinels were not normalized');
expect($parent['content'][0]['name'] === 'First' && $parent['content'][1]['collapsed'] === true, 'Group ordering or state changed');
expect($parent['content'][0]['fields'][0]['value'] === ['Первый текст', 'Another value'] && $parent['content'][1]['fields'][0]['value'] === ['Второй текст'], 'UTF-8/scalar field values changed');
$pdo->exec("UPDATE cards SET name='Edited after import' WHERE id=" . $cards[4]);
$repeat = importLegacy($pdo, $fixture, 'owner@example.test', 'recover', true);
expect($repeat['status'] === 'already-imported' && (int) $pdo->query('SELECT COUNT(*) FROM cards')->fetchColumn() === 6, 'Retry duplicated cards');
expect($pdo->query('SELECT name FROM cards WHERE id=' . $cards[4])->fetchColumn() === 'Edited after import', 'Retry overwrote an edit');
$changed = $fixture; $changed['projects'][0]['pages'] = 100;
refused(fn() => importLegacy($pdo, $changed, 'owner@example.test', 'recover', true), 'A changed source payload reused the source identity');
refused(fn() => importLegacy($pdo, $fixture, 'other@example.test', 'recover', true), 'A source was imported for another owner');
$cycle = $fixture; $cycle['data'][0]['parent'] = 5;
refused(fn() => importLegacy($pdo, $cycle, 'owner@example.test', 'recover', true), 'A parent cycle was accepted');
$cross = $fixture; $cross['data'][0]['parent'] = 6;
refused(fn() => importLegacy($pdo, $cross, 'owner@example.test', 'recover', true), 'A cross-project parent was accepted');
$bad = $fixture; $bad['data'][0]['content'] = [999];
refused(fn() => normalize($bad), 'Invalid byte content was accepted');
$pdo->exec("ALTER TABLE fields ADD CONSTRAINT legacy_test_fail CHECK (title <> 'Synthetic injected failure')");
$fresh = $fixture; $fresh['sourceSha256'] = str_repeat('b', 64);
$fresh['data'][0]['content'] = $groups;
$fresh['data'][0]['content'][0]['fields'][0]['title'] = 'Synthetic injected failure';
refused(fn() => importLegacy($pdo, $fresh, 'owner@example.test', 'recover', true), 'Injected field failure was ignored');
expect((int) $pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 3 && (int) $pdo->query('SELECT COUNT(*) FROM cards')->fetchColumn() === 6 && (int) $pdo->query('SELECT COUNT(*) FROM legacy_imports')->fetchColumn() === 1, 'A partial failed import was committed');
$pdo->exec('ALTER TABLE fields DROP CHECK legacy_test_fail');
$actualResult = null;
if (is_file('/private/actual.json')) {
    $actual = json_decode(file_get_contents('/private/actual.json'), true, 128, JSON_THROW_ON_ERROR);
    $actualResult = importLegacy($pdo, $actual, 'owner@example.test', 'recover', true);
    expect($actualResult['status'] === 'imported', 'Actual dump import did not finish');
    if ($actual['sourceSha256'] === 'aab46049e8e716621be2d76ebc5a043df252b0c6d8e839277fec2419276370be') {
        expect($actualResult['counts'] === ['sourceProjects' => 1, 'recoveredProjects' => 2, 'projects' => 3, 'cards' => 5, 'orphanCards' => 5, 'groups' => 2, 'fields' => 2, 'byteContentsDecoded' => 1, 'coordinatesDefaulted' => 1], 'The recorded historical snapshot counts changed');
        foreach (['legacy:2' => 0, 'recovered:1' => 4, 'recovered:0' => 1] as $key => $count) {
            $query = $pdo->prepare('SELECT COUNT(*) FROM cards WHERE project_id=?'); $query->execute([$actualResult['projectIds'][$key]]);
            expect((int) $query->fetchColumn() === $count, 'Historical source project membership changed');
        }
    }
    expect(importLegacy($pdo, $actual, 'owner@example.test', 'recover', true)['status'] === 'already-imported', 'Actual dump retry duplicated data');
}
echo json_encode(['passed' => true, 'checks' => ['read-only plan', 'explicit orphan recovery', 'UTF-8 byte content', 'fields/order/coordinates/parents', 'existing data preservation', 'retry and edited data', 'changed payload/owner rejection', 'cycles and cross-project rejection', 'transaction rollback'], 'actualDumpCounts' => $actualResult['counts'] ?? null], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
