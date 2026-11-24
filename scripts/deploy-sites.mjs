import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyCi } from './lib/github-ci.mjs';
import {
  assertStonehausTargets,
  siteRemoteRoot,
  validateSiteTarget,
} from './lib/site-deploy-targets.mjs';
import { readTargets } from './lib/timeweb-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sshOptions = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'UpdateHostKeys=no',
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=2',
];
const checksum = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function parseArguments(args) {
  const [action, app, ...flags] = args;
  if (
    !['plan', 'publish'].includes(action) ||
    !['purpur', 'stonehaus'].includes(app) ||
    (action === 'publish' ? flags.length !== 1 || flags[0] !== '--apply' : flags.length !== 0)
  ) {
    throw new Error('Используйте plan <purpur|stonehaus> или publish <purpur|stonehaus> --apply.');
  }
  return { action, app };
}

/** Публикация использует личный SSH-доступ только к проверенному назначению приложения. */
export async function runDeploySites(
  args,
  { repository = root, run = spawnSync, checkCi = verifyCi, log = console.log } = {},
) {
  const { action, app } = parseArguments(args);
  const execute = (command, parameters, options = {}) => {
    const result = run(command, parameters, {
      cwd: repository,
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
      ...options,
    });
    if (result.error || result.status !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      throw new Error(`Не выполнено: ${command} ${parameters[0] ?? ''}`);
    }
    return result.stdout ?? '';
  };
  const git = (parameters) => execute('git', parameters).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit) || git(['status', '--porcelain'])) {
    throw new Error(
      'Поставка выполняется из чистой рабочей папки с сохранённым исходным коммитом.',
    );
  }
  if (git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] !== commit) {
    throw new Error('Выберите актуальный коммит origin/main.');
  }
  await checkCi(commit);
  const appDirectory = path.join(repository, 'apps', app);
  const targetFile = path.join(appDirectory, 'deploy/timeweb.json');
  if (!fs.lstatSync(targetFile).isFile() || fs.lstatSync(targetFile).isSymbolicLink())
    throw new Error('Манифест назначения должен быть обычным файлом проекта.');
  const target = validateSiteTarget(JSON.parse(fs.readFileSync(targetFile, 'utf8')), app);
  if (app === 'stonehaus') assertStonehausTargets(target, readTargets(repository));
  const remote = siteRemoteRoot(target);
  execute('npm', ['run', 'check', `--workspace=@sandbox/${app}`], { stdio: 'inherit' });
  execute('npm', ['test', `--workspace=@sandbox/${app}`], { stdio: 'inherit' });
  execute('npm', ['run', 'build', `--workspace=@sandbox/${app}`], { stdio: 'inherit' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `sandbox-${app}-deploy-`));
  try {
    const archive = path.join(temporary, 'artifact.tar.gz');
    const receiver = path.join(repository, 'infra/timeweb/site-deploy/receiver.py');
    const artifact = JSON.parse(
      execute('python3', [
        path.join(repository, 'infra/timeweb/site-deploy/package.py'),
        path.join(appDirectory, 'dist'),
        archive,
        targetFile,
        commit,
      ]),
    );
    if (
      artifact.commit !== commit ||
      typeof artifact.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isInteger(artifact.files) ||
      artifact.files < 1
    ) {
      throw new Error('Некорректная идентичность подготовленного артефакта.');
    }
    if (
      git(['rev-parse', 'HEAD']) !== commit ||
      git(['status', '--porcelain']) ||
      git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] !== commit
    ) {
      throw new Error('Исходники или main изменились во время подготовки. Проверьте новый коммит.');
    }
    const installed = execute('ssh', [
      ...sshOptions,
      target.sshHost,
      `test -f ${remote}/receiver.py && test ! -L ${remote}/receiver.py && test -f ${remote}/target.json && test ! -L ${remote}/target.json && sha256sum ${remote}/receiver.py ${remote}/target.json`,
    ])
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/)[0]);
    if (
      installed.length !== 2 ||
      installed[0] !== checksum(receiver) ||
      installed[1] !== checksum(targetFile)
    ) {
      throw new Error(
        `Серверный receiver/target не соответствует репозиторию. Выполните первичную установку по apps/${app}/deployment.md.`,
      );
    }
    log(
      `${action}: ${app}, ${target.url}, ${target.publicPath}, ${commit}, sha256:${artifact.sha256}`,
    );
    const output = execute(
      'ssh',
      [
        ...sshOptions,
        target.sshHost,
        `/usr/bin/python3 ${remote}/receiver.py ${action} ${commit} ${artifact.sha256}`,
      ],
      { input: fs.readFileSync(archive) },
    );
    const result = JSON.parse(output);
    if (
      result.ok !== true ||
      result.app !== app ||
      result.commit !== commit ||
      !(
        (action === 'plan' && result.status === 'planned') ||
        (action === 'publish' && ['published', 'already-current'].includes(result.status))
      )
    )
      throw new Error('Некорректный ответ выбранного приложения на сервере.');
    log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeploySites(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
