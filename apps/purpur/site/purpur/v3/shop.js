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
  const cartKey = 'purpur-v3-cart';
  const page = document.body.dataset.page;
  const api = document.body.dataset.api || './';
  const cartHref = document.body.dataset.cart || 'cart/';
  const catalogHref = document.body.dataset.catalog || 'catalog/';
  let savedCart = {};
  try { savedCart = JSON.parse(localStorage.getItem(cartKey) || '{}'); } catch { /* Пустая корзина, если хранилище недоступно. */ }
  const session = window.PurpurConcept.createSession(products, savedCart);
  let toastTimer;

  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  // При возврате из BFCache и работе во второй вкладке корзина может быть новее памяти страницы.
  function syncCart() {
    let next;
    try { next = store.normalizeCart(JSON.parse(localStorage.getItem(cartKey) || '{}'), products); }
    catch { return false; }
    const current = session.cart();
    const ids = new Set([...Object.keys(current), ...Object.keys(next)]);
    let changed = false;
    for (const id of ids) {
      if ((current[id] || 0) === (next[id] || 0)) continue;
      session.setQuantity(id, next[id] || 0);
      changed = true;
    }
    if (changed) { updateCount(); paintAddLinks(); }
    return changed;
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
      if (!product || product.canOrder === false) return;
      if (!quantity) {
        link.href = `${cartHref}?add=${id}`;
        link.textContent = 'В корзину +';
        link.setAttribute('aria-label', `Добавить в корзину: ${product.name}`);
        return;
      }
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
    note.id = `${element.form?.id || 'form'}-${element.name}-error`;
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

  function downloadText(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function preparedMarkup(text, subject) {
    const mail = `mailto:info@purpur.spb.ru?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    return `<div class="prepared-result"><h3>Заявка подготовлена</h3><p>Теперь скачайте её или откройте письмо и отправьте из своей почты на info@purpur.spb.ru. Фабрика пока не получила заявку. Наличие, итоговую сумму и оплату подтвердит менеджер.</p></div><div class="prepared-actions"><button class="btn primary" type="button" data-download>Скачать заявку</button><a class="btn secondary" href="${esc(mail)}">Открыть письмо</a></div><details><summary>Посмотреть текст заявки</summary><pre class="order-preview">${esc(text)}</pre></details><p class="v3-cart-note">Если почтовая программа не открылась, скачайте файл и приложите его к письму. Деньги не списаны, заказ не зарезервирован.</p>`;
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
    content.innerHTML = `<a class="back-button" href="${esc(catalogHref)}">← Продолжить выбор</a>${items.map((product) => `<article class="cart-item"><a href="${esc(productBase)}${esc(productSlug(product))}/"><img src="${esc(asset(product.image))}" alt="${esc(product.name)}" width="70" height="80"></a><div><h3>${esc(product.title || product.name)}</h3><small>${esc(product.weight)} · ${money(product.price)} за упаковку</small><div class="qty"><button type="button" data-quantity="${product.id}" data-delta="-1" aria-label="Уменьшить количество: ${esc(product.title || product.name)}" ${product.quantity === 1 ? 'disabled' : ''}>−</button><span aria-label="Количество">${product.quantity}</span><button type="button" data-quantity="${product.id}" data-delta="1" aria-label="Увеличить количество: ${esc(product.title || product.name)}" ${product.quantity === store.MAX_QUANTITY ? 'disabled' : ''}>+</button></div><button type="button" class="remove-item" data-remove="${product.id}" aria-label="Удалить из корзины: ${esc(product.title || product.name)}">Убрать</button></div><span class="cart-item-price">${money(product.subtotal)}</span></article>`).join('')}<div class="cart-total"><span>Товары</span><span>${money(total)}</span></div><p class="v3-cart-note">Наличие и итоговую сумму подтвердит менеджер. Оплата после согласования.</p><button type="button" class="btn primary cart-action" data-checkout>Подготовить заявку <span aria-hidden="true">→</span></button>`;
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
    const draft = session.retailDraft();
    const { total, count } = session.summary();
    $('#cart-title').textContent = 'Заявка на сладости';
    content.innerHTML = `<button type="button" class="back-button" data-back>← Вернуться к корзине</button><p class="quiet">1. Ваши контакты → 2. Подготовка → 3. Отправка из вашей почты</p><form id="checkout-form" novalidate><div class="field-row"><label class="field">Ваше имя<input name="name" required maxlength="100" autocomplete="name" value="${esc(draft.name)}"></label><label class="field">Телефон<input name="phone" type="tel" required maxlength="40" autocomplete="tel" placeholder="+7 (___) ___-__-__" value="${esc(draft.phone)}"></label></div><label class="field">Как получить<select name="delivery"><option value="spb" ${draft.delivery === 'spb' ? 'selected' : ''}>ПВЗ СДЭК в Санкт-Петербурге</option><option value="region" ${draft.delivery === 'region' ? 'selected' : ''}>СДЭК в другой город России</option><option value="pickup" ${draft.delivery === 'pickup' ? 'selected' : ''}>Самовывоз с фабрики</option></select></label><label class="field" id="checkout-city-field" ${draft.delivery === 'pickup' ? 'hidden' : ''}>Город или пункт выдачи СДЭК<input name="city" maxlength="240" value="${esc(draft.city)}" placeholder="Город, адрес удобного пункта"></label><label class="field">Пожелания <span class="optional">необязательно</span><textarea name="notes" rows="3" maxlength="1500" placeholder="Что нам учесть при подготовке?">${esc(draft.notes)}</textarea></label><div class="checkout-summary">${count} шт. по каталогу · <strong>${money(total)}</strong><p class="cart-note" id="checkout-delivery-note">${esc(store.shipping(total, draft.delivery))}</p></div><p class="checkout-notice">Кнопка подготовит текст заявки. Затем вы сможете скачать файл или отправить письмо. Контактные данные остаются в памяти этой страницы до её закрытия или обновления.</p><button type="submit" class="btn primary cart-action">Подготовить заявку <span aria-hidden="true">→</span></button></form>`;
    const form = $('#checkout-form');
    form.addEventListener('input', (event) => {
      showFieldError(event.target, '');
      readRetailForm(form);
    });
    form.addEventListener('change', () => {
      readRetailForm(form);
      const method = form.elements.delivery.value;
      $('#checkout-city-field').hidden = method === 'pickup';
      $('#checkout-delivery-note').textContent = store.shipping(session.summary().total, method);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      readRetailForm(form);
      const result = session.prepareRetail();
      if (!result.ok) { applyErrors(form, result.errors); return; }
      $('#cart-title').textContent = 'Заявка подготовлена';
      content.innerHTML = `<button type="button" class="back-button" data-edit>← Изменить заявку</button>${preparedMarkup(session.retailText(), 'Розничная заявка Пурпур')}`;
      $('[data-download]', content).addEventListener('click', () => downloadText(session.retailText(), 'purpur-request.txt'));
      $('[data-edit]', content).addEventListener('click', () => { session.beginCheckout(); renderCheckout(); focusTitle(); });
      focusTitle();
    });
  }

  function bindCart() {
    const added = Number(new URLSearchParams(location.search).get('add'));
    if (Number.isSafeInteger(added) && added > 0 && !session.cart()[added] && session.setQuantity(added, 1)) {
      persistCart();
      toast('Сладость в корзине');
    }
    if (location.search) history.replaceState(null, '', location.pathname);
    renderCart();
    $('#cart-content').addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      syncCart();
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
        result.replaceChildren();
        if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
        showFieldError(event.target, '');
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const draft = {};
        for (const key of Object.keys(session.businessDraft(type))) draft[key] = form.elements.namedItem(key).value;
        session.saveBusiness(type, draft);
        const check = session.prepareBusiness(type);
        if (!check.ok) { applyErrors(form, check.errors); return; }
        const text = session.businessText(type);
        result.innerHTML = preparedMarkup(text, type === 'corporate' ? 'Корпоративные подарки Пурпур' : 'Поставки Пурпур');
        $('[data-download]', result).addEventListener('click', () => downloadText(text, 'purpur-business-request.txt'));
        result.tabIndex = -1;
        result.focus();
      });
    });
  }

  const paramsAddedOnThisPage = page === 'cart';
  if (paramsAddedOnThisPage) bindCart();
  if (page === 'business') bindBusiness();
  document.addEventListener('purpur:catalog-rendered', () => { updateCount(); paintAddLinks(); });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-add]');
    if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    syncCart();
    const id = Number(link.dataset.add);
    if (session.cart()[id]) return;
    if (!session.setQuantity(id, 1)) return;
    event.preventDefault();
    persistCart();
    const node = $('#toast');
    if (node) {
      node.innerHTML = `Добавлено в корзину · <a href="${esc(cartHref)}">Перейти к оформлению →</a>`;
      node.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => node.classList.remove('show'), 5000);
    }
  });
  persistCart();
  window.addEventListener('pageshow', () => {
    if (syncCart() && page === 'cart') renderCart();
  });
  window.addEventListener('storage', (event) => {
    if ((event.key === cartKey || event.key === null) && syncCart() && page === 'cart') {
      renderCart();
      toast('Корзина обновлена в другой вкладке');
    }
  });

  const heroVideo = $('#hero-video');
  if (heroVideo && window.createBackgroundVideo) {
    const background = window.createBackgroundVideo({
      video: heroVideo,
      button: $('#hero-video-toggle'),
      page: document,
      motion: matchMedia('(prefers-reduced-motion: reduce)'),
      observe(onVisibility) {
        const observer = new IntersectionObserver((entries) => {
          onVisibility(entries[0].isIntersecting && entries[0].intersectionRatio >= 0.08);
        }, {
          threshold: 0.08,
          rootMargin: `-${Math.ceil(($('.header')?.getBoundingClientRect().height) || 0)}px 0px 0px 0px`,
        });
        observer.observe(heroVideo);
        return observer;
      },
    });
    window.addEventListener('pagehide', () => background.suspend());
    window.addEventListener('pageshow', () => background.resume());
  }
})();
