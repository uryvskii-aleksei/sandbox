import assert from 'node:assert/strict';
import { test } from 'node:test';
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
