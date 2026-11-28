import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPlaybackProgress, playbackSignal, watchedSeconds } from '../site/playback.mjs';
import { pickClip } from '../site/selection.mjs';

const seed = { id: 'seed', artist: 'A', tags: ['dance', 'funk'] };
const similar = { id: 'similar', artist: 'A', tags: ['dance', 'pop'] };
const unrelated = { id: 'unrelated', artist: 'B', tags: ['folk', 'slow'] };
const catalog = [seed, similar, unrelated];

test('в случайной выдаче лайк повышает вес похожего клипа, а дизлайк понижает', () => {
  const pick = (rating, draw) =>
    pickClip(catalog, { seed: rating }, { recent: ['seed'], random: () => draw });
  assert.equal(pick(0, 0.55), unrelated);
  assert.equal(pick(1, 0.55), similar);
  assert.equal(pick(0, 0.4), similar);
  assert.equal(pick(-1, 0.4), unrelated);
  assert.equal(pick(-1, 0.05), similar);
});

test('досмотр повышает частоту похожих клипов, а пропуск понижает без скрытия', () => {
  const pick = (signal, draw, ratings = {}) =>
    pickClip(catalog, ratings, {
      recent: ['seed'],
      playback: { seed: signal },
      random: () => draw,
    });
  assert.equal(pick(0, 0.55), unrelated);
  assert.equal(pick(1, 0.55), similar);
  assert.equal(pick(0, 0.45), similar);
  assert.equal(pick(-1, 0.45), unrelated);
  assert.equal(pick(-1, 0.05), similar);
  assert.equal(pick(-1, 0.7, { seed: 1 }), similar);
  assert.equal(pick(1, 0.3, { seed: -1 }), unrelated);
  assert.equal(pickClip([seed], {}, { playback: { seed: -1 } }), seed);
});

test('учитываются быстрый пропуск и естественное окончание после просмотра', () => {
  assert.equal(playbackSignal('skip', 0, 180), 0);
  assert.equal(playbackSignal('skip', 1, 180), -1);
  assert.equal(playbackSignal('skip', 10, 180), -1);
  assert.equal(playbackSignal('skip', 11, 180), 0);
  assert.equal(playbackSignal('skip', 7, 10), 0);
  assert.equal(playbackSignal('ended', 12, 180), 0);
  assert.equal(playbackSignal('ended', 170, 180), 1);
  assert.equal(playbackSignal('error', 3, 180), 0);
  assert.equal(playbackSignal('ended', 170, Infinity), 0);
});

test('перемотка, пауза и повтор просмотренного отрезка не добавляют лишнее время', () => {
  const ranges = { length: 2, start: (i) => [0, 177][i], end: (i) => [5, 180][i] };
  assert.equal(watchedSeconds(ranges), 8);
  assert.equal(playbackSignal('ended', watchedSeconds(ranges), 180), 0);

  const progress = createPlaybackProgress();
  progress.sample(0, 0);
  progress.sample(1, 1000);
  progress.sample(175, 2000);
  progress.sample(176, 3000);
  progress.interrupt();
  progress.sample(179, 9000);
  progress.sample(180, 10000);
  progress.sample(0, 11000);
  progress.sample(1, 12000);
  assert.equal(progress.watched, 3);
  assert.equal(playbackSignal('ended', progress.watched, 180), 0);
});

test('одна оценка заметно меняет частоту близкого жанра среди сотен клипов', () => {
  const rated = { id: 'rated', artist: 'Исполнитель', tags: ['synthwave', 'electronic'] };
  const station = [
    rated,
    ...Array.from({ length: 12 }, (_, index) => ({
      ...rated,
      id: `close-${index}`,
      artist: `Группа ${index}`,
    })),
    ...Array.from({ length: 200 }, (_, index) => ({
      id: `other-${index}`,
      artist: `Другой исполнитель ${index}`,
      tags: ['pop'],
    })),
  ];
  function countSimilar(rating) {
    let count = 0;
    for (let i = 0; i < 100; i++) {
      const clip = pickClip(
        station,
        { rated: rating },
        { recent: ['rated'], random: () => (i + 0.5) / 100 },
      );
      if (clip.id.startsWith('close-')) count++;
    }
    return count;
  }
  const baseline = countSimilar(0);
  assert.ok(countSimilar(1) > baseline * 4);
  assert.ok(countSimilar(-1) < baseline);
});

test('совместный клип учитывает обоих исполнителей, а дизлайк скрывает другую копию песни', () => {
  const collaboration = {
    id: 'joint',
    artist: 'Алёна feat. Артём',
    title: 'Вечер!',
    tags: ['pop'],
  };
  const copy = {
    ...collaboration,
    id: 'copy',
    artist: 'АРТЁМ × Алёна',
    title: '«Вечер»',
    provider: 'rutube',
  };
  const solo = { id: 'solo', artist: 'Артём', title: 'Дождь', tags: ['pop'] };
  const other = { id: 'other', artist: 'Лида', title: 'Город', tags: ['pop'] };
  const station = [collaboration, copy, solo, other];
  const options = { recent: ['joint'], random: () => 0.55 };
  assert.equal(pickClip(station, {}, options), other);
  assert.equal(pickClip(station, { joint: 1 }, options), solo);
  assert.equal(pickClip(station, { joint: -1 }, { random: () => 0 }), solo);
  assert.equal(pickClip(station, { joint: -1 }, { random: () => 0.3 }), other);
});

test('плеер пропускает недоступные клипы и избегает повторов, пока есть выбор', () => {
  const options = { recent: ['seed', 'similar'], random: () => 0 };
  assert.equal(pickClip(catalog, {}, options), unrelated);
  assert.equal(pickClip(catalog, {}, { ...options, unavailable: new Set(['unrelated']) }), seed);
  assert.equal(pickClip(catalog, {}, { unavailable: new Set(catalog.map(({ id }) => id)) }), null);
});

test('клип с дизлайком пропускается даже после остальных клипов', () => {
  const ratings = { seed: -1, similar: -1 };
  assert.equal(pickClip(catalog, ratings, { recent: ['unrelated'], random: () => 0 }), unrelated);
  assert.equal(pickClip(catalog, { ...ratings, unrelated: -1 }), null);
  assert.equal(
    pickClip(catalog, { ...ratings, seed: 0 }, { recent: ['unrelated'], random: () => 0 }),
    seed,
  );
});

test('недавняя история мешает повторам даже после сильных лайков и новой загрузки', () => {
  const station = Array.from({ length: 24 }, (_, index) => ({ ...seed, id: `clip-${index}` }));
  const recent = [];
  for (let i = 0; i < 19; i++) {
    const savedHistory = JSON.parse(JSON.stringify(recent));
    const clip = pickClip(station, { 'clip-0': 1 }, { recent: savedHistory, random: () => 0 });
    assert.ok(!recent.includes(clip.id));
    recent.push(clip.id);
  }
});

test('у стартового каталога уникальные ID, теги и атрибуция', () => {
  const clips = JSON.parse(readFileSync(new URL('../site/catalog.json', import.meta.url), 'utf8'));
  assert.equal(new Set(clips.map(({ id }) => id)).size, clips.length);
  assert.equal(new Set(clips.map(({ video, embed }) => video ?? embed)).size, clips.length);
  assert.deepEqual(new Set(clips.map(({ provider }) => provider)), new Set([undefined, 'rutube']));
  assert.ok(
    clips.every(
      ({ id, artist, title, tags, credit }) =>
        /^[a-z0-9-]{1,64}$/.test(id) && artist && title && tags.length && credit,
    ),
  );
  for (const clip of clips) {
    const source = new URL(clip.source);
    if (clip.provider === 'rutube') {
      assert.equal(source.origin, 'https://rutube.ru');
      assert.equal(clip.embed, `https://rutube.ru/play/embed/${clip.id.slice(7)}`);
      assert.equal(new URL(clip.poster).origin, 'https://pic.rtbcdn.ru');
    } else {
      assert.equal(source.origin, 'https://commons.wikimedia.org');
      assert.equal(new URL(clip.video).origin, 'https://upload.wikimedia.org');
      assert.equal(new URL(clip.poster).origin, 'https://thumb.wikimedia.org');
      assert.match(new URL(clip.poster).pathname, /\.webm\.jpg$/);
      assert.match(clip.license.name, /^CC BY(?:-SA)? \d\.\d$/);
      assert.equal(new URL(clip.license.url).origin, 'https://creativecommons.org');
    }
  }
});
