import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultImage =
  'postgres@sha256:990b4b1fbeeb45b0fe50c2e6989f1134686926658bf0e8bb9415562578a37c60';

/** Читает старый PG dump только в одноразовой БД без сети и портов. */
export async function prepareLegacy({ dump, output, postgresImage = defaultImage }) {
  const source = path.resolve(dump);
  const destination = path.resolve(output);
  const actualDestination = path.join(
    fs.realpathSync(path.dirname(destination)),
    path.basename(destination),
  );
  const privateRoot = path.join(repository, '.imports/private');
  if (
    actualDestination.startsWith(repository + path.sep) &&
    !actualDestination.startsWith(privateRoot + path.sep)
  ) {
    throw new Error('Private payload must stay outside the repository or in .imports/private.');
  }
  if (
    !fs.lstatSync(source).isFile() ||
    fs.lstatSync(source).isSymbolicLink() ||
    fs.statSync(source).size > 32 * 1024 * 1024
  ) {
    throw new Error('Expected a regular private dump up to 32 MiB.');
  }
  if (fs.existsSync(destination))
    throw new Error('Output already exists; inspect it before replacing.');
  if (!/^postgres(?::[a-z0-9.-]+|@sha256:[a-f0-9]{64})?$/.test(postgresImage))
    throw new Error('Use an official postgres image reference.');
  const snapshot = fs.readFileSync(source);
  if (snapshot.length > 32 * 1024 * 1024) throw new Error('Source exceeds 32 MiB.');
  const sourceSha256 = createHash('sha256').update(snapshot).digest('hex');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-legacy-'));
  const frozen = path.join(temporary, 'source.dump');
  fs.writeFileSync(frozen, snapshot, { mode: 0o600 });
  const run = (args, label) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(`${label} failed; private command output was withheld.`);
    return result.stdout;
  };
  const name = `sandbox-legacy-prepare-${randomUUID()}`;
  let started = false;
  try {
    run(
      [
        'run',
        '--detach',
        '--name',
        name,
        '--network',
        'none',
        '--env',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        '--env',
        'POSTGRES_DB=legacy_restore',
        '--volume',
        `${frozen}:/legacy.dump:ro`,
        postgresImage,
      ],
      'Isolated PostgreSQL start',
    );
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const logs = run(['logs', name], 'PostgreSQL initialization observation');
      const probe = spawnSync(
        'docker',
        ['exec', name, 'psql', '-U', 'postgres', '-d', 'legacy_restore', '-At', '-c', 'SELECT 1'],
        { encoding: 'utf8', timeout: 5000 },
      );
      // pg_isready может ответить во время временного init-сервера до создания БД.
      if (logs.includes('init process complete') && probe.status === 0) {
        ready = true;
        break;
      }
      await setTimeout(300);
    }
    if (!ready) throw new Error('The isolated PostgreSQL database did not become ready.');
    run(
      [
        'exec',
        name,
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        'legacy_restore',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '/legacy.dump',
      ],
      'Private PostgreSQL restore',
    );
    const query =
      "SELECT json_build_object('projects',COALESCE((SELECT json_agg(p ORDER BY p.id) FROM projects p),'[]'::json),'data',COALESCE((SELECT json_agg(d ORDER BY d.id) FROM data d),'[]'::json));";
    const rows = JSON.parse(
      run(
        ['exec', name, 'psql', '-U', 'postgres', '-d', 'legacy_restore', '-At', '-c', query],
        'Private PostgreSQL export',
      ),
    );
    const payload = { version: 1, app: 'mind-assistant-legacy', sourceSha256, ...rows };
    fs.writeFileSync(destination, JSON.stringify(payload) + '\n', { mode: 0o600, flag: 'wx' });
    return {
      sourceSha256: payload.sourceSha256,
      sourceProjects: payload.projects.length,
      sourceCards: payload.data.length,
      output: destination,
    };
  } finally {
    try {
      if (started) run(['rm', '--force', '--volumes', name], 'Owned PostgreSQL cleanup');
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = {};
    const args = process.argv.slice(2);
    while (args.length) {
      const key = args.shift();
      if (
        !['--dump', '--output', '--postgres-image'].includes(key) ||
        key in values ||
        !args.length
      )
        throw new Error('Use --dump FILE --output PRIVATE_JSON [--postgres-image IMAGE].');
      values[key] = args.shift();
    }
    if (!values['--dump'] || !values['--output'])
      throw new Error('Use --dump FILE --output PRIVATE_JSON [--postgres-image IMAGE].');
    console.log(
      JSON.stringify(
        await prepareLegacy({
          dump: values['--dump'],
          output: values['--output'],
          postgresImage: values['--postgres-image'],
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
