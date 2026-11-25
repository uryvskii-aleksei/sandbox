import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-dev-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'apps/memo');
  const previous = path.join(root, 'apps/mind-assistant');
  const bin = path.join(root, 'bin');
  for (const directory of [path.join(app, 'scripts'), previous, bin])
    fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(
    new URL('../scripts/dev.mjs', import.meta.url),
    path.join(app, 'scripts/dev.mjs'),
  );
  // Проверяем подготовку реального dev-скрипта без запуска внешних сервисов.
  for (const name of ['docker', 'npm'])
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  return {
    environment: path.join(app, '.env'),
    previous: path.join(previous, '.env'),
    start() {
      const result = spawnSync(process.execPath, [path.join(app, 'scripts/dev.mjs')], {
        cwd: app,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    },
  };
}

test('renaming preserves the previous local database credentials and restricts the new file', (t) => {
  const fixture = workspace(t);
  const credentials = 'DB_NAME=existing\nDB_PASSWORD=Synthetic-existing-password\n';
  fs.writeFileSync(fixture.previous, credentials, { mode: 0o600 });
  assert.ok(!fixture.start().includes(credentials));
  assert.equal(fs.readFileSync(fixture.environment, 'utf8'), credentials);
  assert.equal(fs.readFileSync(fixture.previous, 'utf8'), credentials);
  assert.equal(fs.statSync(fixture.environment).mode & 0o777, 0o600);
});

test('an existing Memo environment takes precedence and is never overwritten', (t) => {
  const fixture = workspace(t);
  fs.writeFileSync(fixture.previous, 'DB_PASSWORD=Synthetic-old-password\n');
  const current = 'DB_PASSWORD=Synthetic-current-password\n';
  fs.writeFileSync(fixture.environment, current, { mode: 0o600 });
  fixture.start();
  assert.equal(fs.readFileSync(fixture.environment, 'utf8'), current);
});

test('a fresh setup creates private credentials and reuses them on subsequent starts', (t) => {
  const fixture = workspace(t);
  const output = fixture.start();
  const current = fs.readFileSync(fixture.environment, 'utf8');
  const password = current.match(/^DB_PASSWORD=(.+)$/m)?.[1];
  assert.ok(password && password.length >= 32);
  assert.ok(!output.includes(password));
  assert.equal(fs.statSync(fixture.environment).mode & 0o777, 0o600);
  fixture.start();
  assert.equal(fs.readFileSync(fixture.environment, 'utf8'), current);
});
