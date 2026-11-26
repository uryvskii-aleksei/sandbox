import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkPort, routeBoardLinks, routeConnection } from '../frontend/src/connectionRoutes.ts';
import { parseRoute, routeUrl } from '../frontend/src/routes.ts';
import {
  branchIds,
  canConnect,
  contentSignature,
  copiedContent,
  reconcileSaved,
} from '../frontend/src/graph.ts';

const edge = (source, target) => ({
  source,
  target,
  label: '',
  sourceName: 'A',
  targetName: 'B',
  sourceProject: 1,
  targetProject: 1,
});
const card = (content) => ({
  id: 1,
  project: 1,
  name: 'Заметка',
  parent: null,
  coordinates: { x: 0, y: 0 },
  version: 1,
  content,
});
const group = (id, field, value) => ({
  id,
  name: 'Материалы',
  order: 0,
  collapsed: false,
  fields: [{ id: field, type: 'textarea', title: '', order: 0, value: [value] }],
});

test('workspace routes round-trip opaque IDs and still resolve numeric bookmarks', () => {
  const base = '/memo/';
  const project = `m${'a'.repeat(32)}`;
  const folder = `m${'0'.repeat(32)}`;
  const current = { view: 'project', project, folder };
  assert.equal(routeUrl(base, current), `${base}workspace/${project}/folder/${folder}`);
  assert.deepEqual(parseRoute(routeUrl(base, current), base), current);
  assert.deepEqual(parseRoute(`${base}workplace/123/folder/456/`, base), {
    view: 'project',
    project: 123,
    folder: 456,
  });
  assert.deepEqual(parseRoute(`${base}workspace/${project}/folder/456`, base), {
    view: 'project',
    project,
    folder: 456,
  });
  assert.deepEqual(parseRoute(`${base}workspace/${project}/folder/invalid`, base), {
    view: 'dashboard',
  });
});

const block = (id, x, y, width, height) => ({ id, x, y, width, height });
const routeClears = ({ samples }, blocks) => {
  for (const [index, start] of samples.slice(0, -1).entries()) {
    const end = samples[index + 1];
    for (let step = 0; step <= 24; step++) {
      const x = start.x + ((end.x - start.x) * step) / 24;
      const y = start.y + ((end.y - start.y) * step) / 24;
      assert.ok(
        !blocks.some((r) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height),
        `route ran through a block at ${x},${y}`,
      );
    }
  }
};

const routesDoNotCross = (routes) => {
  const area = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const [index, route] of routes.entries()) {
    for (const other of routes.slice(index + 1)) {
      assert.ok(
        !route.segments.some(({ from: a, to: b }) =>
          other.segments.some(
            ({ from: c, to: d }) =>
              area(a, b, c) * area(a, b, d) < 0 && area(c, d, a) * area(c, d, b) < 0,
          ),
        ),
      );
    }
  }
};

test('clear diagonal connections keep a single smooth bend between their ports', () => {
  const source = block(1, 0, 0, 240, 190);
  for (const y of [245, 640]) {
    const target = block(2, 400, y, 240, 190);
    const blocks = [source, target];
    const route = routeConnection(linkPort(source, true), linkPort(target, false), blocks);
    assert.deepEqual(route.d.match(/[MCL]/g), ['M', 'C']);
    assert.ok(
      route.samples.every(
        (point, index, samples) => index === 0 || point.y >= samples[index - 1].y,
      ),
    );
    routeClears(route, blocks);
  }
});

test('three nearby targets in a row receive smooth outgoing curves with no crossovers', () => {
  const blocks = [
    block(1, 0, 0, 240, 190),
    block(2, 0, 280, 240, 190),
    block(3, 280, 280, 240, 190),
    block(4, 560, 280, 240, 190),
  ];
  const routes = routeBoardLinks([edge(1, 2), edge(1, 3), edge(1, 4)], blocks);
  assert.equal(routes.length, 3);
  for (const route of routes) {
    assert.deepEqual(route.d.match(/[MCL]/g), ['M', 'C']);
    routeClears(route, blocks);
  }
  routesDoNotCross(routes);
});

test('overlapping endpoints meet across the exposed corner with a short curve in either direction', () => {
  const blocks = [block(1, 0, 0, 240, 190), block(2, 128.242, 91.3438, 240, 190)];
  for (const link of [edge(1, 2), edge(2, 1)]) {
    const [route] = routeBoardLinks([link], blocks);
    assert.deepEqual(route.d.match(/[MCL]/g), ['M', 'C']);
    const length = route.segments.reduce(
      (total, { from, to }) => total + Math.hypot(to.x - from.x, to.y - from.y),
      0,
    );
    assert.ok(length < 65, `curve wrapped around the overlapping card: ${length}`);
    routeClears(route, blocks);
  }
});

test('connections curve around stacked obstacles and adapt when a block is moved', () => {
  const source = block(1, 0, 0, 240, 120);
  const target = block(2, 180, 770, 240, 120);
  const upper = block(3, 50, 175, 360, 230);
  const lower = block(4, -50, 385, 350, 280);
  const route = (obstacles) =>
    routeConnection(linkPort(source, true), linkPort(target, false), obstacles);
  const obstacles = [source, target, upper, lower];
  const detour = route(obstacles);
  assert.match(detour.d, /C/);
  routeClears(detour, obstacles);
  const moved = [source, target, { ...upper, x: 700 }, lower];
  const next = route(moved);
  assert.notEqual(next.d, detour.d);
  routeClears(next, moved);
});

test('an upward connection turns into the top port over a longer approach', () => {
  const source = block(1, 0, 521.016, 240, 190);
  const target = block(2, 474.406, 0, 240, 190);
  const route = (blocks) =>
    routeConnection(linkPort(source, true), linkPort(target, false), blocks);
  const open = route([source, target]);
  let approach = 0;
  for (const { from, to } of open.segments.toReversed()) {
    const dx = Math.abs(to.x - from.x);
    const dy = to.y - from.y;
    if (dy <= 0 || dx > dy) break;
    approach += Math.hypot(dx, dy);
  }
  assert.ok(approach > 38, `the turn is compressed against the target port: ${approach}`);
  routeClears(open, [source, target]);

  const tight = [source, target, block(3, 480, -221, 240, 190)];
  routeClears(route(tight), tight);
});

test('a second connection uses the opposite side of an occupied corridor', () => {
  const middle = block(5, -60, 180, 480, 190);
  const blocks = [
    block(1, 0, 0, 96, 80),
    block(2, 100, 0, 96, 80),
    block(3, 0, 500, 96, 80),
    block(4, 100, 500, 96, 80),
    middle,
  ];
  const [single] = routeBoardLinks([edge(2, 4)], blocks);
  assert.ok(single.center.x < middle.x);
  const [first, second] = routeBoardLinks([edge(1, 3), edge(2, 4)], blocks);
  assert.ok(first.center.x < middle.x);
  assert.ok(second.center.x > middle.x + middle.width);
  routeClears(first, blocks);
  routeClears(second, blocks);
});

test('outgoing connections do not cross when the far target needs the lower corridor', () => {
  const blocks = [
    block(1, 0, 0, 240, 190),
    block(2, 520, 178, 240, 190),
    block(3, 840, 178, 240, 190),
    block(4, 200, 458, 240, 190),
  ];
  const routes = routeBoardLinks([edge(1, 2), edge(1, 3), edge(1, 4)], blocks);
  routes.forEach((route) => routeClears(route, blocks));
  routesDoNotCross(routes);
});

test('multiple parents keep both branches reachable and reject cycles across every parent', () => {
  const links = [edge(1, 3), edge(2, 3), edge(3, 4)];
  assert.equal(canConnect(links, 4, 1), false);
  assert.equal(canConnect(links, 4, 2), false);
  assert.equal(canConnect(links, 2, 1), true);
  assert.equal(canConnect(links, 1, 1), false);
  assert.deepEqual([...branchIds(links, 2)], [2, 3, 4]);
  assert.deepEqual([...branchIds([...links, edge(4, 3)], 3)], [3, 4]);
});

test('saving reconciles assigned IDs without losing typing, reordering or additions during a request', () => {
  const sent = card([group(-1, -2, 'Отправлено'), group(-3, -4, 'Вторая группа')]);
  const saved = {
    ...card([group(10, 20, 'Отправлено'), group(30, 40, 'Вторая группа')]),
    version: 2,
  };
  const current = card([
    group(-3, -4, 'Продолжил ввод'),
    {
      ...group(-1, -2, 'Новый текст'),
      fields: [
        ...group(-1, -2, 'Новый текст').fields,
        { id: -6, type: 'textarea', title: 'Позже', order: 1, value: ['Новый материал'] },
      ],
    },
    group(-7, -8, 'Новая группа'),
  ]);
  const reconciled = reconcileSaved(current, sent, saved);
  assert.equal(reconciled.version, 2);
  assert.deepEqual(
    reconciled.content.map((item) => item.id),
    [30, 10, -7],
  );
  assert.equal(reconciled.content[0].fields[0].value[0], 'Продолжил ввод');
  assert.deepEqual(
    reconciled.content[1].fields.map((item) => item.id),
    [20, -6],
  );
  assert.equal(current.content[0].id, -3, 'utility must not mutate input');
  assert.equal(
    reconcileSaved(card([]), sent, saved).content.length,
    0,
    'removed groups must stay removed',
  );
  assert.notEqual(contentSignature(reconciled), contentSignature(saved));
});

test('copying a conflicting draft resets IDs and preserves original media and values', () => {
  const content = [group(1, 2, 'Текст')];
  const result = copiedContent(content);
  assert.ok(result[0].id < 0);
  assert.ok(result[0].fields[0].id < 0);
  result[0].fields[0].value.push('Ещё');
  assert.deepEqual(content[0].fields[0].value, ['Текст']);
  assert.equal(contentSignature(card(content)), contentSignature(card(copiedContent(content))));
});

test('server trimming settles autosave while newer typing stays intact', () => {
  const sent = { ...card([group(-1, -2, 'Материал')]), name: ' Запись ' };
  sent.content[0].name = ' Материалы ';
  sent.content[0].fields[0].title = ' Источник ';
  const saved = { ...card([group(10, 20, 'Материал')]), name: 'Запись', version: 2 };
  saved.content[0].fields[0].title = 'Источник';
  const normalized = reconcileSaved(structuredClone(sent), sent, saved);
  assert.equal(
    contentSignature(normalized),
    contentSignature(saved),
    'normalization must not trigger an endless save loop',
  );
  const typing = structuredClone(sent);
  typing.name = 'Продолжаю писать ';
  typing.content[0].name = 'Другая группа ';
  typing.content[0].fields[0].title = 'Новый заголовок ';
  const merged = reconcileSaved(typing, sent, saved);
  assert.equal(merged.name, typing.name);
  assert.equal(merged.content[0].name, typing.content[0].name);
  assert.equal(merged.content[0].fields[0].title, typing.content[0].fields[0].title);
});
