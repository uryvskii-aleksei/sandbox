import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkRoleAdapters } from './lib/agent-roles.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-roles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  };
  const add = (role) => {
    write(`.agents/roles/${role}.md`, `---\nname: ${role}\ndescription: Test role.\n---\n`);
    write(
      `.codex/agents/${role}.toml`,
      `name = "${role}"\ndeveloper_instructions = "Read .agents/roles/${role}.md"\n`,
    );
    for (const runtime of ['.claude', '.cursor']) {
      write(
        `${runtime}/agents/${role}.md`,
        `---\nname: ${role}\n---\nRead @.agents/roles/${role}.md\n`,
      );
    }
  };
  return { root, write, add };
}

test('discovers additional roles without a hardcoded roster', (t) => {
  const f = fixture(t);
  f.add('qa');
  f.add('designer');
  assert.deepEqual(checkRoleAdapters(f.root), { roles: ['designer', 'qa'], errors: [] });
});

test('rejects missing adapters and links to another canonical role', (t) => {
  const f = fixture(t);
  f.add('qa');
  fs.unlinkSync(path.join(f.root, '.cursor/agents/qa.md'));
  f.write(
    '.codex/agents/qa.toml',
    'name = "qa"\ndeveloper_instructions = "Read .agents/roles/coder.md"\n',
  );
  const { errors } = checkRoleAdapters(f.root);
  assert.ok(errors.some((message) => message.includes('.cursor/agents/qa.md')));
  assert.ok(errors.some((message) => message.includes('.codex/agents/qa.toml')));
});

test('rejects stale adapters and mismatched role identities', (t) => {
  const f = fixture(t);
  f.add('qa');
  f.write('.claude/agents/qa.md', '---\nname: coder\n---\nRead @.agents/roles/qa.md\n');
  f.write('.cursor/agents/removed.md', '---\nname: removed\n---\n');
  const { errors } = checkRoleAdapters(f.root);
  assert.ok(errors.some((message) => message.includes('.claude/agents/qa.md')));
  assert.ok(errors.some((message) => message.includes('.cursor/agents/removed.md')));
});

test('rejects an adapter symlink escaping the owned workspace', (t) => {
  const f = fixture(t);
  f.add('qa');
  f.write('outside.md', '---\nname: qa\n---\nRead @.agents/roles/qa.md\n');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-outside-role-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.copyFileSync(path.join(f.root, 'outside.md'), path.join(outside, 'qa.md'));
  const adapter = path.join(f.root, '.cursor/agents/qa.md');
  fs.unlinkSync(adapter);
  fs.symlinkSync(path.join(outside, 'qa.md'), adapter);
  assert.ok(
    checkRoleAdapters(f.root).errors.some((message) => message.includes('.cursor/agents/qa.md')),
  );
});
