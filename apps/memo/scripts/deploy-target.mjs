export function validateTarget(target) {
  const keys = ['version', 'sshHost', 'host', 'user', 'url', 'remoteRoot', 'publicPath'];
  if (
    !target ||
    typeof target !== 'object' ||
    Object.keys(target).length !== keys.length ||
    !keys.every((key) => key in target) ||
    target.version !== 1
  ) {
    throw new Error('Некорректный реестр назначения Memo.');
  }
  if (
    !/^[a-z][a-z0-9_-]*$/.test(target.sshHost) ||
    !/^[a-z0-9.-]+$/.test(target.host) ||
    !/^[a-z][a-z0-9]*$/.test(target.user)
  ) {
    throw new Error('Некорректные параметры SSH назначения.');
  }
  const home = `/home/${target.user[0]}/${target.user}`;
  if (
    target.remoteRoot !== `${home}/.sandbox/mind-assistant` ||
    target.publicPath !== `${home}/public_html/memo`
  ) {
    throw new Error('Назначение должно указывать только на каталоги Memo этого аккаунта.');
  }
  const url = new URL(target.url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== `${target.user}.tw1.ru` ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    url.pathname !== '/memo/'
  ) {
    throw new Error('Нужен HTTPS-адрес Memo без учётных данных и дополнительных параметров.');
  }
  return target;
}
