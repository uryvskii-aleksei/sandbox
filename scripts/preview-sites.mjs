import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Показывает оба сайта под их публичными путями без копирования исходников. */
export function createPreviewServer(
  mounts = [
    ...['v1', 'v2', 'v3'].map((version) => ({
      prefix: `/purpur/${version}/`,
      root: path.join(repo, 'apps/purpur/site/purpur', version),
    })),
    { prefix: '/purpur/', root: path.join(repo, 'apps/purpur/site') },
    { prefix: '/stonehaus/', root: path.join(repo, 'apps/stonehaus/site') },
  ],
) {
  const resolved = mounts
    .map((mount) => ({ ...mount, root: fs.realpathSync(mount.root) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.split('/').some((part) => part.startsWith('.'))) {
        response.writeHead(403).end();
        return;
      }
      const mount = resolved.find((item) => pathname.startsWith(item.prefix));
      if (!mount) {
        response.writeHead(404).end();
        return;
      }
      let file = path.resolve(mount.root, pathname.slice(mount.prefix.length));
      if (fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        file = path.join(file, 'index.html');
      }
      file = fs.realpathSync(file);
      const relative = path.relative(mount.root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end();
        return;
      }
      if (path.extname(file).toLowerCase() === '.php') {
        response
          .writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' })
          .end(JSON.stringify({ ok: false, error: 'Для этого обработчика нужен PHP-сервер.' }));
        return;
      }
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'Content-Type':
          contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else pipeline(fs.createReadStream(file), response, () => {});
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT.');
  createPreviewServer().listen(port, '127.0.0.1', () => {
    console.log(`Пурпур: http://127.0.0.1:${port}/purpur/`);
    console.log(`Stone Haus: http://127.0.0.1:${port}/stonehaus/`);
    console.log('Все исходные варианты доступны по прежним путям. PHP здесь не выполняется.');
  });
}
