const fields = [
  'version',
  'app',
  'user',
  'sshHost',
  'publicPath',
  'url',
  'ownedFiles',
  'ownedDirectories',
  'requiredFiles',
  'checks',
];
const apps = new Set(['purpur', 'stonehaus']);

function normalPath(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    value
      .split('/')
      .every(
        (part, index, parts) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          (!part.startsWith('.') || (part === '.htaccess' && index === parts.length - 1)),
      )
  );
}

/** Проверяет конкретное назначение до формирования команд SSH. */
export function validateSiteTarget(target, app) {
  if (
    !apps.has(app) ||
    !target ||
    typeof target !== 'object' ||
    Array.isArray(target) ||
    Object.keys(target).length !== fields.length ||
    !fields.every((key) => key in target) ||
    target.version !== 1 ||
    target.app !== app
  ) {
    throw new Error('Некорректный манифест назначения сайта.');
  }
  if (
    typeof target.user !== 'string' ||
    typeof target.sshHost !== 'string' ||
    !/^[a-z][a-z0-9]*$/.test(target.user) ||
    !/^[a-z][a-z0-9_-]*$/.test(target.sshHost)
  ) {
    throw new Error('Некорректные реквизиты SSH назначения.');
  }
  const home = `/home/${target.user[0]}/${target.user}`;
  const suffix = app === 'purpur' ? '' : '/stonehaus';
  if (target.publicPath !== `${home}/public_html${suffix}`) {
    throw new Error('Сайт может обновлять только свой настроенный каталог.');
  }
  const url = new URL(target.url);
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== (app === 'purpur' ? '/' : '/stonehaus/')
  ) {
    throw new Error('Нужен HTTPS-адрес выбранного сайта без учётных данных и параметров.');
  }
  for (const key of ['ownedFiles', 'ownedDirectories', 'requiredFiles']) {
    if (
      !Array.isArray(target[key]) ||
      target[key].some((name) => !normalPath(name)) ||
      new Set(target[key]).size !== target[key].length
    ) {
      throw new Error('Некорректный список файлов и каталогов сайта.');
    }
  }
  const permitted = app === 'purpur' ? ['assets', 'concept', 'purpur'] : ['v1', 'v2', 'v3'];
  if (
    target.ownedFiles.some(
      (name) =>
        name.includes('/') ||
        /^(?:config(?:\.|$)|release(?:-purpur)?\.json$|id_rsa|id_ed25519|node_modules$)/i.test(
          name,
        ),
    ) ||
    target.ownedDirectories.some((name) => !permitted.includes(name)) ||
    (app === 'stonehaus' && target.ownedFiles.length)
  ) {
    throw new Error('Назначение не может владеть соседними приложениями или приватными файлами.');
  }
  const owns = (name) =>
    target.ownedFiles.includes(name) ||
    (name.includes('/') && target.ownedDirectories.includes(name.split('/')[0]));
  if (
    !target.requiredFiles.length ||
    target.requiredFiles.some((name) => !owns(name)) ||
    !Array.isArray(target.checks) ||
    !target.checks.length
  ) {
    throw new Error('Нужны обязательные файлы и конкретные проверки HTTPS.');
  }
  for (const check of target.checks) {
    if (
      !check ||
      typeof check !== 'object' ||
      !['path', 'status'].every((name) => name in check) ||
      Object.keys(check).some((name) => !['path', 'status', 'file'].includes(name)) ||
      typeof check.path !== 'string' ||
      (check.path && !normalPath(check.path.replace(/\/$/, ''))) ||
      ![200, 400, 405].includes(check.status) ||
      ('file' in check && (!normalPath(check.file) || !owns(check.file) || check.status !== 200))
    ) {
      throw new Error('Допускаются только безопасные GET-проверки выбранного сайта.');
    }
  }
  return target;
}

export function siteRemoteRoot(target) {
  return `/home/${target.user[0]}/${target.user}/.sandbox/site-deploy/${target.app}`;
}

/** Полная поставка Stonehaus и статический реестр должны обозначать одни каталоги. */
export function assertStonehausTargets(target, targets) {
  for (const version of ['v1', 'v2', 'v3']) {
    const registered = targets[`stonehaus-${version}`];
    if (
      !registered ||
      registered.app !== 'apps/stonehaus' ||
      registered.buildDir !== `dist/${version}` ||
      registered.sshHost !== target.sshHost ||
      registered.remotePath !== `${target.publicPath}/${version}` ||
      registered.url !== `${target.url}${version}/`
    ) {
      throw new Error('Манифест Stonehaus расходится с конкретными статическими целями Timeweb.');
    }
  }
}
