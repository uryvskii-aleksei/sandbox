(function () {
  'use strict';
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#mobile-nav');
  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setMenu(false);
      toggle.focus();
    }
  });
  const desktop = window.matchMedia('(min-width: 801px)');
  desktop.addEventListener('change', (event) => { if (event.matches) setMenu(false); });

  const photos = [
    { src: 'https://optim.tildacdn.com/tild3330-6264-4331-b132-613734373961/-/format/webp/_DSC9863.png.webp', alt: 'Гостиная построенного дома с панорамным остеклением и светлым кварцвинилом', title: 'Больше света. Больше жизни.', description: 'Панорамные окна в гостиной и кварцвинил во всех помещениях.' },
    { src: 'https://optim.tildacdn.com/tild3461-3031-4638-b562-656361313135/-/format/webp/_DSC0662.jpg.webp', alt: 'Пустая спальня построенного дома со светлыми окрашенными стенами и кварцвинилом', title: 'Место, чтобы побыть собой.', description: 'В доме три спальни. В центральной предусмотрена ниша под гардероб.' },
    { src: 'https://optim.tildacdn.com/tild3937-6136-4863-b734-393534353837/-/format/webp/_DSC9546-HDR.jpg.webp', alt: 'Ванная построенного дома с керамогранитом и установленным унитазом', title: 'У каждого утра — своё начало.', description: 'Керамогранит, скрытая инсталляция и установленный унитаз.' },
    { src: 'https://optim.tildacdn.com/tild6430-3736-4363-b235-666532313834/-/format/webp/_DSC9306-HDR.jpg.webp', alt: 'Коридор построенного дома с белыми дверями, светлыми стенами и кварцвинилом', title: 'Спокойная основа для ваших идей.', description: 'Окрашенные стены, белые двери и единое напольное покрытие.' },
  ];
  const photo = document.querySelector('#gallery-photo');
  const buttons = [...document.querySelectorAll('[data-photo]')];
  let current = 0;
  function showPhoto(index) {
    current = (index + photos.length) % photos.length;
    const item = photos[current];
    photo.src = item.src;
    photo.alt = item.alt;
    document.querySelector('#gallery-title').textContent = item.title;
    document.querySelector('#gallery-description').textContent = item.description;
    document.querySelector('#gallery-count').textContent = `${String(current + 1).padStart(2, '0')} / 04`;
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === current)));
  }
  buttons.forEach((button) => button.addEventListener('click', () => showPhoto(Number(button.dataset.photo))));
  document.querySelector('#gallery-prev').addEventListener('click', () => showPhoto(current - 1));
  document.querySelector('#gallery-next').addEventListener('click', () => showPhoto(current + 1));

  const dialog = document.querySelector('#video-dialog');
  const player = document.querySelector('#video-player');
  let trigger = null;
  document.querySelectorAll('[data-video]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof dialog.showModal !== 'function') return;
      const id = link.dataset.video;
      if (!/^[a-f0-9]{32}$/.test(id)) return;
      event.preventDefault();
      trigger = link;
      document.querySelector('#video-title').textContent = link.dataset.title;
      document.querySelector('#video-fallback').href = link.href;
      const iframe = document.createElement('iframe');
      iframe.src = `https://rutube.ru/play/embed/${id}`;
      iframe.title = link.dataset.title;
      iframe.allow = 'fullscreen; picture-in-picture; encrypted-media';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      player.replaceChildren(iframe);
      dialog.showModal();
      document.body.classList.add('dialog-open');
      document.querySelector('#video-close').focus();
    });
  });
  document.querySelector('#video-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    player.replaceChildren();
    document.body.classList.remove('dialog-open');
    if (trigger) trigger.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
})();
