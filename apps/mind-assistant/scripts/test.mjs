import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const phpVersion = process.env.MIND_ASSISTANT_TEST_PHP_VERSION ?? '8.4';
if (!['8.2', '8.4'].includes(phpVersion)) throw new Error('Проверяются PHP 8.2 или 8.4.');

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-assistant-test-'));
const environment = path.join(temporary, '.env');
const listener = net.createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
fs.writeFileSync(
  environment,
  `PHP_VERSION=${phpVersion}\nDB_NAME=mindassistant_test\nDB_USER=mindassistant\nDB_PASSWORD=${randomBytes(24).toString('hex')}\nAPI_PORT=${port}\n`,
  { mode: 0o600 },
);
const project = `sandbox-mind-assistant-test-${process.pid}`;
const compose = [
  'compose',
  '-p',
  project,
  '--env-file',
  environment,
  '-f',
  path.join(app, 'compose.yml'),
];
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: app, env, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(`Не выполнено: ${command} ${args[0] ?? ''}`);
};
let started = false;
let artifactStarted = false;
const artifactName = `${project}-artifact`;
try {
  run('npm', ['run', 'build', '--workspace=@sandbox/mind-assistant']);
  started = true;
  run('docker', [...compose, 'up', '--build', '--wait', '-d']);
  run('docker', [
    ...compose,
    'exec',
    '-T',
    'api',
    'sh',
    '-c',
    'find src public database -name "*.php" -exec php -l {} \\;',
  ]);
  run('docker', [...compose, 'exec', '-T', 'api', 'php', 'database/migrate.php']);
  run('docker', [...compose, 'exec', '-T', 'api', 'php', 'database/migrate.php']);
  run(process.execPath, ['--test', 'tests/api.test.mjs'], {
    ...process.env,
    MIND_ASSISTANT_TEST_URL: `http://127.0.0.1:${port}/api`,
  });
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    artifactName,
    '--network',
    `${project}_default`,
    '--publish',
    '127.0.0.1::80',
    '--env-file',
    environment,
    '--env',
    'DB_HOST=db',
    '--env',
    'APP_ENV=development',
    '--volume',
    `${path.join(app, 'dist')}:/var/www/mind-assistant/public/mind-assistant:ro`,
    `${project}-api`,
  ]);
  artifactStarted = true;
  const mapping = spawnSync('docker', ['port', artifactName, '80'], { encoding: 'utf8' });
  const artifactPort = mapping.stdout?.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (mapping.status !== 0 || !artifactPort)
    throw new Error('Не найден порт собранного приложения.');
  const base = `http://127.0.0.1:${artifactPort}/mind-assistant`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      ready = (await fetch(`${base}/api/health`)).ok;
    } catch {
      /* Apache запускается. */
    }
    if (ready) break;
    await setTimeout(200);
  }
  assert.equal(ready, true, 'Собранный API не запустился.');
  const index = await (await fetch(`${base}/`)).text();
  assert.match(index, /<title>MindAssistant/);
  assert.equal(
    await (await fetch(`${base}/workplace/123`)).text(),
    index,
    'SPA-маршрут должен обновляться.',
  );
  for (const match of index.matchAll(/(?:src|href)="(\/mind-assistant\/assets\/[^\"]+)"/g)) {
    assert.equal((await fetch(`http://127.0.0.1:${artifactPort}${match[1]}`)).status, 200);
  }
  for (const privatePath of [
    'backend/bootstrap.php',
    'database/schema.sql',
    'config.example.php',
  ]) {
    assert.equal((await fetch(`${base}/${privatePath}`)).status, 403, privatePath);
  }
  run('docker', ['exec', artifactName, 'php', 'public/mind-assistant/database/migrate.php']);
  run(process.execPath, ['--test', 'tests/api.test.mjs'], {
    ...process.env,
    MIND_ASSISTANT_TEST_URL: `${base}/api`,
  });
  console.log('Собранный React/PHP: ресурсы, SPA, закрытые файлы и полный API проверены.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (artifactStarted) {
    const cleanup = spawnSync('docker', ['stop', artifactName], { stdio: 'inherit' });
    if (cleanup.error || cleanup.status !== 0) process.exitCode = 1;
  }
  // Только отдельный проект тестов. Рабочий mysql-data приложения не затрагивается.
  if (started) {
    const cleanup = spawnSync('docker', [...compose, 'down', '--volumes'], {
      cwd: app,
      stdio: 'inherit',
    });
    if (cleanup.error || cleanup.status !== 0) process.exitCode = 1;
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
