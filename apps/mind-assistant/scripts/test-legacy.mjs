import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phpVersion = process.env.MIND_ASSISTANT_TEST_PHP_VERSION ?? '8.4';
if (!['8.2', '8.4'].includes(phpVersion)) throw new Error('Expected PHP 8.2 or 8.4.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--payload'))
  throw new Error('Use [--payload PRIVATE_JSON].');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-assistant-legacy-test-'));
const name = `sandbox-legacy-test-${randomUUID()}`;
const network = `${name}-network`;
const image = `${name}-php`;
const password = randomBytes(24).toString('hex');
fs.writeFileSync(
  path.join(temporary, 'mysql.env'),
  `MYSQL_DATABASE=legacy_test\nMYSQL_USER=legacy_test\nMYSQL_PASSWORD=${password}\nMYSQL_RANDOM_ROOT_PASSWORD=yes\n`,
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(temporary, 'config.php'),
  `<?php return ['DB_HOST'=>'${name}','DB_PORT'=>'3306','DB_NAME'=>'legacy_test','DB_USER'=>'legacy_test','DB_PASSWORD'=>'${password}','APP_ENV'=>'development'];\n`,
  { mode: 0o600 },
);
if (args.length) {
  fs.copyFileSync(args[1], path.join(temporary, 'actual.json'));
  fs.chmodSync(path.join(temporary, 'actual.json'), 0o600);
}
const run = (commandArgs, label) => {
  const result = spawnSync('docker', commandArgs, {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // MySQL startup logs may contain its random root password.
    throw new Error(`${label} failed (private output withheld).`);
  }
  return result.stdout;
};
let madeNetwork = false,
  madeDatabase = false,
  builtImage = false;
try {
  run(['network', 'create', '--internal', network], 'Isolated network creation');
  madeNetwork = true;
  run(
    [
      'run',
      '--detach',
      '--name',
      name,
      '--network',
      network,
      '--env-file',
      path.join(temporary, 'mysql.env'),
      'mysql:8.4',
    ],
    'Isolated database startup',
  );
  madeDatabase = true;
  run(
    [
      'build',
      '--quiet',
      '--build-arg',
      `PHP_VERSION=${phpVersion}`,
      '--tag',
      image,
      path.join(app, 'backend'),
    ],
    'PHP test image build',
  );
  builtImage = true;
  const php = (script, check = true) => {
    const commandArgs = [
      'run',
      '--rm',
      '--network',
      network,
      '--volume',
      `${app}:/app:ro`,
      '--volume',
      `${temporary}:/private:ro`,
      '--env',
      'MIND_ASSISTANT_CONFIG=/private/config.php',
      image,
      'php',
      '-r',
      script,
    ];
    const result = spawnSync('docker', commandArgs, { encoding: 'utf8', timeout: 20000 });
    if (check && (result.error || result.status !== 0)) {
      let detail = '';
      try {
        const diagnostic = JSON.parse(result.stderr);
        detail = `${diagnostic.type}: ${diagnostic.error} (code ${diagnostic.code}, driver ${diagnostic.driverCode}, ${diagnostic.file}:${diagnostic.line})`;
      } catch {
        /* Raw PHP output may contain private values. */
      }
      throw new Error(`PHP import integration test failed. ${detail}`);
    }
    return result;
  };
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = php(
      "require '/app/backend/src/bootstrap.php'; \\MindAssistant\\database()->query('SELECT 1');",
      false,
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error('The isolated MySQL database did not become ready.');
  const result = php(
    "try {require '/app/tests/legacy-import.test.php';} catch (\\Throwable $error) {$type=get_class($error);$safe=in_array($type,['RuntimeException','MindAssistant\\\\LegacyImport\\\\ImportError'],true)?$error->getMessage():'Private diagnostic withheld';fwrite(STDERR,json_encode(['type'=>$type,'error'=>$safe,'code'=>$error->getCode(),'driverCode'=>$error instanceof \\PDOException?($error->errorInfo[1]??null):null,'file'=>basename($error->getFile()),'line'=>$error->getLine()]));exit(1);}",
  );
  console.log(result.stdout.trim());
} finally {
  if (madeDatabase) run(['rm', '--force', '--volumes', name], 'Owned MySQL cleanup');
  if (madeNetwork) run(['network', 'rm', network], 'Owned network cleanup');
  if (builtImage) run(['image', 'rm', image], 'Owned image tag cleanup');
  fs.rmSync(temporary, { recursive: true, force: true });
}
