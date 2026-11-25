import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const nestedVersions = path.basename(appDirectory) === 'purpur' ? 'purpur' : null;
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
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const selected = process.argv.slice(2).find((value) => value !== '--check');
  if (selected && !['purpur', 'stonehaus'].includes(selected)) throw new Error('Неизвестный сайт.');
  let count = 0;
  for (const name of selected ? [selected] : ['purpur', 'stonehaus']) {
    const app = path.join(repo, 'apps', name);
    if (check) {
      const source = path.join(app, 'site');
      for (const entry of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
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
