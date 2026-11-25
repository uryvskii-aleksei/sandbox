import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSite } from './build-sites.mjs';
import { createPreviewServer } from './preview-sites.mjs';

const purpurSource = fileURLToPath(new URL('../apps/purpur/site/', import.meta.url));

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

test('Purpur build places the main page and legacy versions inside one public mount', (t) => {
  const f = fixture(t);
  f.write('purpur/site/index.html', 'Purpur main');
  f.write('purpur/site/.htaccess', 'RewriteEngine On\n');
  f.write('purpur/site/assets/product.png', Buffer.from([0, 128, 255]));
  for (const version of ['v1', 'v2', 'v3']) {
    f.write(`purpur/site/purpur/${version}/index.html`, `Purpur ${version}`);
    f.write(`purpur/site/purpur/${version}/catalog/index.html`, `Catalog ${version}`);
  }
  const output = buildSite(path.join(f.root, 'purpur'));
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'Purpur main');
  assert.equal(fs.readFileSync(path.join(output, '.htaccess'), 'utf8'), 'RewriteEngine On\n');
  assert.deepEqual(
    fs.readFileSync(path.join(output, 'assets/product.png')),
    Buffer.from([0, 128, 255]),
  );
  for (const version of ['v1', 'v2', 'v3']) {
    assert.equal(
      fs.readFileSync(path.join(output, version, 'index.html'), 'utf8'),
      `Purpur ${version}`,
    );
    assert.equal(
      fs.readFileSync(path.join(output, version, 'catalog/index.html'), 'utf8'),
      `Catalog ${version}`,
    );
  }
  assert.equal(fs.existsSync(path.join(output, 'purpur')), false);
});

test('Stonehaus build keeps its selector and all version pages at the mount root', (t) => {
  const f = fixture(t);
  f.write('stonehaus/site/index.html', 'Stone Haus selector');
  for (const version of ['v1', 'v2', 'v3']) {
    f.write(`stonehaus/site/${version}/index.html`, `Stone Haus ${version}`);
  }
  const output = buildSite(path.join(f.root, 'stonehaus'));
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'Stone Haus selector');
  for (const version of ['v1', 'v2', 'v3']) {
    assert.equal(
      fs.readFileSync(path.join(output, version, 'index.html'), 'utf8'),
      `Stone Haus ${version}`,
    );
  }
});

function purpurFile(publicUrl) {
  const relative = publicUrl.pathname.slice('/purpur/'.length);
  return path.join(purpurSource, /^(?:v1|v2|v3)\//.test(relative) ? 'purpur' : '', relative);
}

test('Purpur page resources resolve within its public mount and retain their version assets', () => {
  for (const page of ['', 'v1/', 'v2/', 'v3/']) {
    const url = new URL(`/purpur/${page}`, 'https://example.test');
    const html = fs.readFileSync(purpurFile(new URL('index.html', url)), 'utf8');
    const references = [...html.matchAll(/\b(?:src|href|poster)="([^"]+)"/g)];
    assert.ok(references.length > 0);
    for (const [, reference] of references) {
      if (reference.startsWith('#')) continue;
      const resource = new URL(reference, url);
      if (resource.origin !== url.origin) continue;
      assert.ok(resource.pathname.startsWith('/purpur/'), `${url.pathname}: ${reference}`);
      const target = purpurFile(resource);
      assert.ok(fs.existsSync(target), `${url.pathname}: missing ${resource.pathname}`);
    }
  }
});

test('Purpur order and delivery requests stay within the app mount', () => {
  for (const script of ['concept/concept.js', 'purpur/v1/concept/concept.js']) {
    const source = fs.readFileSync(path.join(purpurSource, script), 'utf8');
    const routes = [...source.matchAll(/['"`](\/(?!\/)[^'"`]+)['"`]/g)]
      .map(([, route]) => route.split('?')[0])
      .filter((route) => route.endsWith('.php'));
    assert.ok(routes.length > 0);
    for (const route of routes) {
      const url = new URL(route, 'https://example.test/purpur/');
      assert.ok(url.pathname.startsWith('/purpur/'), `${script}: ${route}`);
      assert.ok(fs.existsSync(purpurFile(url)), `${script}: missing ${route}`);
    }
  }
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
    { prefix: '/purpur/v3/', root: path.join(f.root, 'purpur/purpur/v3') },
    { prefix: '/purpur/', root: path.dirname(root) },
    { prefix: '/stonehaus/', root: path.join(f.root, 'stonehaus') },
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base + '/purpur/')).text(), 'Purpur');
  assert.equal(await (await fetch(base + '/purpur/v3/')).text(), 'Purpur v3');
  assert.equal(await (await fetch(base + '/stonehaus/v2/')).text(), 'Stone Haus v2');
  assert.equal((await fetch(base + '/purpur/order.php')).status, 501);
  assert.equal((await fetch(base + '/purpur/.env')).status, 403);
  assert.equal((await fetch(base + '/purpur/escape.txt')).status, 403);
  assert.equal((await fetch(base + '/order.php')).status, 404);
  assert.equal((await fetch(base + '/purpur/', { method: 'POST' })).status, 405);
});
