(function () {
  'use strict';

  const products = window.PRODUCTS || [];
  const grid = document.querySelector('#product-grid');
  const gifts = document.querySelector('#gift-grid');
  if (!grid || !gifts || !products.length || !window.PurpurCatalogView) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const money = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  const api = document.body.dataset.api || '../';

  function slug(product) {
    try {
      return new URL(product.url).pathname.split('/').filter(Boolean).pop();
    } catch {
      return '';
    }
  }

  function image(product) {
    return typeof product.image === 'string' && /^assets\/[a-zA-Z0-9._/-]+$/.test(product.image)
      ? `${api}${product.image}`
      : '';
  }

  function buy(product) {
    const address = `product/${slug(product)}/`;
    if (product.canOrder === false) {
      return `<a class="btn secondary" href="${esc(address)}" aria-label="Уточнить фасовку: ${esc(product.name)}">Фасовка уточняется</a>`;
    }
    return `<a class="btn primary" data-add="${product.id}" href="cart/?add=${product.id}" aria-label="Добавить в корзину: ${esc(product.name)}">В корзину <span aria-hidden="true">+</span></a>`;
  }

  function cats(product) {
    return [product.category, ...(product.categories || [])]
      .filter((id, index, list) => id && list.indexOf(id) === index)
      .join(' ');
  }

  grid.innerHTML = window.PurpurCatalogView.diverseOrder(products).map((product) => {
    const address = `product/${slug(product)}/`;
    const picture = image(product)
      ? `<img src="${esc(image(product))}" alt="${esc(product.name)}" width="402" height="402">`
      : '';
    const title = product.title || product.name;
    return `<article class="product-card" data-cats="${esc(cats(product))}"><div class="product-image"><a href="${esc(address)}" aria-label="Открыть витрину: ${esc(product.name)}">${picture}</a></div><p class="product-category">${esc(product.categoryLabel || '')}</p><h3 class="product-title"><a href="${esc(address)}">${esc(title)}</a></h3><p class="product-meta">${product.weight ? esc(product.weight) : 'Вес уточняется'} · ${esc(product.packLabel || '')}</p><div class="product-bottom"><span class="product-price">${money(product.price)}</span>${buy(product)}</div></article>`;
  }).join('');

  gifts.innerHTML = products.filter((product) => product.giftAssortment).map((product) => {
    const address = `product/${slug(product)}/`;
    const picture = image(product)
      ? `<img src="${esc(image(product))}" alt="${esc(product.name)}" width="402" height="402" loading="lazy">`
      : '';
    return `<article class="gift-card"><a class="gift-image" href="${esc(address)}" aria-label="Рассмотреть набор: ${esc(product.title)}">${picture}</a><div class="gift-body"><h3><a href="${esc(address)}">${esc(product.title)}</a></h3><p class="gift-meta">${esc(product.weight)} · четыре начинки${product.pieces ? ` · ${product.pieces} конфет` : ''}</p><div class="gift-bottom"><span class="gift-price">${money(product.price)}</span>${buy(product)}</div></div></article>`;
  }).join('');

  const heroVideo = document.querySelector('#hero-video');
  if (heroVideo && window.createBackgroundVideo) {
    const background = window.createBackgroundVideo({
      video: heroVideo,
      button: null,
      page: document,
      motion: matchMedia('(prefers-reduced-motion: reduce)'),
      observe(onVisibility) {
        const observer = new IntersectionObserver((entries) => {
          onVisibility(entries[0].isIntersecting && entries[0].intersectionRatio >= 0.08);
        }, { threshold: 0.08 });
        observer.observe(heroVideo);
        return observer;
      },
    });
    window.addEventListener('pagehide', () => background.suspend());
    window.addEventListener('pageshow', () => background.resume());
  }

  document.addEventListener('DOMContentLoaded', () => {
    const more = document.querySelector('#load-more');
    const filters = [...document.querySelectorAll('#category-navigation [data-category]')];
    if (!more || !filters.length) return;
    const fresh = more.cloneNode(true);
    more.replaceWith(fresh);
    const cards = [...grid.children].filter((card) => card.classList.contains('product-card'));
    const pageSize = 8;
    let shown = pageSize;
    let category = 'all';
    const matches = (card) => category === 'all' || (card.dataset.cats || '').split(/\s+/).includes(category);
    function paint() {
      const visible = cards.filter(matches);
      const last = visible[Math.min(shown, visible.length) - 1];
      cards.forEach((card) => {
        const index = visible.indexOf(card);
        const show = index >= 0 && index < shown;
        card.hidden = !show;
        card.classList.toggle('is-last-visible', show && card === last);
      });
      fresh.hidden = shown >= visible.length;
    }
    paint();
    fresh.addEventListener('click', () => {
      const visible = cards.filter(matches);
      const first = shown;
      shown += pageSize;
      paint();
      const focus = visible[first]?.querySelector('a');
      if (focus) {
        focus.focus({ preventScroll: true });
        focus.scrollIntoView({ block: 'nearest' });
      }
    });
    filters.forEach((button) => {
      button.addEventListener('click', () => {
        category = button.dataset.category || 'all';
        shown = pageSize;
        filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        paint();
      });
    });
  });
})();
