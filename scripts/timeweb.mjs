import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactPath, readConnection, readTargets } from './lib/timeweb-targets.mjs';

export const sshOptions = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=2',
];

export function transferArgs(target, source, apply = false) {
  return [
    '-rltz',
    '--itemize-changes',
    '--delay-updates',
    '--exclude=.git/',
    '--exclude=.env*',
    '--exclude=node_modules/',
    ...(apply ? [] : ['--dry-run']),
    '-e',
    `ssh ${sshOptions.join(' ')}`,
    '--',
    `${source}/`,
    `${target.sshHost}:${target.remotePath}/`,
  ];
}

/** Команды планирования и публикации используют один проверяемый маршрут. */
export function runTimeweb(
  args,
  {
    repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    run = spawnSync,
    log = console.log,
  } = {},
) {
  const [command, name, ...flags] = args;
  if (
    !['check', 'plan', 'publish'].includes(command) ||
    (!name && command !== 'check') ||
    (command === 'publish' ? flags.length !== 1 || flags[0] !== '--apply' : flags.length !== 0)
  ) {
    throw new Error(
      'Использование: timeweb check [цель], plan <цель> либо publish <цель> --apply.',
    );
  }
  const targets = readTargets(repoRoot);
  if (name && !Object.hasOwn(targets, name)) {
    throw new Error(
      'Цель не настроена. Заполните infra/timeweb/targets.json реальными реквизитами.',
    );
  }
  const target = name ? targets[name] : readConnection(repoRoot);
  const source = command === 'check' ? null : artifactPath(repoRoot, target);
  log(`${command}: ${name ?? 'хостинг'}, ${target.url}, ${target.sshHost}:${target.remotePath}`);
  if (source) log(`Артефакт: ${source}`);

  const execute = (executable, parameters) => {
    const result = run(executable, parameters, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${executable}: ${result.error?.message ?? `код ${result.status}`}`);
    }
  };
  // remotePath проверен до формирования команды. Значения не исполняются локальным shell.
  const remoteCheck = `command -v rsync >/dev/null && test -d '${target.remotePath}' && test -w '${target.remotePath}'`;
  execute('ssh', [...sshOptions, target.sshHost, remoteCheck]);
  if (command !== 'check') {
    execute('rsync', transferArgs(target, source, command === 'publish'));
  }
  log(
    command === 'publish'
      ? 'Файлы переданы. Проверьте опубликованный HTTPS-адрес.'
      : 'Проверка завершена без публикации.',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runTimeweb(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
