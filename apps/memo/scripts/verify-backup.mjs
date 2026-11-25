import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// В исключениях сравнения не должны появляться названия, адреса или содержимое полей.
function check(valid, message = 'Restored data verification failed') {
  if (!valid) throw new Error(message);
}

function checkEqual(actual, expected, message = 'Restored data mismatch') {
  check(isDeepStrictEqual(actual, expected), message);
}

function privateJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} returned invalid JSON; private output was withheld.`);
  }
}

function backupSnapshot(filename) {
  const bytes = fs.readFileSync(filename);
  return Object.freeze({ bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}

function restoreEnvironment(parent, password, port) {
  const environment = { ...parent };
  for (const name of [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'APP_ENV',
    'API_PORT',
    'PHP_VERSION',
    'MEMO_CONFIG',
    'MIND_ASSISTANT_CONFIG',
    'MYSQL_PWD',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_USER',
    'MYSQL_ROOT_PASSWORD',
    'COMPOSE_FILE',
    'COMPOSE_ENV_FILES',
    'COMPOSE_PROJECT_NAME',
    'COMPOSE_PROFILES',
  ])
    delete environment[name];
  // Shell-переменные приоритетнее --env-file в Compose. Фиксируем их явно для дочерних процессов.
  return Object.freeze({
    ...environment,
    PHP_VERSION: '8.2',
    DB_NAME: 'restore_check',
    DB_USER: 'restore_check',
    DB_PASSWORD: password,
    APP_ENV: 'development',
    API_PORT: String(port),
  });
}

function verifyCoverage(counts, api) {
  for (const [table, key] of Object.entries({
    users: 'checkedUsers',
    projects: 'checkedProjects',
    cards: 'checkedCards',
    field_groups: 'checkedGroups',
    fields: 'checkedFields',
    media: 'checkedMedia',
  }))
    checkEqual(api[key], counts[table], `Restored ${table} API coverage is incomplete`);
  if ('card_links' in counts)
    checkEqual(
      api.checkedLinks + api.hiddenLinks,
      counts.card_links,
      'Restored graph coverage is incomplete',
    );
}

async function boundaryChecks() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-restore-boundaries-'));
  const failsSafely = (operation, privateValue) => {
    let observed = false;
    try {
      operation();
    } catch (error) {
      observed = true;
      check(
        !String(error.stack).includes(privateValue),
        'A private value appeared in an exception',
      );
    }
    check(observed, 'Expected a rejected boundary');
  };
  try {
    const input = path.join(temporary, 'copy.sql');
    fs.writeFileSync(input, 'first immutable snapshot', { mode: 0o600 });
    const frozen = backupSnapshot(input);
    fs.writeFileSync(input, 'rotated source file');
    checkEqual(
      frozen.bytes.toString(),
      'first immutable snapshot',
      'The restored bytes changed after source rotation',
    );
    checkEqual(
      frozen.sha256,
      createHash('sha256').update(frozen.bytes).digest('hex'),
      'Input checksum is not bound to restored bytes',
    );
    check(
      frozen.sha256 !== createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
      'Rotation test did not change the input',
    );
    const password = randomBytes(24).toString('hex');
    const environment = restoreEnvironment(
      {
        ...process.env,
        DB_NAME: 'host_db',
        DB_USER: 'host_user',
        DB_PASSWORD: 'host-private-password',
        PHP_VERSION: '9.9',
        API_PORT: '54322',
        MEMO_CONFIG: '/host/memo-config.php',
        MIND_ASSISTANT_CONFIG: '/host/legacy-config.php',
        COMPOSE_PROFILES: 'unexpected',
      },
      password,
      54321,
    );
    check(!('COMPOSE_PROFILES' in environment), 'A host Compose profile was inherited');
    check(
      !('MEMO_CONFIG' in environment) && !('MIND_ASSISTANT_CONFIG' in environment),
      'A host application config was inherited',
    );
    const file = path.join(temporary, '.env');
    fs.writeFileSync(
      file,
      'DB_NAME=file_db\nDB_USER=file_user\nDB_PASSWORD=file-secret\nPHP_VERSION=8.4\nAPI_PORT=54323\n',
      { mode: 0o600 },
    );
    const configuration = spawnSync(
      'docker',
      [
        'compose',
        '-p',
        'sandbox-restore-boundary-probe',
        '--env-file',
        file,
        '-f',
        path.join(app, 'compose.yml'),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: environment, timeout: 15000 },
    );
    check(
      configuration.status === 0 && !configuration.error,
      'Read-only Compose boundary probe failed',
    );
    const resolved = privateJson(configuration.stdout, 'Compose configuration');
    checkEqual(
      resolved.services.db.environment.MYSQL_DATABASE,
      'restore_check',
      'External DB name overrode restore isolation',
    );
    checkEqual(
      resolved.services.db.environment.MYSQL_PASSWORD,
      password,
      'External credentials overrode restore isolation',
    );
    checkEqual(
      resolved.services.api.build.args.PHP_VERSION,
      '8.2',
      'External PHP version overrode the test',
    );
    checkEqual(
      String(resolved.services.api.ports[0].published),
      '54321',
      'External API port overrode the test',
    );
    failsSafely(
      () => checkEqual('private-title-sentinel', 'different-title', 'Name mismatch'),
      'private-title-sentinel',
    );
    failsSafely(() => privateJson('private-json-sentinel', 'Fixture'), 'private-json-sentinel');
    const counts = { users: 2, projects: 1, cards: 1, field_groups: 1, fields: 1, media: 0 };
    failsSafely(
      () =>
        verifyCoverage(counts, {
          checkedUsers: 1,
          checkedProjects: 0,
          checkedCards: 0,
          checkedGroups: 0,
          checkedFields: 0,
          checkedMedia: 0,
        }),
      'unrelated-sentinel',
    );
    verifyCoverage(counts, {
      checkedUsers: 2,
      checkedProjects: 1,
      checkedCards: 1,
      checkedGroups: 1,
      checkedFields: 1,
      checkedMedia: 0,
    });
    console.log(
      JSON.stringify({
        ok: true,
        checks: [
          'immutable restore bytes and SHA',
          'Compose ignores external DB/PHP/port/profile values',
          'redacted comparison and JSON errors',
          'incomplete owner/data API coverage is rejected',
        ],
      }),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function verifyBackup(args) {
  if (
    args[0] !== '--backup' ||
    !args[1] ||
    args.slice(2).some((arg) => arg !== '--require-populated')
  ) {
    throw new Error(
      'Используйте --backup /путь/к/копии.sql [--require-populated]. Проверяется только отдельная Docker-БД.',
    );
  }
  const backup = fs.realpathSync(path.resolve(args[1]));
  if (!fs.statSync(backup).isFile()) throw new Error('Нужен SQL-файл резервной копии.');
  const frozenBackup = backupSnapshot(backup);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-restore-'));
  const environment = path.join(temporary, '.env');
  const project = `sandbox-memo-restore-${randomBytes(6).toString('hex')}`;
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const environmentValues = restoreEnvironment(process.env, randomBytes(24).toString('hex'), port);
  fs.writeFileSync(
    environment,
    `PHP_VERSION=8.2\nDB_NAME=restore_check\nDB_USER=restore_check\nDB_PASSWORD=${environmentValues.DB_PASSWORD}\nAPI_PORT=${port}\n`,
    { mode: 0o600 },
  );
  const compose = [
    'compose',
    '-p',
    project,
    '--env-file',
    environment,
    '-f',
    path.join(app, 'compose.yml'),
  ];
  const run = (command, parameters, label, options = {}) => {
    const result = spawnSync(command, parameters, {
      cwd: app,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180000,
      ...options,
      env: environmentValues,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `${label} failed (${result.error?.code ?? result.status}). Private output was not printed.`,
      );
    return result.stdout;
  };
  const php = (body) =>
    run('docker', [...compose, 'exec', '-T', 'api', 'php'], 'Isolated PHP probe', {
      input: `<?php\nrequire '/var/www/memo/src/bootstrap.php';\ntry {${body}} catch (Throwable $error) {fwrite(STDERR, get_class($error)); exit(1);}\n`,
    });
  const snapshot = () =>
    privateJson(
      php(`
$tables=\\Memo\\query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN); sort($tables);
$hash=hash_init('sha256');$counts=[];
foreach($tables as $table){if(!preg_match('/^[a-z_]+$/',$table))throw new RuntimeException('Unexpected table');$rows=\\Memo\\query('SELECT * FROM '.$table.' ORDER BY 1');$counts[$table]=0;hash_update($hash,$table."\\n");while($row=$rows->fetch()){hash_update($hash,serialize($row));$counts[$table]++;}}
$broken=[];
foreach([
'projects'=>'SELECT COUNT(*) FROM projects p LEFT JOIN users u ON u.id=p.owner_id WHERE u.id IS NULL',
'cards'=>'SELECT COUNT(*) FROM cards c LEFT JOIN projects p ON p.id=c.project_id WHERE p.id IS NULL',
'parents'=>'SELECT COUNT(*) FROM cards c JOIN projects cp ON cp.id=c.project_id LEFT JOIN cards p ON p.id=c.parent_id LEFT JOIN projects pp ON pp.id=p.project_id WHERE c.parent_id IS NOT NULL AND (p.id IS NULL OR pp.owner_id<>cp.owner_id)',
'groups'=>'SELECT COUNT(*) FROM field_groups g LEFT JOIN cards c ON c.id=g.card_id WHERE c.id IS NULL',
'fields'=>'SELECT COUNT(*) FROM fields f LEFT JOIN field_groups g ON g.id=f.group_id WHERE g.id IS NULL',
'media'=>'SELECT COUNT(*) FROM media m LEFT JOIN users u ON u.id=m.owner_id WHERE u.id IS NULL'
] as $name=>$sql){$broken[$name]=(int)\\Memo\\query($sql)->fetchColumn();}
if(in_array('card_links',$tables,true))$broken['links']=(int)\\Memo\\query("SELECT COUNT(*) FROM card_links l JOIN cards s ON s.id=l.source_id JOIN cards t ON t.id=l.target_id JOIN projects sp ON sp.id=s.project_id JOIN projects tp ON tp.id=t.project_id WHERE sp.owner_id<>tp.owner_id OR s.id=t.id")->fetchColumn();
echo json_encode(['counts'=>$counts,'brokenRelations'=>$broken,'digest'=>hash_final($hash)]);
`),
      'Database snapshot',
    );
  let started = false;
  let passwordChanged = false;
  let report;
  const began = Date.now();
  try {
    console.log('Восстанавливаем копию в отдельный Docker-проект с PHP 8.2 и MySQL 8.4.');
    started = true;
    run('docker', [...compose, 'up', '--build', '--wait', '-d'], 'Isolated restore services', {
      timeout: 300000,
    });
    const restoreStarted = Date.now();
    run(
      'docker',
      [
        ...compose,
        'exec',
        '-T',
        'db',
        'sh',
        '-c',
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"',
      ],
      'SQL restore',
      { input: frozenBackup.bytes },
    );
    const original = snapshot();
    run(
      'docker',
      [...compose, 'exec', '-T', 'api', 'php', 'database/migrate.php'],
      'Restored schema migration',
    );
    const restored = snapshot();
    for (const table of ['users', 'projects', 'cards', 'field_groups', 'fields', 'media'])
      checkEqual(
        restored.counts[table],
        original.counts[table],
        'Migration changed restored record count',
      );
    for (const count of Object.values(restored.brokenRelations))
      checkEqual(count, 0, 'Broken restored relationship');
    for (const table of ['users', 'projects', 'cards', 'field_groups', 'fields', 'media'])
      check(table in restored.counts, `Missing table ${table}`);
    if (args.includes('--require-populated')) {
      for (const table of ['users', 'projects', 'cards', 'field_groups', 'fields'])
        check(restored.counts[table] > 0, `The selected backup has no ${table}`);
    }
    const password = randomBytes(24).toString('base64url');
    const users = privateJson(
      php("echo json_encode(\\Memo\\query('SELECT id FROM users ORDER BY id')->fetchAll());"),
      'Restored owners',
    );
    let cookie = '';
    let csrf = '';
    const request = async (route, method = 'GET', body) => {
      const headers = { Cookie: cookie, 'X-CSRF-Token': csrf };
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      for (const value of response.headers.getSetCookie())
        if (value.startsWith('mind_assistant=')) cookie = value.split(';')[0];
      checkEqual(response.status, 200, 'Restore API returned an unexpected status');
      if (route.startsWith('/media/')) return Buffer.from(await response.arrayBuffer());
      const result = privateJson(await response.text(), 'Restore API');
      checkEqual(result.ok, true, 'Restore API returned an unsuccessful result');
      if (result.data?.csrfToken) csrf = result.data.csrfToken;
      return result.data;
    };
    await request('/health');
    await request('/session');
    const apiCoverage = {
      checkedUsers: 0,
      checkedProjects: 0,
      checkedCards: 0,
      checkedGroups: 0,
      checkedFields: 0,
      checkedMedia: 0,
      checkedLinks: 0,
      hiddenLinks: 0,
    };
    for (const owner of users) {
      const id = Number(owner.id);
      check(
        Number.isSafeInteger(id) && id > 0 && id <= 4294967295,
        'Invalid restored owner identifier',
      );
      passwordChanged = true;
      const fixture = privateJson(
        php(`
$user=\\Memo\\query('SELECT id,email,password_hash FROM users WHERE id=?',[${id}])->fetch();
if(!$user)throw new RuntimeException('Restored owner disappeared');
if(file_put_contents('/tmp/sandbox-restore-password.json',json_encode(['id'=>$user['id'],'hash'=>$user['password_hash']]))===false)throw new RuntimeException('Password recovery file');chmod('/tmp/sandbox-restore-password.json',0600);
\\Memo\\query('UPDATE users SET password_hash=? WHERE id=?',[password_hash('${password}',PASSWORD_DEFAULT),$user['id']]);
$projects=\\Memo\\query('SELECT p.id,p.name,d.deleted_at FROM projects p LEFT JOIN project_details d ON d.project_id=p.id WHERE p.owner_id=? ORDER BY p.id',[$user['id']])->fetchAll();
$cards=\\Memo\\query('SELECT c.*,d.deleted_at,COALESCE(d.pinned,0) AS pinned,d.updated_at,d.opened_at,CASE WHEN pc.id IS NOT NULL AND pcd.deleted_at IS NULL AND ppd.deleted_at IS NULL THEN c.parent_id ELSE NULL END AS visible_parent FROM cards c JOIN projects p ON p.id=c.project_id LEFT JOIN card_details d ON d.card_id=c.id LEFT JOIN cards pc ON pc.id=c.parent_id LEFT JOIN card_details pcd ON pcd.card_id=pc.id LEFT JOIN project_details ppd ON ppd.project_id=pc.project_id WHERE p.owner_id=? ORDER BY c.id',[$user['id']])->fetchAll();
$groups=\\Memo\\query('SELECT g.* FROM field_groups g JOIN cards c ON c.id=g.card_id JOIN projects p ON p.id=c.project_id WHERE p.owner_id=? ORDER BY g.sort_order,g.id',[$user['id']])->fetchAll();
$fields=\\Memo\\query('SELECT f.* FROM fields f JOIN field_groups g ON g.id=f.group_id JOIN cards c ON c.id=g.card_id JOIN projects p ON p.id=c.project_id WHERE p.owner_id=? ORDER BY f.sort_order,f.id',[$user['id']])->fetchAll();
foreach($fields as &$field){$values=json_decode($field['values_json'],true,64,JSON_THROW_ON_ERROR);if(!is_array($values)||!array_is_list($values))throw new RuntimeException('Invalid field values');foreach($values as $value)if(!is_string($value))throw new RuntimeException('Invalid field value type');$field['valueHashes']=array_map(fn($value)=>hash('sha256',$value),$values);unset($field['values_json']);}unset($field);
$media=\\Memo\\query('SELECT id,SHA2(content,256) AS digest FROM media WHERE owner_id=? ORDER BY id',[$user['id']])->fetchAll();
$links=\\Memo\\query('SELECT l.source_id,l.target_id,l.label FROM card_links l JOIN cards c ON c.id=l.source_id JOIN projects p ON p.id=c.project_id WHERE p.owner_id=? ORDER BY l.source_id,l.target_id',[$user['id']])->fetchAll();
echo json_encode(['user'=>['id'=>(int)$user['id'],'email'=>$user['email']],'projects'=>$projects,'cards'=>$cards,'groups'=>$groups,'fields'=>$fields,'media'=>$media,'links'=>$links]);
`),
        'Restored owner fixture',
      );
      const identity = await request('/auth/login', 'POST', {
        email: fixture.user.email,
        password,
      });
      checkEqual(identity.user.id, id, 'Restored account authentication returned another owner');
      apiCoverage.checkedUsers++;
      const activeProjects = await request('/projects');
      const trash = await request('/trash');
      const projects = [...activeProjects, ...trash.projects];
      checkEqual(
        projects.map((item) => item.id).sort((a, b) => a - b),
        fixture.projects.map((item) => Number(item.id)),
        'Restored owner project membership mismatch',
      );
      for (const expectedProject of fixture.projects) {
        checkEqual(
          projects.find((item) => item.id === Number(expectedProject.id)).name,
          expectedProject.name,
          'Restored project name mismatch',
        );
        const visibleCards = expectedProject.deleted_at
          ? []
          : await request(`/projects/${expectedProject.id}/cards`);
        const expectedCards = fixture.cards.filter(
          (item) => Number(item.project_id) === Number(expectedProject.id),
        );
        const hiddenCards = await Promise.all(
          expectedCards
            .filter((item) => expectedProject.deleted_at || item.deleted_at)
            .map((item) => request(`/cards/${item.id}?includeDeleted=1`)),
        );
        const cards = [...visibleCards, ...hiddenCards];
        checkEqual(
          cards.map((item) => item.id).sort((a, b) => a - b),
          expectedCards.map((item) => Number(item.id)),
          'Restored project card membership mismatch',
        );
        checkEqual(
          projects.find((item) => item.id === Number(expectedProject.id)).cards,
          expectedCards.filter((item) => !item.deleted_at).length,
          'Restored dashboard card count mismatch',
        );
        apiCoverage.checkedProjects++;
        for (const expected of expectedCards) {
          const card = cards.find((item) => item.id === Number(expected.id));
          checkEqual(card.name, expected.name, 'Restored card name mismatch');
          checkEqual(card.kind, expected.kind, 'Restored card kind mismatch');
          checkEqual(
            card.folder,
            expected.folder_id === null ? null : Number(expected.folder_id),
            'Restored folder membership mismatch',
          );
          checkEqual(
            card.parent,
            expected.visible_parent === null ? null : Number(expected.visible_parent),
            'Restored parent mapping mismatch',
          );
          checkEqual(
            card.coordinates,
            { x: Number(expected.x), y: Number(expected.y) },
            'Restored coordinates mismatch',
          );
          checkEqual(card.version, Number(expected.version), 'Restored card version mismatch');
          checkEqual(card.pinned, Boolean(Number(expected.pinned)), 'Restored pin mismatch');
          checkEqual(card.deletedAt, expected.deleted_at, 'Restored trash state mismatch');
          checkEqual(card.updatedAt, expected.updated_at, 'Restored update timestamp mismatch');
          checkEqual(card.openedAt, expected.opened_at, 'Restored visit timestamp mismatch');
          const expectedGroups = fixture.groups.filter((item) => Number(item.card_id) === card.id);
          checkEqual(
            card.content.map((item) => item.id),
            expectedGroups.map((item) => Number(item.id)),
            'Restored group order or membership mismatch',
          );
          for (const group of expectedGroups) {
            const actualGroup = card.content.find((item) => item.id === Number(group.id));
            checkEqual(actualGroup.name, group.name, 'Restored group name mismatch');
            checkEqual(
              actualGroup.order,
              Number(group.sort_order),
              'Restored group order mismatch',
            );
            checkEqual(
              actualGroup.collapsed,
              Boolean(Number(group.collapsed)),
              'Restored group state mismatch',
            );
            const expectedFields = fixture.fields.filter(
              (item) => Number(item.group_id) === Number(group.id),
            );
            checkEqual(
              actualGroup.fields.map((item) => item.id),
              expectedFields.map((item) => Number(item.id)),
              'Restored field order or membership mismatch',
            );
            for (const field of expectedFields) {
              const actual = actualGroup.fields.find((item) => item.id === Number(field.id));
              checkEqual(actual.type, field.type, 'Restored field type mismatch');
              checkEqual(actual.title, field.title, 'Restored field title mismatch');
              checkEqual(actual.order, Number(field.sort_order), 'Restored field order mismatch');
              check(
                actual.value.every((value) => typeof value === 'string'),
                'Restore API returned an invalid field value type',
              );
              checkEqual(
                actual.value.map((value) => createHash('sha256').update(value).digest('hex')),
                field.valueHashes,
                'Restored field values mismatch',
              );
              apiCoverage.checkedFields++;
            }
            apiCoverage.checkedGroups++;
          }
          apiCoverage.checkedCards++;
        }
      }
      const visibleIds = new Set(
        fixture.cards
          .filter(
            (item) =>
              !item.deleted_at &&
              !fixture.projects.find((project) => Number(project.id) === Number(item.project_id))
                .deleted_at,
          )
          .map((item) => Number(item.id)),
      );
      const expectedLinks = fixture.links
        .filter(
          (item) =>
            visibleIds.has(Number(item.source_id)) && visibleIds.has(Number(item.target_id)),
        )
        .map((item) => ({
          source: Number(item.source_id),
          target: Number(item.target_id),
          label: item.label,
        }));
      const links = await request('/links');
      checkEqual(
        links.map(({ source, target, label }) => ({ source, target, label })),
        expectedLinks,
        'Restored visible links mismatch',
      );
      apiCoverage.checkedLinks += links.length;
      apiCoverage.hiddenLinks += fixture.links.length - links.length;
      for (const media of fixture.media) {
        const bytes = await request(`/media/${media.id}`);
        checkEqual(
          createHash('sha256').update(bytes).digest('hex'),
          media.digest,
          'Restored media bytes mismatch',
        );
        apiCoverage.checkedMedia++;
      }
      await request('/auth/logout', 'POST', {});
      php(
        `$saved=json_decode(file_get_contents('/tmp/sandbox-restore-password.json'),true,64,JSON_THROW_ON_ERROR);\\Memo\\query('UPDATE users SET password_hash=? WHERE id=?',[$saved['hash'],$saved['id']]);unlink('/tmp/sandbox-restore-password.json');`,
      );
      passwordChanged = false;
    }
    verifyCoverage(restored.counts, apiCoverage);
    const after = snapshot();
    checkEqual(
      after.digest,
      restored.digest,
      'Application verification changed restored persistent data',
    );
    report = {
      ok: true,
      backupSha256: frozenBackup.sha256,
      tables: restored.counts,
      brokenRelations: restored.brokenRelations,
      api: apiCoverage,
      restoreAndVerificationMs: Date.now() - restoreStarted,
      totalMs: Date.now() - began,
    };
  } finally {
    if (passwordChanged) {
      try {
        php(
          `$saved=json_decode(file_get_contents('/tmp/sandbox-restore-password.json'),true,64,JSON_THROW_ON_ERROR);\\Memo\\query('UPDATE users SET password_hash=? WHERE id=?',[$saved['hash'],$saved['id']]);unlink('/tmp/sandbox-restore-password.json');`,
        );
      } catch {
        /* Уничтожается только созданный этим тестом изолированный контейнер. */
      }
    }
    if (started) {
      const cleanup = spawnSync('docker', [...compose, 'down', '--volumes', '--remove-orphans'], {
        cwd: app,
        encoding: 'utf8',
        timeout: 120000,
        env: environmentValues,
      });
      if (cleanup.error || cleanup.status !== 0)
        throw new Error(
          `Не удалось удалить только тестовый Docker-проект ${project}. Конфигурация сохранена в ${temporary}.`,
        );
      const image = `${project}-api`;
      const owned = spawnSync(
        'docker',
        [
          'image',
          'inspect',
          image,
          '--format',
          '{{index .Config.Labels "com.docker.compose.project"}}',
        ],
        { encoding: 'utf8', timeout: 15000, env: environmentValues },
      );
      if (owned.status === 0) {
        checkEqual(
          owned.stdout.trim(),
          project,
          'Refusing to delete an image belonging to another project',
        );
        run('docker', ['image', 'rm', image], 'Owned restore image cleanup', { timeout: 30000 });
      }
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report));
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--self-test') await boundaryChecks();
else await verifyBackup(args);
