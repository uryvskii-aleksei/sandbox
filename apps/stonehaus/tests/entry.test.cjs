'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

test('Stonehaus entry serves all three versions and their local assets under /stonehaus/', async (t) => {
  const { createPreviewServer } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../scripts/preview-sites.mjs')).href
  );
  const server = createPreviewServer([
    { prefix: '/stonehaus/', root: path.resolve(__dirname, '../site') },
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const base = new URL(`http://127.0.0.1:${server.address().port}/stonehaus/`);
  const response = await fetch(base, { redirect: 'manual' });
  assert.equal(response.status, 200);
  const entry = await response.text();
  assert.doesNotMatch(entry, /http-equiv\s*=\s*["']refresh["']/i);

  const links = [...entry.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
    .map(([, href]) => href)
    .filter((href) => !href.startsWith('#'));
  assert.deepEqual(links.sort(), ['v1/', 'v2/', 'v3/']);

  for (const href of ['', ...links]) {
    const pageUrl = new URL(href, base);
    const pageResponse = await fetch(pageUrl);
    assert.equal(pageResponse.status, 200, pageUrl.href);
    const html = await pageResponse.text();
    assert.match(html, /<h1\b[^>]*>.+?<\/h1>/s);
    assert.doesNotMatch(html, /cj999935\.tw1\.ru/);
    const assets = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)]
      .map(([, asset]) => new URL(asset, pageUrl))
      .filter((asset) => asset.origin === base.origin);
    assert.ok(assets.length > 0, `Нет локальных ресурсов: ${pageUrl.href}`);
    for (const asset of assets) {
      assert.ok(asset.pathname.startsWith('/stonehaus/'), asset.href);
      const assetResponse = await fetch(asset);
      assert.equal(assetResponse.status, 200, asset.href);
      assert.ok((await assetResponse.text()).length > 0, asset.href);
    }

    if (href === 'v2/') {
      const versionLink = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>Версия v1<\/a>/g)];
      assert.equal(versionLink.length, 1);
      const v1 = new URL(versionLink[0][1], pageUrl);
      assert.equal(v1.href, new URL('v1/', base).href);
    }
  }
});
