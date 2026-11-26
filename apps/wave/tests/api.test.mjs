import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const app = new URL('../', import.meta.url);
const [first, second, third] = JSON.parse(
  await readFile(new URL('site/catalog.json', app), 'utf8'),
);

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
  const credentials = { login: 'ClipTester', password: 'testing-only-passphrase' };
  await visit({ action: 'register', ...credentials, csrf: 'invalid' }, 403);
  await visit({ action: 'rate', id: first.id, value: 1 }, 401);

  const account = await visit(
    { action: 'register', ...credentials, ratings: { [first.id]: 1, unknown: 1 } },
    200,
  );
  assert.equal(account.username, 'cliptester');
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
    ratings: { [first.id]: -1, [third.id]: 1 },
  });
  assert.deepEqual(reloaded.ratings, { [first.id]: 1, [second.id]: -1, [third.id]: 1 });
  await otherVisit({ action: 'rate', id: second.id, value: 0 });
  assert.deepEqual((await visit()).ratings, { [first.id]: 1, [third.id]: 1 });

  const signedOut = await visit({ action: 'logout' });
  assert.equal(signedOut.username, null);
  assert.deepEqual(signedOut.ratings, {});
  await visit({ action: 'rate', id: third.id, value: 1 }, 401);
  await visit({ action: 'register', ...credentials }, 409);
  const separate = await visit({ action: 'register', ...credentials, login: 'SecondTester' });
  assert.deepEqual(separate.ratings, {});
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
      login: 'StorageTest',
      password: 'test-passphrase-for-storage',
    };
    await visit(login, 503);
    const denyFile = path.join(directory, '.htaccess');
    await writeFile(denyFile, 'Require all granted\n');
    await visit(login, 503);
    await writeFile(denyFile, await readFile(new URL('deploy/data.htaccess', app)));
    assert.equal((await visit(login)).username, 'storagetest');
    const database = await stat(path.join(directory, 'wave.sqlite3'));
    assert.equal(database.mode & 0o777, 0o600);
  },
);
