import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildSite } from './build-sites.mjs';
import { createPreviewServer } from './preview-sites.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  return { root, write };
}

test('building preserves original bytes, refreshes generated output and retains server configuration', (t) => {
  const f = fixture(t);
  f.write('site/index.html', '<h1>Original</h1>');
  f.write('site/.htaccess', 'RewriteEngine On\n');
  f.write('site/assets/font.bin', Buffer.from([0, 128, 255]));
  f.write('dist/stale.html', 'old build');
  const output = buildSite(f.root);
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), '<h1>Original</h1>');
  assert.deepEqual(
    fs.readFileSync(path.join(output, 'assets/font.bin')),
    Buffer.from([0, 128, 255]),
  );
  assert.equal(fs.readFileSync(path.join(output, '.htaccess'), 'utf8'), 'RewriteEngine On\n');
  assert.equal(fs.existsSync(path.join(output, 'stale.html')), false);
});

test('preview preserves both path namespaces and does not disclose PHP or private paths', async (t) => {
  const f = fixture(t);
  const root = f.write('purpur/index.html', 'Purpur');
  f.write('purpur/purpur/v3/index.html', 'Purpur v3');
  f.write('purpur/order.php', '<?php privateImplementation();');
  f.write('purpur/.env', 'PRIVATE=value');
  f.write('stonehaus/v2/index.html', 'Stone Haus v2');
  const secret = f.write('outside.txt', 'outside');
  fs.symlinkSync(secret, path.join(f.root, 'purpur/escape.txt'));
  const server = createPreviewServer([
    { prefix: '/', root: path.dirname(root) },
    { prefix: '/stonehaus/', root: path.join(f.root, 'stonehaus') },
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base + '/')).text(), 'Purpur');
  assert.equal(await (await fetch(base + '/purpur/v3/')).text(), 'Purpur v3');
  assert.equal(await (await fetch(base + '/stonehaus/v2/')).text(), 'Stone Haus v2');
  assert.equal((await fetch(base + '/order.php')).status, 501);
  assert.equal((await fetch(base + '/.env')).status, 403);
  assert.equal((await fetch(base + '/escape.txt')).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});
