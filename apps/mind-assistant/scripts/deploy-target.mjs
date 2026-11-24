export function validateTarget(target) {
  const keys = ['version', 'sshHost', 'host', 'user', 'url', 'remoteRoot', 'publicPath'];
  if (
    !target ||
    typeof target !== 'object' ||
    Object.keys(target).length !== keys.length ||
    !keys.every((key) => key in target) ||
    target.version !== 1
  ) {
    throw new Error('Некорректный реестр назначения MindAssistant.');
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
    target.publicPath !== `${home}/public_html/mind-assistant`
  ) {
    throw new Error('Назначение должно указывать только на каталоги MindAssistant этого аккаунта.');
  }
  const url = new URL(target.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    url.pathname !== '/mind-assistant/'
  ) {
    throw new Error(
      'Нужен HTTPS-адрес MindAssistant без учётных данных и дополнительных параметров.',
    );
  }
  return target;
}
