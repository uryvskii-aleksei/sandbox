import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const base = process.env.MEMO_TEST_URL ?? process.env.MIND_ASSISTANT_TEST_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+(?:\/memo|\/mind-assistant)?\/api$/.test(base)) {
  throw new Error('Тестам нужен отдельный локальный API. Запустите npm run test:memo.');
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

test('guest transfer is private, preserves a complete board and deduplicates retries', async () => {
  const owner = client();
  const guest = client();
  const outsider = client();
  const payload = {
    name: 'Гостевое полотно',
    requestId: randomUUID(),
    cards: [
      {
        id: 9,
        kind: 'folder',
        name: 'Папка',
        coordinates: { x: 50, y: 60 },
        size: { width: 280, height: 70 },
      },
      {
        id: 2,
        kind: 'record',
        name: 'Первое\nНазвание',
        folder: 9,
        coordinates: { x: 71, y: 32 },
        size: { width: 230, height: 75 },
        autoHeight: false,
        document: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Черновик записи' }] }],
        },
      },
    ],
    links: [{ source: 9, target: 2, label: 'Тема' }],
    marks: [
      { kind: 'circle', at: { x: 1, y: 2 }, end: { x: 31, y: 32 }, text: 'Фигура', folder: 9 },
    ],
  };
  await guest('/session');
  await guest('/projects/import-guest', 'POST', payload, 401);
  for (const account of [owner, outsider]) {
    await account('/session');
    await account('/auth/register', 'POST', {
      email: `guest-${randomUUID()}@example.test`,
      password: 'Synthetic-guest-board-2026',
    });
  }
  await owner('/projects/import-guest', 'POST', payload, 403, false);
  const imported = await owner('/projects/import-guest', 'POST', payload, 201);
  assert.deepEqual(await owner('/projects/import-guest', 'POST', payload, 201), imported);
  await owner('/projects/import-guest', 'POST', { ...payload, name: 'Другой запрос' }, 409);
  assert.equal((await owner('/projects')).filter(({ name }) => name === payload.name).length, 1);
  assert.deepEqual(await outsider('/projects'), []);
  await outsider('/projects/' + imported.publicId, 'GET', undefined, 404);
  const folders = await owner('/projects/' + imported.id + '/folders');
  const savedFolder = folders.find(({ name }) => name === 'Папка');
  assert(savedFolder?.publicId);
  const entries = await owner('/projects/' + imported.id + '/cards?folder=' + savedFolder.id);
  assert.equal(imported.cardIds[payload.cards[0].id], savedFolder.id);
  assert.equal(imported.cardIds[payload.cards[1].id], entries[0].id);
  assert.equal(entries[0].name, payload.cards[1].name);
  assert.equal(entries[0].parent, savedFolder.id);
  assert.equal(entries[0].autoHeight, false);
  assert.deepEqual(entries[0].size, payload.cards[1].size);
  assert.deepEqual(entries[0].document, payload.cards[1].document);
  const links = await owner('/links');
  assert(
    links.some(
      ({ source, target, label }) =>
        source === savedFolder.id && target === entries[0].id && label === 'Тема',
    ),
  );
  const marks = await owner('/projects/' + imported.id + '/marks?folder=' + savedFolder.id);
  assert.deepEqual(
    marks.map(({ id, ...mark }) => mark),
    [Object.fromEntries(Object.entries(payload.marks[0]).filter(([key]) => key !== 'folder'))],
  );

  const bad = {
    ...payload,
    requestId: randomUUID(),
    name: 'Ошибочный перенос',
    marks: [{ ...payload.marks[0], folder: 100 }],
  };
  await owner('/projects/import-guest', 'POST', bad, 422);
  assert.equal(
    (await owner('/projects')).some(({ name }) => name === bad.name),
    false,
  );
  const cycle = {
    ...bad,
    marks: [],
    links: [...payload.links, { source: 2, target: 9, label: '' }],
  };
  await owner('/projects/import-guest', 'POST', cycle, 422);
  assert.equal(
    (await owner('/projects')).some(({ name }) => name === cycle.name),
    false,
  );
});

test('projects are ordered by saved edits and retries create one project', async () => {
  const owner = client();
  await owner('/session');
  await owner('/auth/register', 'POST', {
    email: `project-order-${randomUUID()}@example.test`,
    password: 'Synthetic-password-2026',
  });
  const create = (body) => owner('/projects', 'POST', body, 201);
  const first = await create({ name: 'Первый' });
  const note = await owner(`/projects/${first.id}/cards`, 'POST', { name: 'Запись' }, 201);
  const newProject = { name: 'Второй', template: 'tasks', requestId: randomUUID() };
  const second = await create(newProject);
  assert.deepEqual(await create(newProject), second);
  const order = async () =>
    (await owner('/projects')).filter((project) => !project.inbox).map((project) => project.id);

  assert.deepEqual(await order(), [second.id, first.id]);
  await owner(`/cards/${note.id}/visit`, 'POST', {});
  assert.deepEqual(await order(), [second.id, first.id]);

  await owner(`/cards/${note.id}`, 'PUT', {
    ...note,
    name: 'Изменённая запись',
    requestId: randomUUID(),
  });
  assert.deepEqual(await order(), [first.id, second.id]);

  await owner(`/projects/${second.id}`, 'PATCH', { name: 'Изменённый проект' });
  assert.deepEqual(await order(), [second.id, first.id]);

  await owner(
    `/projects/${first.id}/marks`,
    'POST',
    { kind: 'label', text: 'Разметка на полотне', at: { x: 80, y: 80 } },
    201,
  );
  assert.deepEqual(await order(), [first.id, second.id]);
});

test('folders scope nested boards without changing the directed graph or old records', async () => {
  const owner = client();
  const outsider = client();
  for (const signIn of [owner, outsider]) {
    await signIn('/session');
    await signIn('/auth/register', 'POST', {
      email: `folders-${randomUUID()}@example.test`,
      password: 'Synthetic-password-2026',
    });
  }
  const project = await owner('/projects', 'POST', { name: 'Схема с папками' }, 201);
  const other = await owner('/projects', 'POST', { name: 'Другое полотно' }, 201);
  const cards = `/projects/${project.id}/cards`;
  const capture = (body, expected = 201) =>
    owner('/capture', 'POST', { project: project.id, requestId: randomUUID(), ...body }, expected);
  const record = await owner(cards, 'POST', { name: 'Существующая запись' }, 201);
  assert.equal(record.kind, 'record');
  assert.equal(record.folder, null);
  const folder = await capture({ kind: 'folder', name: 'Команда' });
  const nested = await capture({ kind: 'folder', name: 'Ретро', folder: folder.id });
  const note = await capture({ name: 'План встречи', text: 'Сверить решения', folder: nested.id });
  const publicIds = [project, other, record, folder, nested, note].map((item) => item.publicId);
  for (const id of publicIds) assert.match(id, /^m[a-f0-9]{32}$/);
  assert.equal(new Set(publicIds).size, publicIds.length);
  assert.deepEqual(
    await owner(`/projects/${project.publicId}`),
    await owner(`/projects/${project.id}`),
  );
  assert.deepEqual(await owner(`/cards/${note.publicId}`), await owner(`/cards/${note.id}`));
  const folders = await owner(`/projects/${project.publicId}/folders`);
  assert.equal(folders.find(({ id }) => id === nested.id).publicId, nested.publicId);
  await outsider(`/projects/${project.publicId}`, 'GET', undefined, 404);
  await outsider(`/cards/${note.publicId}`, 'GET', undefined, 404);
  await capture({ name: 'Не папка', folder: record.id }, 422);
  await capture({ name: 'Папка другого проекта', folder: folder.id, project: other.id }, 422);
  await outsider(cards + `?folder=${folder.id}`, 'GET', undefined, 404);
  await outsider(`/projects/${project.id}/folders`, 'GET', undefined, 404);
  await outsider('/capture', 'POST', { name: 'Чужая папка', folder: folder.id }, 404);
  const ids = async (scope) => (await owner(cards + '?folder=' + scope)).map((item) => item.id);
  assert.deepEqual(await ids('root'), [record.id, folder.id]);
  assert.deepEqual(await ids(folder.id), [nested.id]);
  assert.deepEqual(await ids(nested.id), [note.id]);
  await owner('/links', 'PUT', { source: folder.id, target: nested.id });
  await owner('/links', 'PUT', { source: nested.id, target: record.id, label: 'Решение' });
  await owner('/links', 'PUT', { source: record.id, target: folder.id }, 422);
  const move = async (id, folder, expected = 200) => {
    const current = await owner(`/cards/${id}`);
    return owner(
      `/cards/${id}/move`,
      'POST',
      { project: project.id, folder, version: current.version },
      expected,
    );
  };
  await move(folder.id, nested.id, 422);
  await move(record.id, folder.id);
  assert.equal((await owner(`/cards/${record.publicId}`)).folder, folder.id);
  assert.deepEqual(await ids('root'), [folder.id]);
  assert.deepEqual(await ids(folder.id), [record.id, nested.id]);
  assert.equal((await owner('/links')).find((link) => link.target === record.id).label, 'Решение');
  await owner(`/cards/${folder.id}`, 'DELETE', undefined, 409);
  const exported = await owner(`/projects/${project.id}/export`);
  assert.equal(exported.cards.find((item) => item.id === note.id).folder, nested.id);
  assert.equal(exported.cards.find((item) => item.id === nested.id).kind, 'folder');
  assert.equal((await owner('/search?q=Сверить')).cards[0].id, note.id);
  await owner(`/cards/${note.id}`, 'DELETE', undefined, 200);
  await owner(`/cards/${note.publicId}`, 'GET', undefined, 404);
  await owner(`/cards/${nested.id}`, 'DELETE', undefined, 200);
  await owner(`/cards/${note.id}/restore`, 'POST', {}, 404);
  await owner(`/cards/${nested.id}/restore`, 'POST', {});
  await owner(`/cards/${note.id}/restore`, 'POST', {});
  assert.deepEqual(await ids(nested.id), [note.id]);
  await owner(
    `/projects/${project.id}/marks`,
    'POST',
    {
      folder: nested.id,
      kind: 'label',
      at: { x: 15, y: 20 },
      text: 'Проверка разметки',
      scale: 2,
    },
    201,
  );
  const destination = {
    project: other.id,
    folder: null,
    coordinates: { x: 88, y: 150 },
    requestId: randomUUID(),
  };
  const copyRoute = `/cards/${folder.id}/copy`;
  await outsider(copyRoute, 'POST', destination, 404);
  await owner(copyRoute, 'POST', { ...destination, folder: nested.id }, 422);
  const copied = await owner(copyRoute, 'POST', destination, 201);
  assert.deepEqual(await owner(copyRoute, 'POST', destination, 201), copied);
  assert.equal(copied.name, folder.name);
  assert.notEqual(copied.publicId, folder.publicId);
  assert.deepEqual(copied.coordinates, destination.coordinates);
  assert.deepEqual(copied.size, folder.size);
  const board = `/projects/${other.id}`;
  assert.deepEqual(
    (await owner(board + '/cards?folder=root')).map(({ id }) => id),
    [copied.id],
  );
  const subfolder = (await owner(board + '/folders')).find(({ folder }) => folder === copied.id);
  const [copiedNote] = await owner(board + '/cards?folder=' + subfolder.id);
  assert.notEqual(copiedNote.publicId, note.publicId);
  assert.equal(copiedNote.name, note.name);
  assert.notEqual(copiedNote.content[0].fields[0].id, note.content[0].fields[0].id);
  assert.deepEqual(copiedNote.content[0].fields[0].value, ['Сверить решения']);
  const [copiedLabel] = await owner(board + '/marks?folder=' + subfolder.id);
  assert.equal(copiedLabel.text, 'Проверка разметки');
  assert.equal(copiedLabel.scale, 2);
  const copiedLinks = (await owner('/links')).filter(
    ({ sourceProject }) => sourceProject === other.id,
  );
  assert.equal(copiedLinks.length, 2);
  assert.equal(copiedLinks.find(({ label }) => label === 'Решение').source, subfolder.id);
});

test('moving a selection preserves its layout and rejects splitting a connected group', async () => {
  const owner = client();
  const outsider = client();
  for (const signIn of [owner, outsider]) {
    await signIn('/session');
    await signIn('/auth/register', 'POST', {
      email: `group-move-${randomUUID()}@example.test`,
      password: 'Synthetic-password-2026',
    });
  }
  const project = await owner('/projects', 'POST', { name: 'Группы на полотне' }, 201);
  const board = `/projects/${project.id}`;
  const capture = (name, kind, x, y) =>
    owner('/capture', 'POST', { project: project.id, name, kind, coordinates: { x, y } }, 201);
  const a = await capture('Исходная', 'record', 30, 80);
  const b = await capture('Средняя', 'record', 300, 160);
  const c = await capture('Конечная', 'record', 600, 280);
  const folder = await capture('Папка', 'folder', 900, 20);
  const label = await owner(
    board + '/marks',
    'POST',
    {
      kind: 'label',
      at: { x: 180, y: 50 },
      text: 'Разметка',
    },
    201,
  );
  await owner('/links', 'PUT', { source: a.id, target: b.id });
  await owner('/links', 'PUT', { source: b.id, target: c.id });
  const original = await owner(board + '/cards?folder=root');
  const selected = original
    .filter(({ kind }) => kind === 'record')
    .map(({ id, version }) => ({ id, version }));
  const move = {
    folder: null,
    destination: folder.id,
    cards: selected,
    marks: [label.id],
    requestId: randomUUID(),
  };
  await owner(board + '/move-selection', 'POST', { ...move, cards: selected.slice(0, 2) }, 409);
  await owner(
    `/cards/${a.id}/move`,
    'POST',
    { project: project.id, folder: folder.id, version: a.version },
    409,
  );
  await outsider(board + '/move-selection', 'POST', move, 404);
  assert.deepEqual(await owner(board + '/cards?folder=root'), original);
  assert.deepEqual(await owner(board + '/marks?folder=root'), [label]);
  const moved = await owner(board + '/move-selection', 'POST', move);
  assert.deepEqual(await owner(board + '/move-selection', 'POST', move), moved);
  assert.deepEqual(
    (await owner(board + '/cards?folder=root')).map(({ id }) => id),
    [folder.id],
  );
  assert.deepEqual(await owner(board + '/marks?folder=root'), []);
  assert.deepEqual(await owner(board + `/marks?folder=${folder.id}`), moved.marks);
  const [first, second, third] = moved.cards.map(({ coordinates }) => coordinates);
  assert.deepEqual({ x: second.x - first.x, y: second.y - first.y }, { x: 270, y: 80 });
  assert.deepEqual({ x: third.x - first.x, y: third.y - first.y }, { x: 570, y: 200 });
  assert.deepEqual(
    { x: moved.marks[0].at.x - first.x, y: moved.marks[0].at.y - first.y },
    { x: 150, y: -30 },
  );
  assert.deepEqual(
    (await owner('/links')).map(({ source, target }) => [source, target]),
    [
      [a.id, b.id],
      [b.id, c.id],
    ],
  );
  const offset = { x: 44, y: -25 };
  const shifted = await owner(board + '/move-selection', 'POST', {
    folder: folder.id,
    offset,
    cards: moved.cards.map(({ id, version }) => ({ id, version })),
    marks: [label.id],
    requestId: randomUUID(),
  });
  assert.deepEqual(shifted.cards[0].coordinates, { x: first.x + offset.x, y: first.y + offset.y });
});

test('visual documents preserve archived fields and board marks persist independently by folder', async () => {
  const owner = client();
  const outsider = client();
  for (const signIn of [owner, outsider]) {
    await signIn('/session');
    await signIn('/auth/register', 'POST', {
      email: `board-${randomUUID()}@example.test`,
      password: 'Synthetic-password-2026',
    });
  }
  const project = await owner('/projects', 'POST', { name: 'Доска проверки' }, 201);
  const board = `/projects/${project.id}`;
  const card = await owner(
    '/capture',
    'POST',
    {
      project: project.id,
      name: 'Запись с архивом',
      text: 'Архивный маркер',
    },
    201,
  );
  const folder = await owner(
    '/capture',
    'POST',
    {
      project: project.id,
      kind: 'folder',
    },
    201,
  );
  const route = `/cards/${card.id}`;
  const name = 'Визуальный маркер';
  const document = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: name, marks: [{ type: 'bold' }] }] },
      {
        type: 'memoMedia',
        attrs: { kind: 'image', src: 'https://example.test/memo.png', title: 'Фото' },
      },
    ],
  };
  const edited = await owner(route, 'PUT', { ...card, document });
  assert.deepEqual(edited.document, document);
  assert.deepEqual(edited.content, card.content);
  assert.deepEqual(
    (await owner('/search?q=' + encodeURIComponent(name))).cards.map((item) => item.id),
    [card.id],
  );
  assert.deepEqual((await owner('/search?q=' + encodeURIComponent('Архивный маркер'))).cards, []);
  const invalid = structuredClone(document);
  invalid.content[1].attrs.src = 'javascript:alert(1)';
  await owner(route, 'PUT', { ...edited, document: invalid }, 422);
  const size = { width: 480, height: 256 };
  await owner(route + '/position', 'PATCH', { ...edited, size: { ...size, width: 1 } }, 422);
  const resized = await owner(route + '/position', 'PATCH', { ...edited, size });
  assert.deepEqual(resized.size, size);
  assert.deepEqual(resized.document, document);
  const at = { x: 40, y: 80 };
  const end = { x: 40, y: 600 };
  const proposal = { kind: 'label', at, text: 'Хорошо', requestId: randomUUID() };
  const label = await owner(board + '/marks', 'POST', proposal, 201);
  assert.deepEqual(await owner(board + '/marks', 'POST', proposal, 201), label);
  const line = await owner(
    board + '/marks',
    'POST',
    { kind: 'line', at, end, folder: folder.id },
    201,
  );
  await outsider(board + '/marks', 'GET', undefined, 404);
  await outsider(`/marks/${line.id}`, 'PATCH', { at }, 404);
  const labelAt = { x: -44, y: 98 };
  const newEnd = { x: 100, y: 620 };
  const updatedLabel = await owner(`/marks/${label.id}`, 'PATCH', {
    at: labelAt,
    text: 'Отлично',
    scale: 1.65,
  });
  const updatedLine = await owner(`/marks/${line.id}`, 'PATCH', { end: newEnd });
  await owner(`/marks/${line.id}`, 'PATCH', { end: at }, 422);
  await owner(`/marks/${line.id}`, 'PATCH', { text: 'Подпись линии' }, 422);
  assert.deepEqual(updatedLabel, { ...label, at: labelAt, text: 'Отлично', scale: 1.65 });
  assert.deepEqual(updatedLine, { ...line, end: newEnd });
  assert.deepEqual(await owner(board + '/marks'), [updatedLabel]);
  assert.deepEqual(await owner(board + `/marks?folder=${folder.id}`), [updatedLine]);
  const exported = await owner(board + '/export');
  assert.deepEqual(exported.marks, [
    { ...updatedLabel, folder: null },
    { ...updatedLine, folder: folder.id },
  ]);
  assert.deepEqual(exported.cards.find((item) => item.id === card.id).document, document);
  const sections = {
    type: 'doc',
    content: [
      {
        type: 'memoSection',
        attrs: { id: 'intro', title: 'Новый заголовок' },
        content: document.content,
      },
      { type: 'memoSection', attrs: { id: 'next', title: '' }, content: [{ type: 'paragraph' }] },
    ],
  };
  const withSections = await owner(route, 'PUT', { ...resized, document: sections });
  assert.deepEqual(withSections.document, sections);
  assert.deepEqual(
    (await owner('/search?q=' + encodeURIComponent('Новый заголовок'))).cards.map(
      (item) => item.id,
    ),
    [card.id],
  );
  const duplicate = structuredClone(sections);
  duplicate.content[1].attrs.id = 'intro';
  await owner(route, 'PUT', { ...withSections, document: duplicate }, 422);
  await owner(`/marks/${line.id}`, 'DELETE');
  assert.deepEqual(await owner(board + `/marks?folder=${folder.id}`), []);
  const rectangle = await owner(
    board + '/marks',
    'POST',
    { kind: 'square', at, end: newEnd, folder: folder.id, text: 'Скопированная фигура' },
    201,
  );
  assert.deepEqual(rectangle.end, newEnd);
  assert.equal(rectangle.text, 'Скопированная фигура');
  await owner(`/marks/${rectangle.id}`, 'PATCH', { end }, 422);
  await owner(`/marks/${rectangle.id}`, 'DELETE');
  for (const kind of ['square', 'circle']) {
    await owner(board + '/marks', 'POST', { kind, at, end: kind === 'circle' ? newEnd : end }, 422);
    const figure = await owner(
      board + '/marks',
      'POST',
      { kind, at, end: { x: 120, y: 160 }, folder: folder.id },
      201,
    );
    const figureRoute = `/marks/${figure.id}`;
    const corner = { x: -80, y: kind === 'circle' ? -40 : -60 };
    await owner(figureRoute, 'PATCH', { end }, 422);
    await outsider(figureRoute, 'PATCH', { text: 'Чужая фигура' }, 404);
    const named = await owner(figureRoute, 'PATCH', { text: '  Область задач  ' });
    assert.deepEqual(named, { ...figure, text: 'Область задач' });
    await owner(figureRoute, 'PATCH', { text: 'x'.repeat(129) }, 422);
    const movedFigure = { ...named, at: corner };
    assert.deepEqual(await owner(figureRoute, 'PATCH', { at: corner }), movedFigure);
    assert.deepEqual(await owner(board + `/marks?folder=${folder.id}`), [movedFigure]);
    assert.ok(
      (await owner(board + '/export')).marks.some(
        (mark) => mark.id === figure.id && mark.text === named.text,
      ),
    );
    assert.deepEqual(await owner(figureRoute, 'PATCH', { text: '' }), { ...figure, at: corner });
    await owner(figureRoute, 'DELETE');
  }
  await owner(
    '/capture',
    'POST',
    { project: project.id, folder: folder.id, name: 'Внутри папки' },
    201,
  );
  const group = { cards: [card.id], marks: [label.id], requestId: randomUUID() };
  await owner(board + '/trash-selection', 'POST', { ...group, cards: [card.id, folder.id] }, 409);
  await owner(route);
  assert.deepEqual(await owner(board + '/marks'), [updatedLabel]);
  await owner(board + '/trash-selection', 'POST', group);
  await owner(board + '/trash-selection', 'POST', group);
  await owner(route, 'GET', undefined, 404);
  assert.deepEqual(await owner(board + '/marks'), []);
});

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

test('Memo graphs preserve multiple parents, reject cycles and isolate cross-project links', async () => {
  const a = client();
  const b = client();
  for (const request of [a, b]) {
    await request('/session');
    await request('/auth/register', 'POST', {
      email: `graph-${randomUUID()}@example.test`,
      password: 'Synthetic-password-2026',
    });
  }
  const project = await a('/projects', 'POST', { name: 'Семья', template: 'family' }, 201);
  const cards = await a(`/projects/${project.id}/cards`);
  assert.equal(cards.length, 3);
  const [p1, p2, child] = cards;
  let links = await a('/links');
  assert.equal(links.filter((link) => link.target === child.id).length, 2);
  const relation = { source: p1.id, target: child.id, label: 'Родитель' };
  const beforeLink = await a(`/cards/${child.id}`);
  await a('/links', 'PUT', relation);
  await a(`/cards/${child.id}`, 'PUT', beforeLink, 409);
  await a('/links', 'PUT', relation);
  assert.equal((await a('/links')).length, 2, 'retry must not duplicate an edge');
  await a('/links', 'PUT', { source: child.id, target: p1.id }, 422);
  await a('/links', 'PUT', { source: p1.id, target: p1.id }, 422);
  await a('/links', 'PUT', {
    source: p1.id,
    target: p2.id,
    label: 'Родство',
  });
  const other = await a('/projects', 'POST', { name: 'Конспект', template: 'outline' }, 201);
  const otherCards = await a(`/projects/${other.id}/cards`);
  await a('/links', 'PUT', {
    source: child.id,
    target: otherCards[0].id,
    label: 'Продолжение',
  });
  const foreignProject = await b('/projects', 'POST', { name: 'Чужое' }, 201);
  const foreign = await b(
    `/projects/${foreignProject.id}/cards`,
    'POST',
    { name: 'Чужая запись' },
    201,
  );
  await a('/links', 'PUT', { source: p1.id, target: foreign.id }, 404);
  await b('/links', 'DELETE', relation, 404);
  assert.deepEqual(await b('/links'), []);
  await b(`/cards/${p1.id}`, 'GET', undefined, 404);
  await b(`/projects/${project.id}/export`, 'GET', undefined, 404);
  await a(`/cards/${child.id}`, 'DELETE');
  await b(`/cards/${child.id}?includeDeleted=1`, 'GET', undefined, 404);
  assert.equal((await a(`/cards/${child.id}?includeDeleted=1`)).id, child.id);
  links = await a('/links');
  assert.ok(links.every((link) => link.source !== child.id && link.target !== child.id));
  await a(
    '/links',
    'PUT',
    { source: otherCards[0].id, target: p1.id },
    422,
    'cycle through trash is still a cycle',
  );
  await b(`/cards/${child.id}/restore`, 'POST', {}, 404);
  await a(`/cards/${child.id}/restore`, 'POST', {});
  assert.equal((await a('/links')).filter((link) => link.target === child.id).length, 2);
  await a('/links', 'DELETE', relation);
  assert.equal((await a(`/cards/${child.id}`)).parent, p2.id);
  await a('/links', 'DELETE', relation);
  const stale = await a(`/cards/${child.id}`);
  const moved = await a(`/cards/${child.id}/move`, 'POST', {
    project: other.id,
    version: stale.version,
  });
  assert.equal(moved.project, other.id);
  const descendant = await a(
    '/capture',
    'POST',
    {
      requestId: randomUUID(),
      project: other.id,
      parent: child.id,
      name: 'После переноса',
      text: 'Потомок карточки с межпроектными предками',
    },
    201,
  );
  assert.ok(
    (await a('/links')).some((link) => link.source === child.id && link.target === descendant.id),
  );
  await a(
    `/projects/${other.id}/cards`,
    'POST',
    { name: 'Совместимый потомок', parent: child.id },
    201,
  );
  await a(`/cards/${child.id}/move`, 'POST', { project: project.id, version: stale.version }, 409);
  assert.ok((await a('/links')).some((link) => link.source === p2.id && link.target === child.id));
  await a(`/projects/${project.id}`, 'DELETE');
  await a(`/cards/${p1.id}`, 'GET', undefined, 404);
  await a('/links', 'PUT', { source: p1.id, target: child.id }, 404);
  await b(`/projects/${project.id}/restore`, 'POST', {}, 404);
  await a(`/projects/${project.id}/restore`, 'POST', {});
  assert.ok((await a('/links')).some((link) => link.source === p2.id && link.target === child.id));
});

test('link rewiring is atomic, preserves labels and deduplicates a lost response', async () => {
  const a = client();
  const b = client();
  for (const request of [a, b]) {
    await request('/session');
    await request('/auth/register', 'POST', {
      email: `rewire-${randomUUID()}@example.test`,
      password: 'Synthetic-password-2026',
    });
  }
  const project = await a('/projects', 'POST', { name: 'Переназначение связей' }, 201);
  const other = await a('/projects', 'POST', { name: 'Другой собственный проект' }, 201);
  const cards = [];
  for (const name of ['Источник', 'Прежняя цель', 'Новая цель', 'Потомок', 'Предок', 'В корзине']) {
    cards.push(await a(`/projects/${project.id}/cards`, 'POST', { name }, 201));
  }
  const [source, target, nextTarget, descendant, ancestor, deleted] = cards;
  const nextSource = await a(
    `/projects/${other.id}/cards`,
    'POST',
    { name: 'Новый источник' },
    201,
  );
  const foreignProject = await b('/projects', 'POST', { name: 'Чужие связи' }, 201);
  const foreignSource = await b(
    `/projects/${foreignProject.id}/cards`,
    'POST',
    { name: 'Чужой источник' },
    201,
  );
  const foreignTarget = await b(
    `/projects/${foreignProject.id}/cards`,
    'POST',
    { name: 'Чужая цель' },
    201,
  );
  await b('/links', 'PUT', {
    source: foreignSource.id,
    target: foreignTarget.id,
    label: 'Чужая подпись',
  });
  await a('/links', 'PUT', { source: source.id, target: target.id, label: 'Сохранённая подпись' });
  await a('/links', 'PUT', { source: nextTarget.id, target: descendant.id });
  await a('/links', 'PUT', { source: ancestor.id, target: nextSource.id });
  await a(`/cards/${deleted.id}`, 'DELETE');
  const state = async () => ({
    links: await a('/links'),
    cards: await Promise.all(
      [...cards, nextSource].map((card) => a(`/cards/${card.id}?includeDeleted=1`)),
    ),
    foreign: await b('/links'),
  });
  const targetAttempt = {
    requestId: randomUUID(),
    source: source.id,
    target: target.id,
    newSource: source.id,
    newTarget: nextTarget.id,
  };
  const beforeTarget = await a(`/cards/${target.id}`);
  const rewiredTarget = await a('/links', 'PATCH', targetAttempt);
  assert.equal(rewiredTarget.label, 'Сохранённая подпись');
  assert.equal(rewiredTarget.source, source.id);
  assert.equal(rewiredTarget.target, nextTarget.id);
  const targetState = await state();
  assert.equal((await a(`/cards/${target.id}`)).parent, null);
  assert.equal((await a(`/cards/${nextTarget.id}`)).parent, source.id);
  await a(`/cards/${target.id}`, 'PUT', beforeTarget, 409);
  assert.deepEqual(await a('/links', 'PATCH', targetAttempt), rewiredTarget);
  assert.deepEqual(await state(), targetState, 'retry must not alter card versions or graph');
  await a('/links', 'PATCH', { ...targetAttempt, newTarget: descendant.id }, 409);

  const sourceAttempt = {
    requestId: randomUUID(),
    source: source.id,
    target: nextTarget.id,
    newSource: nextSource.id,
    newTarget: nextTarget.id,
  };
  const rewiredSource = await a('/links', 'PATCH', sourceAttempt);
  assert.equal(rewiredSource.label, 'Сохранённая подпись');
  assert.equal(rewiredSource.sourceProject, other.id);
  assert.equal(rewiredSource.targetProject, project.id);
  assert.equal((await a(`/cards/${nextTarget.id}`)).parent, nextSource.id);
  const sourceState = await state();
  assert.deepEqual(await a('/links', 'PATCH', sourceAttempt), rewiredSource);
  assert.deepEqual(await a('/links', 'PATCH', targetAttempt), rewiredTarget);
  assert.deepEqual(await state(), sourceState, 'an older receipt must not move the edge back');

  const current = { source: nextSource.id, target: nextTarget.id };
  const valid = { ...current, newSource: nextSource.id, newTarget: nextTarget.id };
  await a('/links', 'PUT', { source: source.id, target: nextTarget.id, label: 'Другая подпись' });
  const duplicate = { ...valid, requestId: randomUUID(), newSource: source.id };
  const failures = [
    [{ ...valid }, 422],
    [{ ...valid, requestId: 'short' }, 422],
    [{ ...valid, requestId: randomUUID(), newTarget: nextSource.id }, 422],
    [{ ...valid, requestId: randomUUID(), newSource: descendant.id }, 422],
    [{ ...valid, requestId: randomUUID(), newTarget: ancestor.id }, 422],
    [{ ...valid, requestId: randomUUID(), newSource: foreignSource.id }, 404],
    [{ ...valid, requestId: randomUUID(), newTarget: foreignTarget.id }, 404],
    [{ ...valid, requestId: randomUUID(), newTarget: deleted.id }, 404],
    [{ ...valid, requestId: randomUUID(), source: source.id, target: target.id }, 404],
    [
      { ...valid, requestId: randomUUID(), source: foreignSource.id, target: foreignTarget.id },
      404,
    ],
    [duplicate, 409],
  ];
  for (const [body, status] of failures) {
    const before = await state();
    await a('/links', 'PATCH', body, status);
    assert.deepEqual(
      await state(),
      before,
      `failed HTTP ${status} must retain both pairs and cards`,
    );
  }
  await a('/links', 'DELETE', { source: source.id, target: nextTarget.id });
  const afterConflict = await a('/links', 'PATCH', duplicate);
  assert.equal(
    afterConflict.label,
    'Сохранённая подпись',
    'a failed conflict must not leave a receipt',
  );
  assert.equal(afterConflict.source, source.id);
  const reversed = await a('/links', 'PATCH', {
    requestId: randomUUID(),
    source: source.id,
    target: nextTarget.id,
    newSource: nextTarget.id,
    newTarget: source.id,
  });
  assert.equal(reversed.label, 'Сохранённая подпись');
  assert.equal(reversed.source, nextTarget.id);
  assert.equal(reversed.target, source.id, 'cycle validation must remove the old pair first');
});

test('capture and autosave deduplicate a lost response, retain trash, search content and export media', async () => {
  const a = client();
  await a('/session');
  await a('/auth/register', 'POST', {
    email: `capture-${randomUUID()}@example.test`,
    password: 'Synthetic-password-2026',
  });
  const capture = {
    requestId: randomUUID(),
    text: 'Очень важная мысль\nСинтетический уникальный фрагмент 100%_!',
  };
  const first = await a('/capture', 'POST', capture, 201);
  assert.deepEqual(await a('/capture', 'POST', capture, 201), first);
  await a('/capture', 'POST', { ...capture, text: 'Другое содержимое' }, 409);
  const second = await a('/capture', 'POST', { requestId: randomUUID(), text: 'Ещё мысль' }, 201);
  assert.equal(second.project, first.project, 'all captures use one inbox');
  const inbox = (await a('/projects')).find((item) => item.inbox);
  assert.equal(inbox.cards, 2);
  await a(`/projects/${inbox.id}`, 'DELETE', undefined, 422);
  let search = await a(`/search?q=${encodeURIComponent('100%_!')}`);
  assert.deepEqual(
    search.cards.map((item) => item.id),
    [first.id],
  );
  assert.equal(search.hasMore, false);
  const attempt = {
    ...first,
    requestId: randomUUID(),
    content: [
      {
        id: -1,
        name: 'Новая группа',
        fields: [{ id: -1, type: 'textarea', value: ['Результат автосохранения'] }],
      },
    ],
  };
  const { publicId, ...legacyAttempt } = attempt;
  const saved = await a(`/cards/${first.id}`, 'PUT', legacyAttempt);
  assert.equal(saved.publicId, publicId);
  assert.deepEqual(await a(`/cards/${publicId}`, 'PUT', attempt), saved);
  await a(`/cards/${first.id}`, 'PUT', { ...attempt, name: 'Другой запрос' }, 409);
  await a(`/cards/${first.id}`, 'PUT', { ...first, requestId: randomUUID() }, 409);
  const invalid = {
    ...saved,
    requestId: randomUUID(),
    name: 'Откат транзакции',
    content: [{ id: -1, fields: [{ id: -1, type: 'date', value: ['не дата'] }] }],
  };
  await a(`/cards/${first.id}`, 'PUT', invalid, 422);
  assert.equal((await a(`/cards/${first.id}`)).name, saved.name);
  const retried = await a(`/cards/${first.id}`, 'PUT', { ...invalid, content: saved.content });
  await a(`/cards/${first.id}`, 'PUT', attempt, 409);
  assert.equal(retried.name, 'Откат транзакции', 'rolled back operations must not leave a receipt');
  await a(`/cards/${first.id}/metadata`, 'POST', { pinned: true });
  assert.equal((await a('/search?filter=pinned')).cards[0].id, first.id);
  await a(`/cards/${first.id}/visit`, 'POST', {});
  assert.equal((await a('/search?filter=recent')).cards[0].id, first.id);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const media = await a('/media', 'POST', form, 201);
  const current = await a(`/cards/${first.id}`);
  await a(`/cards/${first.id}`, 'PUT', {
    ...current,
    content: [
      ...current.content,
      { id: -1, name: 'Медиа', fields: [{ id: -1, type: 'image', value: [media.url] }] },
    ],
  });
  const exported = await a(`/projects/${inbox.id}/export`);
  assert.equal(exported.format, 'memo-project');
  assert.equal(exported.version, 1);
  assert.equal(exported.cards.length, 2);
  assert.deepEqual(Buffer.from(exported.media[0].base64, 'base64'), png);
  await a(`/cards/${first.id}`, 'DELETE');
  assert.equal((await a('/search?filter=pinned')).cards.length, 0);
  assert.equal((await a('/trash')).cards[0].id, first.id);
  assert.equal((await a(`/projects/${inbox.id}/export`)).cards.length, 1);
  await a(`/cards/${first.id}/restore`, 'POST', {});
  const restored = await a(`/cards/${first.id}`);
  assert.equal(restored.pinned, true);
  assert.equal(restored.content.length, 2);
  const retro = await a('/projects', 'POST', { name: 'Ретро', template: 'retro' }, 201);
  const retroCards = await a(`/projects/${retro.id}/cards`);
  const frames = await a(`/projects/${retro.id}/marks`);
  assert.deepEqual(
    frames.map(({ kind, text }) => [kind, text]),
    [
      ['square', 'Ретро'],
      ['square', 'Плохо'],
      ['square', 'Хорошо'],
      ['square', 'Что будем делать?'],
    ],
  );
  const [frame, left, right, actions] = frames;
  const contains = (outer, at, end) =>
    at.x >= outer.at.x && at.y >= outer.at.y && end.x <= outer.end.x && end.y <= outer.end.y;
  assert.ok([left, right, actions].every((section) => contains(frame, section.at, section.end)));
  assert.equal(left.at.y, right.at.y);
  assert.ok(left.end.x < right.at.x && actions.at.y > Math.max(left.end.y, right.end.y));
  assert.equal(actions.at.x, left.at.x);
  assert.equal(actions.end.x, right.end.x);
  assert.equal(retroCards.length, 4);
  for (const [section, expected] of [
    [left, 1],
    [right, 2],
    [actions, 1],
  ]) {
    assert.equal(
      retroCards.filter(({ coordinates, size }) =>
        contains(section, coordinates, {
          x: coordinates.x + size.width,
          y: coordinates.y + size.height,
        }),
      ).length,
      expected,
    );
  }
  const tasks = await a('/projects', 'POST', { name: 'Задачи', template: 'tasks' }, 201);
  assert.equal((await a(`/projects/${tasks.id}/cards`)).length, 3);
  const taskMarks = await a(`/projects/${tasks.id}/marks`);
  assert.deepEqual(
    taskMarks.filter((mark) => mark.kind === 'label').map((mark) => mark.text),
    ['Сделать', 'В работе', 'Готово'],
  );
  assert.equal(
    taskMarks.filter((mark) => mark.kind === 'line' && mark.at.x === mark.end.x).length,
    2,
  );
  await a('/projects', 'POST', { name: 'Некорректно', template: 'missing' }, 422);
  const layout = await a('/projects', 'POST', { name: 'Расстояния между записями' }, 201);
  const captureNext = () =>
    a('/capture', 'POST', { project: layout.id, requestId: randomUUID(), text: 'Запись' }, 201);
  const firstInLayout = await captureNext();
  const secondInLayout = await captureNext();
  await captureNext();
  const nextRow = await captureNext();
  assert.equal(
    secondInLayout.coordinates.x - firstInLayout.coordinates.x - firstInLayout.size.width,
    198,
  );
  assert.equal(nextRow.coordinates.x, firstInLayout.coordinates.x);
  assert.equal(
    nextRow.coordinates.y - firstInLayout.coordinates.y - firstInLayout.size.height,
    315,
  );
  await a(
    '/capture',
    'POST',
    { requestId: randomUUID(), text: 'У границы', coordinates: { x: 99920, y: 80 } },
    201,
  );
  const afterBoundary = await a(
    '/capture',
    'POST',
    { requestId: randomUUID(), text: 'Свободная позиция' },
    201,
  );
  assert.ok(
    Math.abs(afterBoundary.coordinates.x) <= 100000 &&
      Math.abs(afterBoundary.coordinates.y) <= 100000,
  );
});
