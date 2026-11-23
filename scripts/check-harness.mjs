import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConnection, readTargets } from './lib/timeweb-targets.mjs';
import { checkRoleAdapters } from './lib/agent-roles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const ignored = new Set([
  '.git',
  'node_modules',
  '.worktrees',
  '.imports',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.cache',
  '.venv',
  '__pycache__',
  'playwright-report',
  'test-results',
]);
const personal = new Set([
  '.mcp.json',
  '.cursor/mcp.json',
  '.codex/config.toml',
  '.codex/auth.json',
  '.claude/settings.local.json',
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (
      entry.isSymbolicLink() ||
      /^(?:apps\/mind-assistant\/legacy|apps\/(?:purpur|stonehaus)\/archive)(?:\/|$)/.test(
        path.relative(root, absolute).split(path.sep).join('/'),
      ) ||
      ignored.has(entry.name) ||
      personal.has(path.relative(root, absolute).split(path.sep).join('/')) ||
      /^\.env(?:\.|$)/.test(entry.name)
    )
      return [];
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(root);
for (const absolute of files) {
  const relative = path.relative(root, absolute);
  if (
    absolute.endsWith('.json') &&
    !relative.startsWith('apps/') &&
    !relative.startsWith('packages/')
  ) {
    try {
      JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch {
      errors.push(`Некорректный JSON: ${relative}`);
    }
  }
  if (!absolute.endsWith('.md')) continue;
  const content = fs.readFileSync(absolute, 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1].split('#')[0];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    check(
      fs.existsSync(path.resolve(path.dirname(absolute), decodeURIComponent(href))),
      `Сломанная ссылка ${relative}: ${href}`,
    );
  }
}

const names = fs.readdirSync(path.join(root, '.agents/skills'));
for (const name of names) {
  const canonical = read(`.agents/skills/${name}/SKILL.md`);
  const pointer = read(`.claude/skills/${name}/SKILL.md`);
  const metadata = (text) => text.match(/^---\n([\s\S]*?)\n---/);
  check(metadata(canonical)?.[1] === metadata(pointer)?.[1], `Разошлись метаданные skill ${name}`);
  check(
    pointer.includes(`@.agents/skills/${name}/SKILL.md`),
    `Нет канонической ссылки skill ${name}`,
  );
}
const roleAdapters = checkRoleAdapters(root);
errors.push(...roleAdapters.errors);
const settings = ['.codex/hooks.json', '.claude/settings.json', '.cursor/hooks.json'];
for (const file of settings) {
  check(
    read(file).includes('.agents/hooks/scripts/format-touched.cjs'),
    `Неверный путь хука: ${file}`,
  );
}
for (const absolute of files.filter((file) => /\.(?:md|toml|json)$/.test(file))) {
  const relative = path.relative(root, absolute);
  if (!/^(?:\.agents|\.codex|\.claude|\.cursor)[/\\]/.test(relative) && relative !== 'AGENTS.md')
    continue;
  check(
    !/tfs\.content\.ai|@contentai\/|figma-to-code|tfs-work-items|tfs-pull-requests|api\.timeweb\.cloud/i.test(
      fs.readFileSync(absolute, 'utf8'),
    ),
    `Посторонняя интеграция в ${relative}`,
  );
}
try {
  readConnection(root);
  const targets = readTargets(root);
  for (const [name, target] of Object.entries(targets)) {
    check(
      fs.existsSync(path.join(root, target.app, 'README.md')),
      `Нет README приложения цели ${name}`,
    );
  }
} catch (error) {
  errors.push(error.message);
}
for (const parent of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      check(
        fs.existsSync(path.join(root, parent, entry.name, 'README.md')),
        `Нет README: ${parent}/${entry.name}`,
      );
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Обвязка: локальные ссылки, ${names.length} skills, ${roleAdapters.roles.length} ролей, hooks и цели Timeweb проверены.`,
  );
}
