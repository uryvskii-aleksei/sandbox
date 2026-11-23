(function () {
  'use strict';

  const header = document.querySelector('.header');
  const toggle = document.querySelector('#menu-toggle');
  const menu = document.querySelector('#mobile-nav');
  const film = document.querySelector('.film');
  const previous = document.querySelector('[data-scroll="-1"]');
  const next = document.querySelector('[data-scroll="1"]');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const onScroll = () => header.classList.toggle('is-raised', window.scrollY > 4);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    document.body.classList.toggle('menu-open', open);
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

  if (film && previous && next) {
    const updateFilm = () => {
      const max = film.scrollWidth - film.clientWidth;
      previous.disabled = film.scrollLeft <= 2;
      next.disabled = film.scrollLeft >= max - 2;
    };

    const stepFilm = (direction) => {
      const card = film.querySelector('article');
      const styles = getComputedStyle(film);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 20;
      film.scrollBy({
        left: (card.getBoundingClientRect().width + gap) * direction,
        behavior: motion.matches ? 'auto' : 'smooth',
      });
    };

    previous.addEventListener('click', () => stepFilm(-1));
    next.addEventListener('click', () => stepFilm(1));
    film.addEventListener('scroll', updateFilm, { passive: true });
    window.addEventListener('resize', updateFilm);
    updateFilm();
  }
})();
