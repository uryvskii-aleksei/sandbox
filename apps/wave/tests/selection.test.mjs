import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pickClip } from '../site/selection.mjs';

const seed = { id: 'seed', artist: 'A', tags: ['dance', 'funk'] };
const similar = { id: 'similar', artist: 'A', tags: ['dance', 'pop'] };
const unrelated = { id: 'unrelated', artist: 'B', tags: ['folk', 'slow'] };
const catalog = [seed, similar, unrelated];

test('в случайной выдаче лайк повышает вес похожего клипа, а дизлайк понижает', () => {
  const pick = (rating, draw) =>
    pickClip(catalog, { seed: rating }, ['seed'], new Set(), () => draw);
  assert.equal(pick(0, 0.55), unrelated);
  assert.equal(pick(1, 0.55), similar);
  assert.equal(pick(0, 0.4), similar);
  assert.equal(pick(-1, 0.4), unrelated);
  assert.equal(pick(-1, 0.05), similar);
});

test('плеер пропускает недоступные клипы и избегает повторов, пока есть выбор', () => {
  assert.equal(
    pickClip(catalog, {}, ['seed', 'similar'], new Set(), () => 0),
    unrelated,
  );
  assert.equal(
    pickClip(catalog, {}, ['seed', 'similar'], new Set(['unrelated']), () => 0),
    seed,
  );
  assert.equal(pickClip(catalog, {}, ['seed'], new Set(catalog.map(({ id }) => id))), null);
});

test('у стартового каталога уникальные ID, теги и атрибуция', () => {
  const clips = JSON.parse(readFileSync(new URL('../site/catalog.json', import.meta.url), 'utf8'));
  assert.equal(new Set(clips.map(({ id }) => id)).size, clips.length);
  assert.ok(
    clips.every(
      ({ id, artist, title, tags, credit, source, video }) =>
        /^[a-z0-9-]{1,64}$/.test(id) &&
        artist &&
        title &&
        tags.length &&
        credit &&
        new URL(source).hostname === 'commons.wikimedia.org' &&
        new URL(video).hostname === 'upload.wikimedia.org',
    ),
  );
});
