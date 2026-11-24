import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { verifyCi } from './verify-deploy-ci.mjs';
import { validateTarget } from './deploy-target.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(app, '../..');
const target = validateTarget(
  JSON.parse(fs.readFileSync(path.join(app, 'deploy/timeweb.json'), 'utf8')),
);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Не выполнено: ${command} ${args[0] ?? ''}`);
  }
  return result.stdout;
};
if (!process.env.GITHUB_TOKEN)
  throw new Error('Публикация артефакта запускается из GitHub Actions.');
const commit = run('git', ['rev-parse', 'HEAD']).trim();
if (run('git', ['status', '--porcelain']).trim()) throw new Error('Нужна чистая рабочая папка.');
run('npm', ['run', 'build:mind-assistant'], { stdio: 'inherit' });
await verifyCi(commit);
if (run('git', ['ls-remote', 'origin', 'refs/heads/main']).trim().split(/\s+/)[0] !== commit) {
  throw new Error('main уже изменилась. Запустите workflow для актуального коммита.');
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-assistant-release-'));
try {
  const artifact = path.join(temporary, `mind-assistant-${commit}.tar.gz`);
  const metadata = JSON.parse(
    run('python3', [path.join(app, 'deploy/package.py'), path.join(app, 'dist'), artifact, commit]),
  );
  const branch = 'deploy/mind-assistant';
  const publish = path.join(temporary, 'repository');
  fs.mkdirSync(publish);
  const authorization = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`;
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: authorization,
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (args) => run('git', args, { cwd: publish, env });
  git(['init', '--quiet']);
  git(['remote', 'add', 'origin', 'https://github.com/uryvskii-aleksei/sandbox.git']);
  if (git(['ls-remote', 'origin', `refs/heads/${branch}`]).trim()) {
    git(['fetch', '--depth=1', 'origin', `refs/heads/${branch}`]);
    git(['switch', '--create', branch, 'FETCH_HEAD']);
  } else git(['checkout', '--orphan', branch]);
  const name = path.basename(artifact);
  const destination = path.join(publish, name);
  if (
    fs.existsSync(destination) &&
    createHash('sha256').update(fs.readFileSync(destination)).digest('hex') !== metadata.sha256
  ) {
    throw new Error(
      'Для этого коммита уже опубликован другой артефакт. Нужна проверка расхождения.',
    );
  }
  fs.copyFileSync(artifact, destination);
  fs.writeFileSync(
    path.join(publish, 'deployment.json'),
    JSON.stringify(
      { version: 1, app: 'mind-assistant', commit, sha256: metadata.sha256, artifact: name },
      null,
      2,
    ) + '\n',
  );
  git(['add', '--', name, 'deployment.json']);
  if (git(['diff', '--cached', '--name-only']).trim()) {
    git([
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit',
      '-m',
      `Подготовлен MindAssistant ${commit.slice(0, 7)}`,
    ]);
    git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }
  console.log(`Опубликован артефакт ${commit}. Ожидаем задачу Timeweb.`);
  const deadline = Date.now() + 8 * 60 * 1000;
  let confirmed = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${target.url}release.json?release=${commit}`, {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (response.ok) {
        const release = await response.json();
        if (
          release.commit === commit &&
          release.artifactSha256 === metadata.sha256 &&
          release.deploymentStatus === 'ready'
        ) {
          console.log(`MindAssistant опубликован и проверен: ${target.url}`);
          confirmed = true;
          break;
        }
      }
    } catch {
      /* Следующая проверка дождётся опубликованного и проверенного релиза. */
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (!confirmed) {
    throw new Error(
      'Timeweb не подтвердил релиз за 8 минут. Артефакт сохранён; проверьте приватный deploy.log перед повтором.',
    );
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
