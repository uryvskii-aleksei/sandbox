import fs from 'node:fs';
import path from 'node:path';

/** Проверяет, что роли обнаруживаются во всех поддерживаемых адаптерах. */
export function checkRoleAdapters(root) {
  const errors = [];
  const canonicalDirectory = path.join(root, '.agents/roles');
  const roles = fs
    .readdirSync(canonicalDirectory)
    .filter((name) => name.endsWith('.md'))
    .sort();
  const names = roles.map((name) => name.slice(0, -3));
  const read = (file) => {
    try {
      const absolute = path.join(root, file);
      const relative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
      if (
        !fs.lstatSync(absolute).isFile() ||
        relative.startsWith('..') ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Role files must remain inside the repository.');
      }
      return fs.readFileSync(absolute, 'utf8');
    } catch {
      errors.push(`Файл роли недоступен или не является обычным файлом проекта: ${file}`);
      return '';
    }
  };

  for (const role of names) {
    const canonical = `.agents/roles/${role}.md`;
    const source = read(canonical);
    if (!/^[a-z][a-z0-9-]*$/.test(role) || !source.startsWith(`---\nname: ${role}\n`)) {
      errors.push(`Имя роли не соответствует файлу: ${canonical}`);
    }
    for (const runtime of ['.codex', '.claude', '.cursor']) {
      const extension = runtime === '.codex' ? 'toml' : 'md';
      const file = `${runtime}/agents/${role}.${extension}`;
      const content = read(file);
      const identity =
        runtime === '.codex'
          ? content.match(/^name\s*=\s*"([a-z][a-z0-9-]*)"\s*$/m)?.[1]
          : content.match(/^name: ([a-z][a-z0-9-]*)\s*$/m)?.[1];
      if (identity !== role) errors.push(`Неверное имя роли: ${file}`);
      const reference =
        runtime === '.codex'
          ? content.match(/^developer_instructions\s*=\s*"(.*)"\s*$/m)?.[1]
          : content
              .split(/^---\s*$/m)
              .slice(2)
              .join('\n');
      if (!reference?.includes(canonical)) errors.push(`Нет канонической ссылки роли: ${file}`);
    }
  }
  for (const runtime of ['.codex', '.claude', '.cursor']) {
    const directory = path.join(root, runtime, 'agents');
    if (!fs.existsSync(directory)) continue;
    const extension = runtime === '.codex' ? '.toml' : '.md';
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(extension))) {
      if (!names.includes(file.slice(0, -extension.length))) {
        errors.push(`Адаптер без канонической роли: ${runtime}/agents/${file}`);
      }
    }
  }
  return { roles: names, errors };
}
