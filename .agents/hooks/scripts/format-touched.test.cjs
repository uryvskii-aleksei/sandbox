'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const { collectPaths, safeFile, findPrettier, formatTouched } = require('./format-touched.cjs');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-format-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content = 'original') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  const formatter = (directory, value) => {
    write(`${directory}node_modules/prettier/package.json`, JSON.stringify({ bin: 'cli.cjs' }));
    return write(
      `${directory}node_modules/prettier/cli.cjs`,
      `const fs = require('node:fs'); for (const f of process.argv.slice(4)) fs.writeFileSync(f, ${JSON.stringify(value)});`,
    );
  };
  return { root, write, formatter };
}

test('events from all runtimes identify only edited paths', () => {
  assert.deepEqual(collectPaths({ tool_input: { file_path: 'a.ts' } }), ['a.ts']);
  assert.deepEqual(collectPaths({ file_path: 'b.ts' }), ['b.ts']);
  assert.deepEqual(
    collectPaths({
      arguments: {
        input: '*** Begin Patch\n*** Update File: c.ts\n*** Add File: d.ts\n*** End Patch',
      },
    }),
    ['c.ts', 'd.ts'],
  );
  assert.deepEqual(collectPaths({ input: JSON.stringify({ file_path: 'e.ts' }) }), ['e.ts']);
});

test('formats edited files with their owning formatter and preserves unrelated files', (t) => {
  const f = fixture(t);
  f.formatter('', 'root-formatted');
  const own = f.formatter('apps/first/', 'app-formatted');
  const first = f.write('apps/first/src/a.js');
  const second = f.write('apps/second/b.js');
  const untouched = f.write('apps/first/src/untouched.js');
  assert.equal(findPrettier(f.root, first).cli, own);
  assert.deepEqual(formatTouched(f.root, { paths: [first, first, second] }), []);
  assert.equal(fs.readFileSync(first, 'utf8'), 'app-formatted');
  assert.equal(fs.readFileSync(second, 'utf8'), 'root-formatted');
  assert.equal(fs.readFileSync(untouched, 'utf8'), 'original');
});

test('never borrows a sibling formatter or follows an escaping symlink', (t) => {
  const f = fixture(t);
  f.formatter('apps/first/', 'wrong-formatter');
  const second = f.write('apps/second/b.js');
  assert.equal(findPrettier(f.root, second), null);
  const external = fixture(t);
  const outside = external.write('secret.json');
  const link = path.join(f.root, 'linked.json');
  fs.symlinkSync(outside, link);
  assert.equal(safeFile(f.root, link, f.root), null);
  assert.equal(safeFile(f.root, f.write('.env.json'), f.root), null);
  assert.equal(safeFile(f.root, f.write('.codex/auth.json'), f.root), null);
  assert.equal(safeFile(f.root, 'deleted.js', f.root), null);
});

test('hook fails open on malformed input without modifying files', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'format-touched.cjs')], {
    input: '{invalid',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}\n');
  assert.match(result.stderr, /format-touched:/);
});

test('an event from another workspace cannot format a matching relative path', (t) => {
  const f = fixture(t);
  f.formatter('', 'unexpected');
  const file = f.write('a.js');
  const other = fixture(t);
  assert.deepEqual(formatTouched(f.root, { cwd: other.root, file_path: 'a.js' }), []);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});
