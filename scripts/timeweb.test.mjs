import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { artifactPath, validateTargets } from './lib/timeweb-targets.mjs';
import { runTimeweb } from './timeweb.mjs';

const target = {
  app: 'apps/example',
  buildDir: 'dist',
  sshHost: 'timeweb-test',
  remotePath: 'example/public_html',
  url: 'https://app.example.com/',
};
const registry = (targets) => ({ version: 1, provider: 'timeweb-shared', targets });

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-timeweb-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'infra/timeweb'), { recursive: true });
  fs.mkdirSync(path.join(root, target.app, target.buildDir), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'infra/timeweb/targets.json'),
    JSON.stringify(registry({ example: target })),
  );
  fs.writeFileSync(
    path.join(root, 'infra/timeweb/connection.json'),
    JSON.stringify({
      version: 1,
      sshHost: target.sshHost,
      remotePath: 'public_html',
      url: 'https://example.com/',
    }),
  );
  fs.writeFileSync(path.join(root, target.app, target.buildDir, 'index.html'), '<h1>Test</h1>');
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  return { root, calls, run, options: { repoRoot: root, run, log: () => {} } };
}

test('rejects path escape, command injection and overlapping destinations', () => {
  for (const [field, value] of [
    ['app', 'packages/example'],
    ['buildDir', '../'],
    ['buildDir', '.'],
    ['buildDir', '.git'],
    ['buildDir', 'node_modules/export'],
    ['sshHost', '-oProxyCommand=bad'],
    ['remotePath', 'site/public_html; touch /tmp/bad'],
    ['remotePath', '/'],
    ['remotePath', 'site/public_html/../other'],
    ['url', 'https://user:password@example.com/'],
    ['url', 'http://example.com/'],
  ]) {
    assert.throws(() => validateTargets(registry({ example: { ...target, [field]: value } })));
  }
  assert.throws(
    () =>
      validateTargets(
        registry({ one: target, two: { ...target, remotePath: 'example/public_html/child' } }),
      ),
    /пересекаются/,
  );
  assert.throws(() => validateTargets(registry({ one: { ...target, password: 'secret' } })));
  assert.deepEqual(validateTargets(registry({})), {});
});

test('plan performs SSH checks and a dry run without deleting remote files', (t) => {
  const f = fixture(t);
  runTimeweb(['plan', 'example'], f.options);
  assert.deepEqual(
    f.calls.map((call) => call.command),
    ['ssh', 'rsync'],
  );
  const transfer = f.calls[1];
  assert.ok(transfer.args.includes('--dry-run'));
  assert.ok(!transfer.args.some((arg) => arg.startsWith('--delete')));
  assert.equal(transfer.args.at(-1), 'timeweb-test:example/public_html/');
  assert.equal(transfer.args.at(-2), `${path.join(f.root, 'apps/example/dist')}/`);
  assert.equal(transfer.options.shell, false);
  assert.ok(f.calls[0].args.includes('StrictHostKeyChecking=yes'));
});

test('publishing requires an explicit apply flag and never becomes a dry run by mistake', (t) => {
  const f = fixture(t);
  assert.throws(() => runTimeweb(['publish', 'example'], f.options));
  assert.equal(f.calls.length, 0);
  runTimeweb(['publish', 'example', '--apply'], f.options);
  assert.ok(!f.calls[1].args.includes('--dry-run'));
  assert.throws(() => runTimeweb(['plan', 'example', '--apply'], f.options));
});

test('unknown target and failed SSH preflight cannot transfer files', (t) => {
  const f = fixture(t);
  assert.throws(() => runTimeweb(['plan', 'missing'], f.options), /не настроена/);
  assert.equal(f.calls.length, 0);
  const calls = [];
  assert.throws(
    () =>
      runTimeweb(['publish', 'example', '--apply'], {
        ...f.options,
        run: (command) => {
          calls.push(command);
          return { status: 255 };
        },
      }),
    /255/,
  );
  assert.deepEqual(calls, ['ssh']);
});

test('check needs no build and makes only a read-only SSH request', (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, 'apps/example/dist'), { recursive: true });
  runTimeweb(['check', 'example'], f.options);
  assert.deepEqual(
    f.calls.map((call) => call.command),
    ['ssh'],
  );
  assert.match(f.calls[0].args.at(-1), /test -d/);
  assert.doesNotMatch(f.calls[0].args.at(-1), /mkdir|rm |touch/);
});

test('private files and symlinks fail before any network operation', (t) => {
  const f = fixture(t);
  const output = path.join(f.root, 'apps/example/dist');
  fs.writeFileSync(path.join(output, '.env.production'), 'PRIVATE=example');
  assert.throws(() => runTimeweb(['plan', 'example'], f.options), /Служебный/);
  assert.equal(f.calls.length, 0);
  fs.unlinkSync(path.join(output, '.env.production'));
  const outside = path.join(f.root, 'private.json');
  fs.writeFileSync(outside, '{}');
  fs.symlinkSync(outside, path.join(output, 'data.json'));
  assert.throws(() => artifactPath(f.root, target), /symlink/);
  fs.unlinkSync(path.join(output, 'data.json'));
  fs.rmSync(output, { recursive: true });
  fs.mkdirSync(path.join(f.root, 'other-output'));
  fs.writeFileSync(path.join(f.root, 'other-output/index.html'), 'private');
  fs.symlinkSync(path.join(f.root, 'other-output'), output);
  assert.throws(() => artifactPath(f.root, target), /внутри своего приложения/);
});

test('account check works with no applications and cannot publish the site root', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'infra/timeweb/targets.json'), JSON.stringify(registry({})));
  fs.rmSync(path.join(f.root, 'apps'), { recursive: true });
  runTimeweb(['check'], f.options);
  assert.deepEqual(
    f.calls.map((call) => call.command),
    ['ssh'],
  );
  assert.match(f.calls[0].args.at(-1), /test -d 'public_html'/);
  assert.throws(() => runTimeweb(['plan'], f.options));
  assert.throws(() => runTimeweb(['publish', '--apply'], f.options));
  assert.equal(f.calls.length, 1);
});

test('invalid account configuration is rejected before SSH', (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.root, 'infra/timeweb/connection.json'),
    JSON.stringify({
      version: 1,
      sshHost: '-unsafe',
      remotePath: 'public_html',
      url: 'https://example.com/',
    }),
  );
  assert.throws(() => runTimeweb(['check'], f.options), /SSH alias/);
  assert.equal(f.calls.length, 0);
});
