'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const repository = path.resolve(__dirname, '../../..');
const input = 'const value={items:[1,2]};';
const formatted = 'const value = { items: [1, 2] };\n';

function workspace(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox hooks-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.agents/hooks/scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repository, '.agents/hooks/scripts/format-touched.cjs'),
    path.join(root, '.agents/hooks/scripts/format-touched.cjs'),
  );
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.symlinkSync(
    path.join(repository, 'node_modules/prettier'),
    path.join(root, 'node_modules/prettier'),
    'dir',
  );
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return root;
}

const cases = [
  {
    name: 'Codex PostToolUse command input',
    config: '.codex/hooks.json',
    handler: (config) => config.hooks.PostToolUse[0].hooks[0],
    payload: (root, file) => ({
      cwd: root,
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-${input}\n+${input}\n*** End Patch`,
      },
    }),
  },
  {
    name: 'Claude Code PostToolUse Write input',
    config: '.claude/settings.json',
    handler: (config) => config.hooks.PostToolUse[0].hooks[0],
    payload: (root, file) => ({
      cwd: root,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: file, content: input },
      tool_response: { filePath: file, type: 'create' },
    }),
  },
  {
    name: 'Cursor afterFileEdit input',
    config: '.cursor/hooks.json',
    handler: (config) => config.hooks.afterFileEdit[0],
    payload: (root, file) => ({
      hook_event_name: 'afterFileEdit',
      workspace_roots: [root],
      file_path: file,
      edits: [{ old_string: '', new_string: input }],
    }),
  },
];

for (const scenario of cases) {
  test(`configured ${scenario.name} runs real Prettier and leaves private/unrelated files unchanged`, (t) => {
    const root = workspace(t);
    const config = JSON.parse(fs.readFileSync(path.join(repository, scenario.config), 'utf8'));
    const command = scenario.handler(config).command;
    const file = path.join(root, 'edited.js');
    const untouched = path.join(root, 'untouched.js');
    fs.writeFileSync(file, input);
    fs.writeFileSync(untouched, input);
    const invoke = (target) => {
      const result = spawnSync('sh', ['-c', command], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        input: JSON.stringify(scenario.payload(root, target)),
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), {});
    };
    invoke(file);
    assert.equal(fs.readFileSync(file, 'utf8'), formatted);
    assert.equal(fs.readFileSync(untouched, 'utf8'), input);

    for (const relative of ['.imports/private/credentials.json', '.aws/sso/cache/session.json']) {
      const secret = path.join(root, relative);
      const original = '{"synthetic":"fixture"}';
      fs.mkdirSync(path.dirname(secret), { recursive: true });
      fs.writeFileSync(secret, original);
      invoke(secret);
      assert.equal(fs.readFileSync(secret, 'utf8'), original);
    }
  });
}
