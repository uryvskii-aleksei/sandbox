import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const app = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('site/catalog.json', app), 'utf8'));
const [first, second, third] = catalog;

function client(url) {
  let cookie = '';
  let csrf = '';
  return async (body, expected = 200) => {
    const headers = cookie ? { Cookie: cookie } : {};
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify({ csrf, ...body }) : undefined,
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    csrf = data.csrf ?? csrf;
    return data;
  };
}

async function startPreview(t, temp, { documentRoot = 'site', dbPath } = {}) {
  const probe = createServer();
  await new Promise((resolve, reject) =>
    probe.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const env = { ...process.env };
  if (dbPath) env.WAVE_DB_PATH = dbPath;
  else delete env.WAVE_DB_PATH;
  const php = spawn(
    'php',
    [
      '-d',
      'session.save_path=' + temp,
      '-S',
      '127.0.0.1:' + port,
      '-t',
      documentRoot,
      'preview.php',
    ],
    {
      cwd: app,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let diagnostics = '';
  let failed;
  php.on('error', (error) => {
    failed = error;
  });
  php.stderr.on('data', (part) => {
    diagnostics += part;
  });
  t.after(async () => {
    if (php.pid && php.exitCode === null && php.signalCode === null) {
      await new Promise((resolve) => {
        php.once('close', resolve);
        php.kill();
      });
    }
    await rm(temp, { recursive: true, force: true });
  });

  const root = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failed) throw failed;
    try {
      const response = await fetch(root + '/wave/');
      assert.equal(response.status, 200);
      break;
    } catch (error) {
      if (attempt === 59) throw new Error(diagnostics || error.message);
      await delay(50);
    }
  }

  return root;
}

test('гостевые оценки переносятся, а данные аккаунтов разделены', { timeout: 20000 }, async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wave-test-'));
  const root = await startPreview(t, temp, { dbPath: path.join(temp, 'ratings.sqlite3') });

  const home = await fetch(root + '/');
  assert.match(await home.text(), /href="\/wave\/"/);
  const module = await fetch(root + '/wave/radio.mjs');
  assert.match(module.headers.get('content-type'), /^text\/javascript/);

  const visit = client(root + '/wave/api.php');
  const otherVisit = client(root + '/wave/api.php');
  const guest = await visit();
  assert.equal(guest.username, null);
  assert.deepEqual(guest.ratings, {});
  const credentials = { login: ' ClipTester@Example.com ', password: 'ж' };
  await visit({ action: 'register', ...credentials, csrf: 'invalid' }, 403);
  await visit({ action: 'rate', id: first.id, value: 1 }, 401);
  await visit({ action: 'register', ...credentials, login: 'ClipTester' }, 400);
  await visit({ action: 'register', ...credentials, login: 'cliptester@' }, 400);

  const account = await visit(
    { action: 'register', ...credentials, ratings: { [first.id]: 1, unknown: 1 } },
    200,
  );
  assert.equal(account.username, 'cliptester@example.com');
  assert.deepEqual(account.ratings, { [first.id]: 1 });
  assert.notEqual(account.csrf, guest.csrf);
  await visit({ action: 'rate', id: 'unknown', value: 1 }, 400);
  await visit({ action: 'rate', id: second.id, value: -1 });
  await visit({ action: 'rate', id: second.id, value: -1 });

  assert.equal((await otherVisit()).username, null);
  await otherVisit({ action: 'login', ...credentials, password: 'wrong' }, 401);
  const reloaded = await otherVisit({
    action: 'login',
    ...credentials,
    login: 'CLIPTESTER@example.com',
    ratings: { [first.id]: -1, [third.id]: 1 },
  });
  assert.deepEqual(reloaded.ratings, { [first.id]: 1, [second.id]: -1, [third.id]: 1 });
  await otherVisit({ action: 'rate', id: second.id, value: 0 });
  assert.deepEqual((await visit()).ratings, { [first.id]: 1, [third.id]: 1 });

  const signedOut = await visit({ action: 'logout' });
  assert.equal(signedOut.username, null);
  assert.deepEqual(signedOut.ratings, {});
  await visit({ action: 'rate', id: third.id, value: 1 }, 401);
  await visit({ action: 'register', ...credentials, login: 'cliptester@example.com' }, 409);
  const separate = await visit({
    action: 'register',
    ...credentials,
    login: 'SecondTester@example.com',
  });
  assert.deepEqual(separate.ratings, {});
});

test('длинный пароль проверяется целиком, пустой не принимается', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wave-password-test-'));
  const root = await startPreview(t, temp, { dbPath: path.join(temp, 'wave.sqlite3') });
  const visit = client(root + '/wave/api.php');
  const login = 'PasswordTester@example.com';
  const prefix = 'длинный пароль 🎵 '.repeat(20);
  const password = prefix + 'конец!';

  await visit();
  await visit({ action: 'register', login, password: '' }, 400);
  assert.equal(
    (await visit({ action: 'register', login, password })).username,
    login.toLowerCase(),
  );
  await visit({ action: 'logout' });
  await visit({ action: 'login', login, password: prefix + 'другой конец!' }, 401);
  assert.equal((await visit({ action: 'login', login, password })).username, login.toLowerCase());
});

test('пропуски и досмотры переносятся в аккаунт и сохраняются отдельно от оценок', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wave-playback-test-'));
  const root = await startPreview(t, temp, { dbPath: path.join(temp, 'wave.sqlite3') });
  const visit = client(root + '/wave/api.php');
  const credentials = { login: 'playback@example.invalid', password: 'test' };
  assert.deepEqual((await visit()).playback, {});
  await visit({ action: 'playback', id: first.id, value: 1 }, 401);
  const account = await visit({
    action: 'register',
    ...credentials,
    ratings: { [first.id]: 1 },
    playback: { [first.id]: -1, unknown: 1, [third.id]: 0 },
  });
  assert.deepEqual(account.playback, { [first.id]: -1 });
  await visit({ action: 'playback', id: 'unknown', value: 1 }, 400);
  await visit({ action: 'playback', id: first.id, value: 0 }, 400);
  await visit({ action: 'playback', id: first.id, value: 1, csrf: 'invalid' }, 403);
  await visit({ action: 'playback', id: first.id, value: 1 });
  await visit({ action: 'playback', id: first.id, value: 1 });
  assert.deepEqual((await visit({ action: 'logout' })).playback, {});
  const signedIn = await visit({
    action: 'login',
    ...credentials,
    playback: { [first.id]: -1, [second.id]: -1 },
  });
  assert.deepEqual(signedIn.playback, { [first.id]: 1, [second.id]: -1 });
  assert.deepEqual(signedIn.ratings, { [first.id]: 1 });
  await visit({ action: 'logout' });
  const other = await visit({ action: 'register', ...credentials, login: 'other@example.invalid' });
  assert.deepEqual(other.playback, {});
});

test('реакции сохраняются для встроенного клипа и клипа из обновлённой ленты', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wave-catalog-test-'));
  const dbPath = path.join(temp, 'wave.sqlite3');
  const root = await startPreview(t, temp, { dbPath });
  const embedded = catalog.find(({ provider }) => provider === 'rutube');
  const rutubeId = 'a'.repeat(32);
  const published = {
    ...embedded,
    id: `rutube-${rutubeId}`,
    source: `https://rutube.ru/video/${rutubeId}/`,
    embed: `https://rutube.ru/play/embed/${rutubeId}`,
  };
  const visit = client(root + '/wave/api.php');
  await visit();
  await visit({ action: 'register', login: 'catalog@example.invalid', password: 'test' });
  execFileSync('php', [
    '-r',
    `$db = new PDO('sqlite:' . $argv[1]);
     $db->prepare('INSERT INTO catalog_cache VALUES (1, ?, ?)')->execute([$argv[2], time() + 3600]);`,
    dbPath,
    JSON.stringify([published]),
  ]);
  const response = await fetch(root + '/wave/api.php?catalog=1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { clips: [published] });
  await visit({ action: 'rate', id: embedded.id, value: 1 });
  await visit({ action: 'rate', id: published.id, value: -1 });
  await visit({ action: 'rate', id: `rutube-${'b'.repeat(32)}`, value: 1 }, 400);
  assert.deepEqual((await visit()).ratings, { [embedded.id]: 1, [published.id]: -1 });
  await visit({ action: 'playback', id: published.id, value: 1 });
  assert.deepEqual((await visit()).playback, { [published.id]: 1 });
});

test('имя пользователя и оценки существующего аккаунта сохранены', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wave-legacy-test-'));
  const dbPath = path.join(temp, 'wave.sqlite3');
  const root = await startPreview(t, temp, { dbPath });
  execFileSync('php', [
    '-r',
    `$db = new PDO('sqlite:' . $argv[1]);
     $db->exec('CREATE TABLE users (
         id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
     );
     CREATE TABLE ratings (
         user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         clip_id TEXT NOT NULL, value INTEGER NOT NULL CHECK (value IN (-1, 1)),
         PRIMARY KEY (user_id, clip_id)
     );');
     $db->prepare('INSERT INTO users VALUES (7, ?, ?)')
         ->execute(['old_listener', password_hash('legacy-passphrase', PASSWORD_BCRYPT)]);
     $db->prepare('INSERT INTO ratings VALUES (7, ?, 1)')->execute([$argv[2]]);`,
    dbPath,
    first.id,
  ]);

  const visit = client(root + '/wave/api.php');
  await visit();
  const account = await visit({
    action: 'login',
    login: 'Old_Listener',
    password: 'legacy-passphrase',
  });
  assert.equal(account.username, 'old_listener');
  assert.deepEqual(account.ratings, { [first.id]: 1 });
});

test(
  'Wave разрешает SQLite в выделенном каталоге только с запретом HTTP',
  { timeout: 20000 },
  async (t) => {
    const temp = await mkdtemp(path.join(tmpdir(), 'wave-timeweb-test-'));
    const documentRoot = path.join(temp, 'public');
    const directory = path.join(documentRoot, '.wave-data');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await startPreview(t, temp, { documentRoot });
    const visit = client(root + '/wave/api.php');
    await visit();

    const login = {
      action: 'register',
      login: 'StorageTest@example.com',
      password: 'test-passphrase-for-storage',
    };
    await visit(login, 503);
    const denyFile = path.join(directory, '.htaccess');
    await writeFile(denyFile, 'Require all granted\n');
    await visit(login, 503);
    await writeFile(denyFile, await readFile(new URL('deploy/data.htaccess', app)));
    assert.equal((await visit(login)).username, 'storagetest@example.com');
    const database = await stat(path.join(directory, 'wave.sqlite3'));
    assert.equal(database.mode & 0o777, 0o600);
  },
);
