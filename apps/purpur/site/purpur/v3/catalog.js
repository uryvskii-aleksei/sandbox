(function (root, factory) {
  'use strict';
  const view = typeof module === 'object' && module.exports
    ? require('../concept/catalog-view.js')
    : root.PurpurCatalogView;
  const api = factory(view);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.PurpurV3Catalog = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.mount, { once: true });
    else api.mount();
  }
})(typeof window === 'undefined' ? globalThis : window, function (view) {
  'use strict';

  const categories = new Set(['all', 'gifts', 'sugarfree', 'truffles', 'marmalade', 'chocolate', 'marzipan', 'fruits', 'candied', 'desserts', 'bars', 'dubai', 'marshmallow', 'toffee']);
  const sorts = new Set(['featured', 'price-asc', 'price-desc', 'name']);
  const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const inCategory = (product, category) => category === 'all' || product.category === category || (product.categories || []).includes(category);

  function selectProducts(products, options = {}) {
    const category = categories.has(options.category) ? options.category : 'all';
    const terms = normalize(options.query).split(' ').filter(Boolean);
    const result = products.filter((product) => {
      if (!inCategory(product, category)) return false;
      const haystack = normalize([product.name, product.title, product.categoryLabel, product.weight, product.packLabel].join(' '));
      return terms.every((term) => haystack.includes(term));
    });
    if (options.sort === 'price-asc') return result.sort((a, b) => a.price - b.price);
    if (options.sort === 'price-desc') return result.sort((a, b) => b.price - a.price);
    if (options.sort === 'name') return result.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || '', 'ru'));
    return view ? view.diverseOrder(result) : result;
  }

  function productSlug(product) {
    try {
      const slug = new URL(product.url).pathname.split('/').filter(Boolean).pop();
      return /^[a-z0-9-]+$/.test(slug) ? slug : '';
    } catch { return ''; }
  }

  function renderCard(product, { productBase = 'product/', cartHref = 'cart/', api = '../' } = {}) {
    const slug = productSlug(product);
    const href = `${productBase}${slug}/`;
    const image = typeof product.image === 'string' && /^assets\/[a-zA-Z0-9._/-]+$/.test(product.image) && !product.image.split('/').includes('..')
      ? `<img src="${esc(`${api}${product.image}`)}" alt="${esc(product.name)}" width="402" height="402" loading="lazy" decoding="async">`
      : '';
    const orderable = product.canOrder !== false && Number.isSafeInteger(product.id) && product.id > 0;
    const action = orderable
      ? `<a class="btn primary" data-add="${product.id}" href="${esc(`${cartHref}?add=${product.id}`)}" aria-label="Добавить в корзину: ${esc(product.name)}">В корзину <span aria-hidden="true">+</span></a>`
      : `<a class="btn secondary" href="${esc(href)}" aria-label="Уточнить фасовку: ${esc(product.name)}">Фасовка уточняется</a>`;
    return `<article class="product-card"><div class="product-image"><a href="${esc(href)}" aria-label="Открыть витрину: ${esc(product.name)}">${image}</a></div><p class="product-category">${esc(product.categoryLabel || '')}</p><h3 class="product-title"><a href="${esc(href)}">${esc(product.title || product.name)}</a></h3><p class="product-meta">${esc(product.weight || 'Вес уточняется')} · ${esc(product.packLabel || '')}</p><div class="product-bottom"><span class="product-price">${new Intl.NumberFormat('ru-RU').format(product.price)} ₽</span>${action}</div></article>`;
  }

  function mount() {
    const page = document.body.dataset.page;
    if (!['home', 'catalog', 'category'].includes(page)) return;
    const grid = document.querySelector('#product-grid');
    const products = window.PRODUCTS;
    if (!grid || !Array.isArray(products)) return;
    const search = document.querySelector('#catalog-search');
    const sort = document.querySelector('#catalog-sort');
    const status = document.querySelector('#catalog-status');
    const empty = document.querySelector('#catalog-empty');
    const reset = document.querySelector('#catalog-reset');
    const more = document.querySelector('#load-more');
    const filters = [...document.querySelectorAll('#category-navigation [data-category]')];
    const params = new URLSearchParams(location.search);
    const fixedCategory = page === 'category' && categories.has(document.body.dataset.category) ? document.body.dataset.category : 'all';
    const source = fixedCategory === 'all' ? products : products.filter((product) => inCategory(product, fixedCategory));
    const initialCategory = params.get('category') || document.body.dataset.category;
    let category = fixedCategory !== 'all' ? fixedCategory : categories.has(initialCategory) ? initialCategory : 'all';
    let query = (params.get('q') || '').slice(0, 200);
    let sorting = sorts.has(params.get('sort')) ? params.get('sort') : 'featured';
    let shown = 8;
    if (search) search.value = query;
    if (sort) sort.value = sorting;
    const paths = { productBase: document.body.dataset.productBase || 'product/', cartHref: document.body.dataset.cart || 'cart/', api: document.body.dataset.api || '../' };

    function saveURL() {
      const url = new URL(location.href);
      for (const [key, value, fallback] of [['q', query.trim(), ''], ['sort', sorting, 'featured'], ['category', category, fixedCategory]]) {
        if (!value || value === fallback) url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    function paint() {
      const matching = selectProducts(source, { category, query, sort: sorting });
      const visible = matching.slice(0, shown);
      grid.innerHTML = visible.map((product) => renderCard(product, paths)).join('');
      filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
      if (empty) empty.hidden = matching.length !== 0;
      if (more) {
        more.hidden = shown >= matching.length;
        more.textContent = `Показать ещё ${Math.min(8, Math.max(0, matching.length - shown))}`;
      }
      if (status) status.textContent = matching.length ? `Показано ${visible.length} из ${matching.length}` : 'Ничего не найдено';
      document.dispatchEvent(new CustomEvent('purpur:catalog-rendered'));
    }

    function change() {
      shown = 8;
      saveURL();
      paint();
    }

    search?.addEventListener('input', () => { query = search.value.slice(0, 200); change(); });
    sort?.addEventListener('change', () => { sorting = sorts.has(sort.value) ? sort.value : 'featured'; change(); });
    filters.forEach((button) => button.addEventListener('click', () => {
      if (fixedCategory !== 'all') return;
      category = categories.has(button.dataset.category) ? button.dataset.category : 'all';
      change();
    }));
    reset?.addEventListener('click', () => {
      query = '';
      category = fixedCategory;
      sorting = 'featured';
      if (search) search.value = '';
      if (sort) sort.value = sorting;
      change();
      search?.focus();
    });
    more?.addEventListener('click', () => {
      const firstNew = shown;
      shown += 8;
      paint();
      const anchor = grid.children[firstNew]?.querySelector('a');
      anchor?.focus({ preventScroll: true });
      anchor?.scrollIntoView({ block: 'nearest' });
    });
    paint();
  }

  return { selectProducts, renderCard, mount };
});
