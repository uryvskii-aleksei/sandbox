import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyCi } from './verify-deploy-ci.mjs';
import { validateTarget } from './deploy-target.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(app, '../..');
const target = validateTarget(
  JSON.parse(fs.readFileSync(path.join(app, 'deploy/timeweb.json'), 'utf8')),
);
const [action, ...flags] = process.argv.slice(2);
if (!['plan', 'publish'].includes(action) || flags.some((flag) => flag !== '--apply')) {
  throw new Error('Используйте plan или publish --apply.');
}
if (action === 'publish' && !flags.includes('--apply')) {
  throw new Error('Публикации нужен явный --apply.');
}
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Не выполнено: ${command} ${args[0] ?? ''}`);
  }
  return result.stdout;
};
const commit = run('git', ['rev-parse', 'HEAD']).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Нужен точный commit SHA.');
if (run('git', ['status', '--porcelain']).trim()) {
  throw new Error(
    'Сначала сохраните проверенные изменения в коммит. Деплой выполняется из чистой рабочей папки.',
  );
}
if (action === 'publish') {
  const refs = run('git', ['ls-remote', 'origin', 'refs/heads/main']).trim().split(/\s+/);
  if (refs[0] !== commit) throw new Error('Публикуется только актуальный коммит origin/main.');
  await verifyCi(commit);
}
run('npm', ['run', 'build:mind-assistant'], { stdio: 'inherit' });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-assistant-deploy-'));
try {
  const archive = path.join(temporary, 'artifact.tar.gz');
  const artifact = JSON.parse(
    run('python3', [path.join(app, 'deploy/package.py'), path.join(app, 'dist'), archive, commit]),
  );
  const sshArguments = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UpdateHostKeys=no',
    '-o',
    'ConnectTimeout=15',
  ];
  if (process.env.MIND_ASSISTANT_SSH_CONFIG)
    sshArguments.push('-F', process.env.MIND_ASSISTANT_SSH_CONFIG);
  const command = `/usr/bin/python3 ${target.remoteRoot}/receiver.py ${action} ${commit} ${artifact.sha256}`;
  const output = run('ssh', [...sshArguments, target.sshHost, command], {
    input: fs.readFileSync(archive),
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(output);
  if (!result.ok || result.commit !== commit) throw new Error('Некорректный ответ сервера деплоя.');
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
