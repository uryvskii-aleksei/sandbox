(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const money = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  const products = window.PRODUCTS || [];
  const store = window.PurpurStore;
  const cartKey = 'purpur-v2-cart';
  const page = document.body.dataset.page;
  const api = document.body.dataset.api || './';
  const cartHref = document.body.dataset.cart || 'cart/';
  const catalogHref = document.body.dataset.catalog || 'catalog/';
  let savedCart = {};
  try { savedCart = JSON.parse(localStorage.getItem(cartKey) || '{}'); } catch { /* Пустая корзина, если хранилище недоступно. */ }
  const session = window.PurpurConcept.createSession(products, savedCart);
  let toastTimer;
  let cdekMap;
  let cdekLayer;
  let cdekTarget;
  let sendError = '';

  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function persistCart() {
    try { localStorage.setItem(cartKey, session.serializeCart()); } catch { /* Заявка всё равно собирается в памяти страницы. */ }
    updateCount();
    paintAddLinks();
  }

  function updateCount() {
    const { count } = session.summary();
    $$('.cart-count').forEach((element) => { element.textContent = count; });
    $$('.cart-toggle').forEach((element) => element.setAttribute('aria-label', `Открыть корзину: ${count} шт.`));
  }

  function paintAddLinks() {
    $$('[data-add]').forEach((link) => {
      const id = Number(link.dataset.add);
      const product = products.find((item) => item.id === id);
      const quantity = session.cart()[id] || 0;
      if (!product || product.canOrder === false || !quantity) return;
      link.href = cartHref;
      link.textContent = `В корзине · ${quantity}`;
      link.setAttribute('aria-label', `Открыть корзину, уже ${quantity} шт.: ${product.name}`);
    });
  }

  function closeMenu() {
    const menu = $('#mobile-nav');
    const toggle = $('#menu-toggle');
    if (!menu || !toggle) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Открыть меню');
  }

  const toggle = $('#menu-toggle');
  toggle?.addEventListener('click', () => {
    const menu = $('#mobile-nav');
    const expanded = menu.hidden;
    menu.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Закрыть меню' : 'Открыть меню');
  });
  $('#mobile-nav')?.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  matchMedia('(min-width: 901px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#mobile-nav') && !$('#mobile-nav').hidden) {
      closeMenu();
      toggle?.focus();
    }
  });

  const header = $('.header');
  if (header) {
    const paintHeader = () => header.classList.toggle('is-raised', window.scrollY > 2);
    paintHeader();
    window.addEventListener('scroll', paintHeader, { passive: true });
  }

  function setupCatalog() {
    const grid = $('#product-grid');
    const more = $('#load-more');
    if (!grid || !more) return;
    const cards = [...grid.children].filter((card) => card.classList.contains('product-card'));
    const pageSize = 8;
    let shown = pageSize;
    function paint() {
      const last = Math.min(shown, cards.length) - 1;
      cards.forEach((card, index) => {
        card.hidden = index >= shown;
        card.classList.toggle('is-last-visible', index === last);
      });
      more.hidden = shown >= cards.length;
    }
    paint();
    more.addEventListener('click', () => {
      const first = shown;
      shown += pageSize;
      paint();
      const focus = cards[first]?.querySelector('a');
      if (focus) {
        focus.focus({ preventScroll: true });
        focus.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function showFieldError(element, message) {
    const label = element.closest('.field');
    if (!label) return;
    let note = label.querySelector('.field-error');
    if (!message) {
      element.removeAttribute('aria-invalid');
      element.removeAttribute('aria-describedby');
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement('span');
      note.className = 'field-error';
      label.append(note);
    }
    note.id = `${element.name}-error`;
    note.textContent = message;
    element.setAttribute('aria-invalid', 'true');
    element.setAttribute('aria-describedby', note.id);
  }

  function applyErrors(form, errors) {
    let first = null;
    for (const element of form.elements) {
      if (typeof element.setCustomValidity !== 'function' || !element.name) continue;
      element.setCustomValidity('');
      const message = errors[element.name] || '';
      showFieldError(element, message);
      if (message && !first) first = element;
    }
    first?.focus();
  }

  function readRetailForm(form) {
    const values = {};
    for (const key of Object.keys(session.retailDraft())) {
      const field = form.elements.namedItem(key);
      if (field) values[key] = field.value;
    }
    session.saveRetail(values);
  }

  async function sendApplication(kind, text) {
    try {
      const response = await fetch(`${api}order.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ kind, text }),
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.append(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('map'));
      document.head.append(script);
    });
  }

  function chooseCdekPoint(point) {
    if (!cdekTarget) return;
    cdekTarget.value = `${point.city}, ${point.address}, ${point.code}`;
    const chosen = $('#cdek-chosen');
    if (chosen) chosen.textContent = cdekTarget.value;
    cdekTarget.dispatchEvent(new Event('input', { bubbles: true }));
    const panel = $('#cdek-map-panel');
    if (panel) panel.hidden = true;
  }

  async function drawCdek(query) {
    const note = $('#cdek-map-note');
    note.textContent = 'Загружаем пункты СДЭК…';
    cdekLayer.clearLayers();
    const url = query.code
      ? `${api}cdek-points.php?code=${encodeURIComponent(query.code)}`
      : `${api}cdek-points.php?city=${encodeURIComponent(query.city || '')}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    const points = Array.isArray(data.points) ? data.points : [];
    const bounds = [];
    points.forEach((point) => {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
      const marker = window.L.circleMarker([point.lat, point.lon], {
        radius: 9, color: '#ffffff', weight: 2, fillColor: '#9d169e', fillOpacity: 1,
      });
      const popup = document.createElement('div');
      const text = document.createElement('p');
      text.textContent = `${point.city}, ${point.address}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn primary cdek-pick';
      button.textContent = 'Выбрать';
      button.addEventListener('click', () => chooseCdekPoint(point));
      popup.append(text, button);
      marker.bindPopup(popup, { minWidth: 240, maxWidth: 280 });
      marker.addTo(cdekLayer);
      bounds.push([point.lat, point.lon]);
    });
    if (bounds.length) cdekMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
    else cdekMap.setView([59.94, 30.31], 10);
    setTimeout(() => cdekMap.invalidateSize(), 80);
    note.textContent = bounds.length
      ? `На карте ${bounds.length} пунктов. Нажмите точку и подтвердите выбор.`
      : 'Пункты не найдены. Проверьте название города.';
  }

  function setCdekMapOpen(open) {
    const panel = $('#cdek-map-panel');
    if (panel) panel.hidden = !open;
  }

  async function showCdekMap(input, preset) {
    cdekTarget = input;
    const panel = $('#cdek-map-panel');
    const cityInput = $('#cdek-map-city');
    if (preset.city) cityInput.value = preset.city;
    setCdekMapOpen(true);
    const note = $('#cdek-map-note');
    try {
      await loadLeaflet();
      if (cdekMap) {
        try { cdekMap.remove(); } catch { /* Старая карта уже снята вместе с формой. */ }
        cdekMap = null;
        cdekLayer = null;
      }
      cdekMap = window.L.map('cdek-map');
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap',
      }).addTo(cdekMap);
      cdekLayer = window.L.layerGroup().addTo(cdekMap);
      setTimeout(() => cdekMap.invalidateSize(), 60);
      if (!preset.code && !cityInput.value.trim()) {
        note.textContent = 'Введите город, чтобы показать пункты на карте.';
        cdekMap.setView([59.94, 30.31], 10);
        return;
      }
      await drawCdek(preset.code ? { code: preset.code } : { city: cityInput.value.trim() });
    } catch {
      note.textContent = 'Карта СДЭК не открылась. Попробуйте ещё раз.';
    }
  }

  function focusTitle() {
    const title = $('#cart-title');
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }

  function renderCart() {
    const content = $('#cart-content');
    const title = $('#cart-title');
    if (!content || !title) return;
    title.textContent = 'Корзина';
    const { items, total } = session.summary();
    if (!items.length) {
      content.innerHTML = `<div class="empty-results"><h3>Здесь будут ваши сладости.</h3><p>Добавьте понравившиеся сладости — и продолжим.</p><a class="btn primary" href="${esc(catalogHref)}">Выбрать сладости →</a></div>`;
      return;
    }
    const productBase = cartHref.replace(/cart\/$/, 'product/');
    content.innerHTML = `<a class="back-button" href="${esc(catalogHref)}">← Продолжить выбор</a>${items.map((product) => `<article class="cart-item"><a href="${esc(productBase)}${esc(productSlug(product))}/"><img src="${esc(asset(product.image))}" alt="${esc(product.name)}" width="70" height="80"></a><div><h3>${esc(product.title || product.name)}</h3><small>${esc(product.weight)} · ${money(product.price)} за упаковку</small><div class="qty"><button type="button" data-quantity="${product.id}" data-delta="-1" aria-label="Уменьшить количество: ${esc(product.title || product.name)}" ${product.quantity === 1 ? 'disabled' : ''}>−</button><span aria-label="Количество">${product.quantity}</span><button type="button" data-quantity="${product.id}" data-delta="1" aria-label="Увеличить количество: ${esc(product.title || product.name)}" ${product.quantity === store.MAX_QUANTITY ? 'disabled' : ''}>+</button></div><button type="button" class="remove-item" data-remove="${product.id}" aria-label="Удалить из корзины: ${esc(product.title || product.name)}">Убрать</button></div><span class="cart-item-price">${money(product.subtotal)}</span></article>`).join('')}<div class="cart-total"><span>Товары</span><span>${money(total)}</span></div><button type="button" class="btn primary cart-action" data-checkout>Перейти к оформлению <span aria-hidden="true">→</span></button>`;
  }

  function productSlug(product) {
    try {
      return new URL(product.url).pathname.split('/').filter(Boolean).pop();
    } catch {
      return '';
    }
  }

  function asset(image) {
    if (typeof image !== 'string' || !/^assets\/[a-zA-Z0-9._/-]+$/.test(image)) return '';
    if (api.startsWith('/')) return `${api}${image}`;
    return `${api}${image}`;
  }

  function renderCheckout() {
    const content = $('#cart-content');
    const title = $('#cart-title');
    const draft = session.retailDraft();
    const { total, count } = session.summary();
    title.textContent = 'Оформление заявки';
    content.innerHTML = `<button type="button" class="back-button" data-back>← Вернуться к корзине</button><form id="checkout-form" novalidate><div class="field-row"><label class="field">Ваше имя<input name="name" required maxlength="100" autocomplete="name" value="${esc(draft.name)}"></label><label class="field">Телефон<input name="phone" type="tel" required maxlength="40" autocomplete="tel" placeholder="+7 (___) ___-__-__" value="${esc(draft.phone)}"></label></div><label class="field">Как получить<select name="delivery"><option value="spb" ${draft.delivery === 'spb' ? 'selected' : ''}>ПВЗ СДЭК в Санкт-Петербурге</option><option value="region" ${draft.delivery === 'region' ? 'selected' : ''}>СДЭК в другой город России</option><option value="pickup" ${draft.delivery === 'pickup' ? 'selected' : ''}>Самовывоз с фабрики</option></select></label><label class="field" id="checkout-city-field" ${draft.delivery === 'pickup' ? 'hidden' : ''}>Пункт выдачи СДЭК<button type="button" class="btn secondary cdek-open" id="cdek-open"><svg class="cdek-map-icon" aria-hidden="true"><use href="#map-icon"/></svg>Выбрать пункт на карте</button><p class="cdek-chosen" id="cdek-chosen">${esc(draft.city)}</p><input type="hidden" name="city" id="cdek-point" value="${esc(draft.city)}"><div id="cdek-map-panel" hidden><label class="cdek-map-search">Город<input id="cdek-map-city" maxlength="80" placeholder="Санкт-Петербург"></label><div id="cdek-map"></div><p class="quiet" id="cdek-map-note"></p></div></label><div class="checkout-summary">${count} шт. по каталогу · <strong>${money(total)}</strong><p class="cart-note" id="checkout-delivery-note">${esc(store.shipping(total, draft.delivery))}</p></div>${sendError ? `<p class="demo-note" role="alert">${esc(sendError)}</p>` : ''}<button type="submit" class="btn primary cart-action">Отправить заявку <span aria-hidden="true">→</span></button></form>`;
    const form = $('#checkout-form');
    form.addEventListener('input', (event) => {
      if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
      showFieldError(event.target, '');
      readRetailForm(form);
    });
    $('#cdek-open')?.addEventListener('click', () => showCdekMap($('#cdek-point'), form.elements.delivery.value === 'region' ? {} : { code: '137', city: 'Санкт-Петербург' }));
    const cityInput = $('#cdek-map-city');
    const searchCdekCity = () => {
      const value = cityInput.value.trim();
      if (value) drawCdek({ city: value });
    };
    cityInput.addEventListener('change', searchCdekCity);
    cityInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      searchCdekCity();
    });
    form.addEventListener('change', () => {
      readRetailForm(form);
      const method = form.elements.delivery.value;
      const pickup = method === 'pickup';
      $('#checkout-city-field').hidden = pickup;
      const city = form.elements.city;
      if (pickup && city) city.value = '';
      $('#checkout-delivery-note').textContent = store.shipping(session.summary().total, method);
      if (pickup) setCdekMapOpen(false);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      readRetailForm(form);
      const result = session.prepareRetail();
      if (!result.ok) { applyErrors(form, result.errors); return; }
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      button.textContent = 'Отправляем…';
      const sent = await sendApplication('retail', session.retailText());
      if (!sent) {
        sendError = 'Письмо не ушло. Проверьте связь и отправьте заявку ещё раз или позвоните +7 (812) 911-59-36.';
        session.beginCheckout();
        renderCheckout();
        focusTitle();
        return;
      }
      sendError = '';
      session.markSent();
      renderSent();
      focusTitle();
    });
  }

  function renderSent() {
    $('#cart-title').textContent = 'Заявка отправлена';
    $('#cart-content').innerHTML = `<div class="prepared-result"><h3>Заявка ушла на почту фабрики.</h3><p>Мы свяжемся с вами и подтвердим наличие, сумму и получение. Деньги не списаны, заказ не зарезервирован.</p></div><a class="btn primary cart-action" href="${esc(catalogHref)}">Вернуться к сладостям</a>`;
  }

  function bindCart() {
    const added = Number(new URLSearchParams(location.search).get('add'));
    if (Number.isSafeInteger(added) && added > 0 && !session.cart()[added] && session.setQuantity(added, 1)) {
      persistCart();
      toast('Сладость в корзине');
    }
    if (location.search) history.replaceState(null, '', location.pathname);
    if (session.stage() === 'sent' && session.summary().count) renderSent();
    else renderCart();
    $('#cart-content').addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-quantity]')) {
        const id = target.dataset.quantity;
        session.setQuantity(id, (session.cart()[id] || 0) + Number(target.dataset.delta));
        persistCart();
        renderCart();
        const next = $(`[data-quantity="${id}"][data-delta="${target.dataset.delta}"]`);
        if (next && !next.disabled) next.focus({ preventScroll: true });
        else focusTitle();
      } else if (target.matches('[data-remove]')) {
        session.setQuantity(target.dataset.remove, 0);
        persistCart();
        renderCart();
        focusTitle();
      } else if (target.matches('[data-checkout]')) {
        if (!session.beginCheckout()) return;
        renderCheckout();
        $('#checkout-form')?.elements.name.focus({ preventScroll: true });
      } else if (target.matches('[data-back]')) {
        session.backToCart();
        renderCart();
        focusTitle();
      }
    });
  }

  function bindBusiness() {
    $$('form[data-business]').forEach((form) => {
      const type = form.dataset.business;
      const result = $('.form-result', form);
      form.addEventListener('input', (event) => {
        if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
        showFieldError(event.target, '');
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const draft = {};
        for (const key of Object.keys(session.businessDraft(type))) draft[key] = form.elements.namedItem(key).value;
        session.saveBusiness(type, draft);
        const check = session.prepareBusiness(type);
        if (!check.ok) { applyErrors(form, check.errors); return; }
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        button.textContent = 'Отправляем…';
        const sent = await sendApplication('business', session.businessText(type));
        button.disabled = false;
        button.textContent = 'Отправить обращение';
        result.innerHTML = sent
          ? '<div class="prepared-result"><h3>Обращение ушло на почту фабрики.</h3><p>Это не оплата и не бронь. Менеджер ответит по указанному контакту.</p></div>'
          : '<p class="demo-note" role="alert">Письмо не ушло. Позвоните +7 (812) 911-59-36.</p>';
      });
    });
  }

  const paramsAddedOnThisPage = page === 'cart';
  if (paramsAddedOnThisPage) bindCart();
  if (page === 'business') bindBusiness();
  setupCatalog();
  persistCart();
})();
