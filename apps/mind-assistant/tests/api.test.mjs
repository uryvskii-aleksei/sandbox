import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const base = process.env.MIND_ASSISTANT_TEST_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+(?:\/mind-assistant)?\/api$/.test(base)) {
  throw new Error('Тестам нужен отдельный локальный API. Запустите npm run test:mind-assistant.');
}

function client() {
  let cookie = '';
  let csrf = '';
  return async (route, method = 'GET', body, expected = 200, sendCsrf = true) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (sendCsrf) headers['X-CSRF-Token'] = csrf;
    if (body !== undefined && !(body instanceof FormData))
      headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, {
      method,
      headers,
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie())
      if (value.startsWith('mind_assistant=')) cookie = value.split(';')[0];
    if (route.startsWith('/media/') && response.ok)
      return Buffer.from(await response.arrayBuffer());
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    if (result.data?.csrfToken) csrf = result.data.csrfToken;
    assert.equal(result.ok, expected < 400);
    return result.data ?? result.error;
  };
}

test('accounts isolate projects, cards and media, persist nested edits and reject stale/invalid writes', async () => {
  const a = client();
  const b = client();
  const anonymous = client();
  await anonymous('/session');
  await anonymous('/projects', 'GET', undefined, 401);
  await a('/session');
  await b('/session');
  const email = `a-${randomUUID()}@example.test`;
  const password = 'Synthetic-password-2026';
  await a('/auth/register', 'POST', { email, password }, 403, false);
  await a('/auth/register', 'POST', { email, password }, 200);
  await b('/auth/register', 'POST', { email: `b-${randomUUID()}@example.test`, password });
  const project = await a('/projects', 'POST', { name: 'Проверка идей' }, 201);
  await b(`/projects/${project.id}/cards`, 'GET', undefined, 404);
  await b(`/projects/${project.id}`, 'DELETE', undefined, 404);
  await a(`/projects/${project.id}`, 'PATCH', { name: 'Сохранённый проект' });
  let card = await a(
    `/projects/${project.id}/cards`,
    'POST',
    { name: 'Корень', coordinates: { x: 100, y: 200 } },
    201,
  );
  const child = await a(
    `/projects/${project.id}/cards`,
    'POST',
    { name: 'Потомок', parent: card.id },
    201,
  );
  const other = await b('/projects', 'POST', { name: 'Чужой проект' }, 201);
  const foreign = await b(`/projects/${other.id}/cards`, 'POST', { name: 'Чужая карточка' }, 201);
  await a(`/cards/${card.id}`, 'PUT', { ...card, parent: foreign.id }, 422);
  await a(`/cards/${card.id}`, 'PUT', { ...card, parent: child.id }, 422);
  await b(`/cards/${card.id}`, 'PUT', card, 404);
  const values = {
    textarea: ['Сохранённая мысль', 'Второе значение'],
    date: ['2026-11-23'],
    url: ['https://example.com/'],
    image: ['https://example.com/image.png'],
    video: ['https://example.com/video.mp4'],
    audio: ['https://example.com/audio.mp3'],
  };
  card = await a(`/cards/${card.id}`, 'PUT', {
    ...card,
    name: 'Содержание',
    content: [
      {
        id: -1,
        name: 'Материалы',
        collapsed: true,
        fields: Object.entries(values).map(([type, value], index) => ({
          id: -index - 1,
          title: type,
          type,
          value,
        })),
      },
      { id: -2, name: 'Ещё группа', fields: [] },
    ],
  });
  assert.equal(card.content[0].collapsed, true);
  assert.equal(card.content[0].fields.length, 6);
  assert.deepEqual(card.content[0].fields[0].value, values.textarea);
  const old = structuredClone(card);
  card = await a(`/cards/${card.id}/position`, 'PATCH', {
    version: card.version,
    coordinates: { x: -20.5, y: 350 },
  });
  await a(`/cards/${card.id}`, 'PUT', old, 409);
  assert.equal(card.coordinates.x, -20.5);
  const foreignSaved = await b(`/cards/${foreign.id}`, 'PUT', {
    ...foreign,
    content: [
      { id: -1, name: 'Чужая группа', fields: [{ id: -1, type: 'textarea', value: ['Чужое'] }] },
    ],
  });
  const corrupt = structuredClone(card);
  corrupt.name = 'Не должно сохраниться';
  corrupt.content[0].fields.push(foreignSaved.content[0].fields[0]);
  await a(`/cards/${card.id}`, 'PUT', corrupt, 422);
  let saved = (await a(`/projects/${project.id}/cards`)).find((item) => item.id === card.id);
  assert.equal(saved.name, card.name);
  assert.equal(saved.version, card.version);
  const reordered = { ...saved, content: [...saved.content].reverse() };
  reordered.content[1].fields = [...reordered.content[1].fields].reverse();
  card = await a(`/cards/${card.id}`, 'PUT', reordered);
  assert.equal(card.content[0].name, 'Ещё группа');
  assert.equal(card.content[1].fields[0].type, 'audio');
  const invalid = structuredClone(card);
  invalid.content[1].fields[0].value = ['javascript:alert(1)'];
  await a(`/cards/${card.id}`, 'PUT', invalid, 422);
  for (const url of [
    'http://127.0.0.1/',
    'http://169.254.169.254/',
    'file:///etc/passwd',
    'http://localhost/',
    'http://example.com:8080/',
  ]) {
    await a('/preview', 'POST', { url }, 422);
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const media = await a('/media', 'POST', form, 201);
  const mediaRoute = media.url.slice(new URL(base).pathname.length);
  assert.deepEqual(await a(mediaRoute), png);
  await b(mediaRoute, 'GET', undefined, 404);
  const wrong = new FormData();
  wrong.set('file', new Blob(['<?php echo 1;']), 'x.php');
  await a('/media', 'POST', wrong, 422);
  await a('/auth/logout', 'POST', {});
  await a('/projects', 'GET', undefined, 401);
  await a('/auth/login', 'POST', { email, password: 'Wrong-password' }, 401);
  await a('/auth/login', 'POST', { email, password });
  saved = (await a(`/projects/${project.id}/cards`)).find((item) => item.id === card.id);
  assert.deepEqual(saved, card);
  await a(`/cards/${card.id}`, 'DELETE');
  const remaining = await a(`/projects/${project.id}/cards`);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].parent, null);
  await a(`/projects/${project.id}`, 'DELETE');
  assert.deepEqual(await a('/projects'), []);
  await a(`/cards/${child.id}`, 'DELETE', undefined, 404);
});
