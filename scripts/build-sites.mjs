import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteNames = ['amodu', 'wave', 'purpur', 'stonehaus'];

/** Создаёт отдельную копию файлов сайта для дальнейшей поставки. */
export function buildSite(appDirectory) {
  const source = path.join(appDirectory, 'site');
  const output = path.join(appDirectory, 'dist');
  for (const file of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
    if (file.isSymbolicLink() || /^(?:\.env(?:\..*)?|\.git|node_modules)$/.test(file.name)) {
      throw new Error('Сборка не должна содержать symlink, секреты или зависимости разработки.');
    }
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const appName = path.basename(appDirectory);
  const nestedVersions = appName === 'purpur' ? 'purpur' : null;
  for (const entry of fs.readdirSync(source)) {
    if (entry === nestedVersions) continue;
    fs.cpSync(path.join(source, entry), path.join(output, entry), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  if (nestedVersions) {
    for (const version of ['v1', 'v2', 'v3']) {
      fs.cpSync(path.join(source, nestedVersions, version), path.join(output, version), {
        recursive: true,
        preserveTimestamps: true,
      });
    }
  }
  if (appName === 'amodu') {
    // Страница открывается в корне, а её ресурсы поставляются в каталог /amodu/.
    const indexPath = path.join(output, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const publicHtml = html.replace(
      /(href|src)="\.\/(styles\.css|assets\/[^"]+)"/g,
      '$1="/amodu/$2"',
    );
    fs.writeFileSync(indexPath, publicHtml);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const selected = process.argv.slice(2).find((value) => value !== '--check');
  if (selected && !siteNames.includes(selected)) throw new Error('Неизвестный сайт.');
  let count = 0;
  for (const name of selected ? [selected] : siteNames) {
    const app = path.join(repo, 'apps', name);
    if (check) {
      const source = path.join(app, 'site');
      for (const entry of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
        const result = spawnSync(
          process.execPath,
          ['--check', path.join(entry.parentPath, entry.name)],
          { stdio: 'inherit' },
        );
        if (result.error || result.status !== 0) process.exit(1);
        count++;
      }
    } else console.log(`${name}: ${buildSite(app)}`);
  }
  if (check) console.log(`Проверен синтаксис ${count} JavaScript-файлов сайтов.`);
}
