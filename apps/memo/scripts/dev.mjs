import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = path.join(app, '.env');
if (!fs.existsSync(environment)) {
  const previous = path.resolve(app, '../mind-assistant/.env');
  if (fs.existsSync(previous)) {
    fs.copyFileSync(previous, environment, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(environment, 0o600);
  } else {
    fs.writeFileSync(
      environment,
      `DB_NAME=mindassistant\nDB_USER=mindassistant\nDB_PASSWORD=${randomBytes(24).toString('hex')}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  }
}
for (const args of [
  ['compose', 'up', '--build', '--wait', '-d'],
  ['compose', 'exec', '-T', 'api', 'php', 'database/migrate.php'],
]) {
  const result = spawnSync('docker', args, { cwd: app, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const client = spawn('npm', ['run', 'dev', '--workspace=@sandbox/memo-web'], {
  cwd: app,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => client.kill(signal));
client.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
console.log('React: http://127.0.0.1:5173/mind-assistant/');
console.log(
  'PHP/MySQL останутся запущены. Остановка: npm run services:down --workspace=@sandbox/memo',
);
