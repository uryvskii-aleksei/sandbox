import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { parseArguments, runDeploySites } from './deploy-sites.mjs';
import {
  assertStonehausTargets,
  siteRemoteRoot,
  validateSiteTarget,
} from './lib/site-deploy-targets.mjs';
import { readTargets } from './lib/timeweb-targets.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = (app = 'purpur') =>
  JSON.parse(fs.readFileSync(path.join(repository, 'apps', app, 'deploy/timeweb.json'), 'utf8'));

test('site publication has an explicit app/action and cannot silently apply a plan', () => {
  assert.deepEqual(parseArguments(['plan', 'purpur']), { action: 'plan', app: 'purpur' });
  assert.deepEqual(parseArguments(['publish', 'stonehaus', '--apply']), {
    action: 'publish',
    app: 'stonehaus',
  });
  for (const args of [
    [],
    ['publish', 'purpur'],
    ['plan', 'purpur', '--apply'],
    ['publish', 'all', '--apply'],
    ['publish', 'purpur;unsafe', '--apply'],
    ['publish', 'stonehaus', '--apply', '--force'],
  ])
    assert.throws(() => parseArguments(args));
});

test('site destinations preserve ownership and prohibit credential/command/URL escapes', () => {
  for (const app of ['purpur', 'stonehaus'])
    assert.equal(validateSiteTarget(manifest(app), app).app, app);
  const purpur = manifest();
  assert.equal(siteRemoteRoot(purpur), '/home/c/cj999935/.sandbox/site-deploy/purpur');
  for (const change of [
    { sshHost: '-oProxyCommand=unsafe' },
    { user: 'name;unsafe' },
    { publicPath: '/home/c/cj999935/public_html/mind-assistant' },
    { ownedDirectories: ['assets', 'mind-assistant'] },
    { ownedFiles: ['config.local.php'] },
    { ownedFiles: ['../index.html'] },
    { url: 'https://user:password@example.test/' },
    { url: 'https://example.test/other/' },
    { url: 'http://example.test/' },
    { checks: [{ path: 'https://other.test/', status: 200 }] },
  ])
    assert.throws(() => validateSiteTarget({ ...purpur, ...change }, 'purpur'));
  assert.throws(() =>
    validateSiteTarget(
      { ...manifest('stonehaus'), publicPath: '/home/c/cj999935/public_html' },
      'stonehaus',
    ),
  );
});

test('dirty or stale source and unverified CI fail before build, SSH or data transfer', async () => {
  const commit = 'a'.repeat(40);
  for (const condition of ['dirty', 'stale', 'ci']) {
    const commands = [];
    const run = (command, args) => {
      commands.push(command);
      if (command !== 'git') throw new Error('Unexpected external command');
      if (args[0] === 'rev-parse') return { status: 0, stdout: commit };
      if (args[0] === 'status')
        return { status: 0, stdout: condition === 'dirty' ? ' M file' : '' };
      return {
        status: 0,
        stdout: `${condition === 'stale' ? 'b'.repeat(40) : commit}\trefs/heads/main`,
      };
    };
    await assert.rejects(
      runDeploySites(['publish', 'purpur', '--apply'], {
        run,
        checkCi: async () => {
          throw new Error('CI not ready');
        },
        log: () => {},
      }),
    );
    assert.ok(commands.every((command) => command === 'git'));
  }
});

test('the Stonehaus site manifest agrees with all three registered static destinations', () => {
  const target = manifest('stonehaus');
  const targets = readTargets(repository);
  assertStonehausTargets(target, targets);
  assert.throws(() =>
    assertStonehausTargets(target, {
      ...targets,
      'stonehaus-v2': {
        ...targets['stonehaus-v2'],
        remotePath: '/home/c/cj999935/public_html/mind-assistant',
      },
    }),
  );
  assert.throws(() => assertStonehausTargets(target, {}));
});

test('malformed producer metadata cannot become a remote SSH command', async () => {
  const commit = 'a'.repeat(40);
  const commands = [];
  const run = (command, args) => {
    commands.push(command);
    if (command === 'git') {
      if (args[0] === 'rev-parse') return { status: 0, stdout: commit };
      if (args[0] === 'status') return { status: 0, stdout: '' };
      return { status: 0, stdout: `${commit}\trefs/heads/main` };
    }
    if (command === 'npm') return { status: 0 };
    if (command === 'python3')
      return {
        status: 0,
        stdout: JSON.stringify({ commit, files: 10, sha256: 'digest; unsafe command' }),
      };
    throw new Error('Unexpected SSH call');
  };
  await assert.rejects(
    runDeploySites(['publish', 'purpur', '--apply'], {
      run,
      checkCi: async () => {},
      log: () => {},
    }),
    /идентичность/,
  );
  assert.ok(!commands.includes('ssh'));
});

test('file delivery preserves sibling apps and exercises backup, rollback and hostile paths', () => {
  const result = spawnSync(
    'python3',
    ['-m', 'unittest', 'discover', '-s', 'infra/timeweb/site-deploy', '-p', 'test_*.py'],
    { cwd: repository, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
