import fs from 'node:fs';
import path from 'node:path';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['app', 'buildDir', 'sshHost', 'remotePath', 'url'];
const privateName = (name) =>
  /^(?:\.env(?:\..*)?|\.git|\.ssh|node_modules|id_rsa.*|id_ed25519.*)$/i.test(name) ||
  /\.(?:pem|key)$/i.test(name);

function relativePath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9_.\/-]+$/.test(value) &&
    !value.startsWith('/') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function validateDestination(name, target) {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(target.sshHost)) {
    throw new Error(`Цель ${name}: sshHost должен быть именем SSH alias.`);
  }
  const remote = target.remotePath;
  const parts = remote.replace(/^\//, '').split('/');
  if (
    !/^\/?[a-zA-Z0-9_./-]+$/.test(remote) ||
    parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('-')) ||
    !parts.includes('public_html')
  ) {
    throw new Error(`Цель ${name}: remotePath должен указывать на выделенный каталог public_html.`);
  }
  let url;
  try {
    url = new URL(target.url);
  } catch {
    throw new Error(`Цель ${name}: некорректный URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`Цель ${name}: нужен HTTPS URL без учётных данных, query и hash.`);
  }
}

/** Проверяет назначения до любых SSH-вызовов и передачи файлов. */
export function validateTargets(data) {
  if (
    !object(data) ||
    data.version !== 1 ||
    data.provider !== 'timeweb-shared' ||
    !object(data.targets) ||
    Object.keys(data).some((key) => !['version', 'provider', 'targets'].includes(key))
  ) {
    throw new Error('Ожидается реестр version: 1, provider: timeweb-shared и объект targets.');
  }

  const destinations = [];
  for (const [name, target] of Object.entries(data.targets)) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      !object(target) ||
      Object.keys(target).length !== fields.length ||
      !fields.every((key) => typeof target[key] === 'string')
    ) {
      throw new Error(`Некорректная цель ${name}: нужны поля ${fields.join(', ')}.`);
    }
    if (!/^apps\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.app)) {
      throw new Error(`Цель ${name}: app должен указывать на apps/<имя>.`);
    }
    if (!relativePath(target.buildDir) || target.buildDir.split('/').some(privateName)) {
      throw new Error(`Цель ${name}: buildDir должен быть отдельным каталогом внутри приложения.`);
    }
    validateDestination(name, target);
    const remote = target.remotePath;
    for (const previous of destinations) {
      if (
        previous.host === target.sshHost &&
        (remote === previous.remote ||
          remote.startsWith(`${previous.remote}/`) ||
          previous.remote.startsWith(`${remote}/`))
      ) {
        throw new Error(`Каталоги целей ${previous.name} и ${name} пересекаются.`);
      }
    }
    destinations.push({ name, host: target.sshHost, remote });
  }
  return data.targets;
}

export function readTargets(repoRoot) {
  return validateTargets(
    JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/timeweb/targets.json'), 'utf8')),
  );
}

/** Настройки аккаунта нужны для проверки SSH до появления первого приложения. */
export function readConnection(repoRoot) {
  const data = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'infra/timeweb/connection.json'), 'utf8'),
  );
  if (
    !object(data) ||
    data.version !== 1 ||
    Object.keys(data).length !== 4 ||
    !['sshHost', 'remotePath', 'url'].every((key) => typeof data[key] === 'string')
  ) {
    throw new Error('Некорректный connection.json: нужны version: 1, sshHost, remotePath и url.');
  }
  validateDestination('хостинг', data);
  return data;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Возвращает только готовую статическую сборку, не корень приложения. */
export function artifactPath(repoRoot, target) {
  const root = fs.realpathSync(repoRoot);
  const app = fs.realpathSync(path.join(root, target.app));
  const output = fs.realpathSync(path.join(app, target.buildDir));
  if (!isInside(path.join(root, 'apps'), app) || !isInside(app, output)) {
    throw new Error('Сборка должна находиться внутри своего приложения.');
  }
  let current = path.join(root, target.app);
  for (const part of ['', ...target.buildDir.split('/')]) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Symlink в пути приложения или сборки недопустим.');
    }
  }
  if (!fs.statSync(path.join(output, 'index.html')).isFile()) {
    throw new Error('Статическая сборка должна содержать index.html.');
  }
  const inspect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        (!entry.isFile() && !entry.isDirectory()) ||
        privateName(entry.name)
      ) {
        throw new Error(`Служебный файл, ключ или symlink в сборке: ${entry.name}`);
      }
      if (entry.isDirectory()) inspect(path.join(directory, entry.name));
    }
  };
  inspect(output);
  return output;
}
