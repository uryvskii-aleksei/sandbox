'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.svg',
]);

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Поддерживает события редактирования Cursor/Claude и патчи Codex. */
function collectPaths(payload) {
  const paths = new Set();
  const patch = (value) => {
    for (const match of value.matchAll(
      /^(?:\*\*\* (?:Update|Add|Delete) File:|\*\*\* Move to:|\+\+\+ [ab]\/|--- [ab]\/)\s*(.+)$/gm,
    )) {
      paths.add(match[1].trim());
    }
  };
  const visit = (value, depth = 0) => {
    if (typeof value === 'string') {
      patch(value);
      if (value.trim().startsWith('{')) {
        try {
          visit(JSON.parse(value), depth + 1);
        } catch {
          /* Не каждый input является JSON. */
        }
      }
    } else if (value && typeof value === 'object' && depth < 5) {
      for (const key of ['file_path', 'filePath', 'path', 'file']) {
        if (typeof value[key] === 'string') paths.add(value[key]);
      }
      if (Array.isArray(value.paths)) {
        for (const file of value.paths) if (typeof file === 'string') paths.add(file);
      }
      for (const key of [
        'tool_input',
        'input',
        'arguments',
        'args',
        'params',
        'output',
        'patch',
        'diff',
        'changes',
      ]) {
        visit(value[key], depth + 1);
      }
    }
  };
  visit(payload);
  return [...paths];
}

function safeFile(root, filename, cwd) {
  try {
    const file = fs.realpathSync(path.resolve(cwd, filename));
    if (!inside(root, file) || !fs.statSync(file).isFile()) return null;
    const parts = path.relative(root, file).split(path.sep);
    if (
      parts.some((part) =>
        /^(?:\.git|\.codex|\.cursor|\.claude|node_modules|dist|build|out|\.worktrees|\.env(?:\..*)?|\.mcp\.json)$/.test(
          part,
        ),
      )
    )
      return null;
    if (!extensions.has(path.extname(file).toLowerCase())) return null;
    return file;
  } catch {
    return null;
  }
}

/** Ищет форматтер только у самого файла и его предков, без соседних приложений. */
function findPrettier(root, file) {
  let directory = path.dirname(file);
  while (inside(root, directory)) {
    const packageDirectory = path.join(directory, 'node_modules', 'prettier');
    const manifest = path.join(packageDirectory, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.prettier;
        if (typeof bin === 'string') {
          const cli = path.resolve(packageDirectory, bin);
          if (inside(packageDirectory, cli) && fs.existsSync(cli)) return { cli, cwd: directory };
        }
      } catch {
        /* Неполная установка не должна блокировать редактор. */
      }
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return null;
}

function formatTouched(repoRoot, payload, { run = spawnSync, cwd = process.cwd() } = {}) {
  const root = fs.realpathSync(repoRoot);
  const eventCwd = typeof payload?.cwd === 'string' ? path.resolve(payload.cwd) : cwd;
  if (typeof payload?.cwd === 'string' && !inside(root, eventCwd)) return [];
  const base = inside(root, eventCwd) ? eventCwd : root;
  const files = new Set(
    collectPaths(payload)
      .map((file) => safeFile(root, file, base))
      .filter(Boolean),
  );
  const runs = new Map();
  const errors = [];
  for (const file of files) {
    const formatter = findPrettier(root, file);
    if (!formatter) {
      errors.push('Prettier не установлен для затронутого файла. Выполните npm ci.');
      continue;
    }
    const batch = runs.get(formatter.cli) ?? { ...formatter, files: [] };
    batch.files.push(file);
    runs.set(formatter.cli, batch);
  }
  for (const batch of runs.values()) {
    const result = run(process.execPath, [batch.cli, '--write', '--', ...batch.files], {
      cwd: batch.cwd,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    if (result.error || result.status !== 0) {
      errors.push(result.error?.message ?? result.stderr ?? `Prettier: код ${result.status}`);
    }
  }
  return [...new Set(errors)];
}

module.exports = { collectPaths, safeFile, findPrettier, formatTouched };

if (require.main === module) {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    const payload = raw ? JSON.parse(raw) : {};
    for (const error of formatTouched(path.resolve(__dirname, '../../..'), payload)) {
      process.stderr.write(`format-touched: ${error}\n`);
    }
  } catch (error) {
    process.stderr.write(`format-touched: ${error.message}\n`);
  }
  // Хук остаётся fail-open. Обязательный gate выполняется в npm run check.
  process.stdout.write('{}\n');
}
