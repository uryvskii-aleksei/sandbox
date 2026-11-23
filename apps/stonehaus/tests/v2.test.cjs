'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '../site/v2/index.html'), 'utf8');
const v1 = fs.readFileSync(path.join(__dirname, '../site/v1/index.html'), 'utf8');

test('v2 keeps the concept boundary and the published facts', () => {
  assert.match(page, /noindex, nofollow/);
  assert.match(page, /заявка отсюда не уходит/);
  assert.match(page, /дом не бронируется/);
  assert.match(page, /tel:\+78129403151/);
  assert.match(page, /tel:\+79219403151/);
  assert.match(page, /89219403151@mail\.ru/);
  assert.match(page, /ИНН 632133301020/);
  assert.match(page, /эскроу-счетами/);
  assert.match(page, /Газобетон D400/);
  assert.match(page, /Перекрытие/);
  assert.match(page, /В данный момент строительство ведётся в КП Ильино/);
  assert.match(page, /КП «Тиммолово»/);
  assert.match(page, /Обзор дома 2\.0/);
  assert.match(page, /Ропшинские высоты/);
  assert.match(page, /Зеленый Хутор/);
  assert.match(page, /rutube\.ru\/play\/embed\/46d9d95e2fd6c58abc12139af99328f5/);
  assert.match(page, /rutube\.ru\/play\/embed\/8b402b14e85d82c390dd48062662f0ea/);
  assert.match(page, /rutube\.ru\/play\/embed\/9af4f605a40e0008ce14e77c529d8005/);
  assert.match(page, /Наполняют Ваш дом естественным светом/);
  assert.match(page, /комфортный микроклимат/);
  assert.match(page, /ниша под гардероб/);
  assert.doesNotMatch(page, /autoplay/);
  assert.match(page, /не входит в комплектацию/);
  assert.doesNotMatch(page, /₽|руб\.|Сбер|ВТБ|Дом\.РФ/);
  assert.doesNotMatch(page, /Санкт-Петербург/);
  assert.match(page, /styles\.css\?v=\d{8}-\d+/);
  assert.match(page, /site\.js\?v=\d{8}-\d+/);
});

test('v1 source stays in place', () => {
  assert.match(v1, /STONE HAUS/);
  assert.match(v1, /stonehaus\/v1|Действующий сайт stonehaus\.ru/);
});
