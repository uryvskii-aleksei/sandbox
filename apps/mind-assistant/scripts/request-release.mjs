import { execFileSync } from 'node:child_process';

import { verifyCi } from './verify-deploy-ci.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
if (git(['status', '--porcelain']))
  throw new Error('Публикация запрашивается из чистой рабочей папки.');
if (git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] !== commit) {
  throw new Error('Выберите актуальный коммит origin/main.');
}
await verifyCi(commit);
const current = git(['ls-remote', 'origin', 'refs/heads/release/mind-assistant']).split(/\s+/)[0];
if (current === commit)
  throw new Error(
    'Этот релиз уже запрошен. Проверьте Actions и deploy.log; повторите существующий workflow после устранения причины.',
  );
execFileSync('git', ['push', 'origin', `${commit}:refs/heads/release/mind-assistant`], {
  stdio: 'inherit',
});
console.log('Запущен Deploy MindAssistant. Дождитесь завершения workflow и проверки HTTPS.');
