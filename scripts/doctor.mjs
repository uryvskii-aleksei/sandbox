import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConnection, readTargets } from './lib/timeweb-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const online = process.argv.slice(2).includes('--online');
const call = (command, args) =>
  spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 15_000, shell: false });
const report = (state, message) => console.log(`[${state}] ${message}`);

report(
  Number(process.versions.node.split('.')[0]) >= 24 ? 'OK' : 'НУЖНО',
  `Node.js ${process.versions.node}`,
);
for (const [tool, args] of [
  ['git', ['--version']],
  ['ssh', ['-V']],
  ['rsync', ['--version']],
  ['gh', ['--version']],
]) {
  const available = call(tool, args).status === 0;
  report(
    available ? 'OK' : 'НУЖНО',
    `${tool}${tool === 'gh' ? ' (необязательный CLI, альтернатива плагину/MCP)' : ''}`,
  );
}
const remote = call('git', ['remote', 'get-url', 'origin']);
const correctRemote =
  remote.status === 0 &&
  /^(?:https:\/\/github\.com\/|git@github\.com:)uryvskii-aleksei\/sandbox(?:\.git)?$/.test(
    remote.stdout.trim(),
  );
report(correctRemote ? 'OK' : 'НУЖНО', 'origin: uryvskii-aleksei/sandbox');
try {
  const connection = readConnection(root);
  report('НАСТРОЕНО', `Timeweb: ${connection.sshHost}, ${connection.url}`);
  const targets = readTargets(root);
  report(
    Object.keys(targets).length ? 'OK' : 'ИНФО',
    `Timeweb: настроено целей — ${Object.keys(targets).length}`,
  );
  if (!Object.keys(targets).length)
    console.log(
      '  Цели добавляются вместе с приложениями. Проверка аккаунта: npm run timeweb -- check.',
    );
} catch (error) {
  report('ОШИБКА', error.message);
  process.exitCode = 1;
}

if (online) {
  if (correctRemote) {
    const result = call('git', ['ls-remote', 'origin']);
    report(
      result.status === 0 ? 'OK' : 'НУЖНО',
      result.status === 0 && !result.stdout.trim()
        ? 'Git remote читается, репозиторий пуст'
        : 'Чтение Git remote',
    );
  }
  if (call('gh', ['--version']).status === 0) {
    const result = call('gh', ['api', 'repos/uryvskii-aleksei/sandbox', '--jq', '.full_name']);
    const authenticated = call('gh', ['api', 'user', '--jq', '.login']);
    report(
      result.status === 0 && authenticated.status === 0 ? 'OK' : 'НУЖНО',
      'Авторизованное чтение GitHub через gh',
    );
  } else {
    report(
      'ПРОПУЩЕНО',
      'GitHub API: gh не установлен. Подключение плагина/MCP проверяется в среде агента.',
    );
  }
} else {
  console.log('Сеть не проверялась. Для чтения remote и gh API: npm run doctor -- --online.');
}
console.log('Проверка SSH: npm run timeweb -- check [цель]. Doctor ничего не публикует.');
