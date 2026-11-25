# Stone Haus

## 1. Версии

`site/index.html` — точка входа с выбором трёх концепций. `site/v1/`, `site/v2/` и `site/v3/` сохраняют существующие варианты с Timeweb. Между страницами используются относительные ссылки, поэтому выбор версии остаётся внутри `/stonehaus/`.

Фото с Tilda и ролики Rutube остаются внешними ресурсами. Заявки, оплата и бронирование в концепции v2 не выполняются. [Исходное описание](archive/original-readme.md) и [задача v2](archive/stonehaus-v2-concept/README.md) — исторические документы.

## 2. Локальная работа

```bash
npm run dev:sites
npm test --workspace=@sandbox/stonehaus
npm run build --workspace=@sandbox/stonehaus
```

Откройте `http://127.0.0.1:4173/stonehaus/` и выберите вариант. Прямые ссылки `/stonehaus/v1/`, `/stonehaus/v2/` и `/stonehaus/v3/` сохраняются. Команды выполняются из корня. Сборка копирует точку входа и её CSS в `dist/index.html`, `dist/styles.css`, а версии — в `dist/v1/`, `dist/v2/`, `dist/v3/`.

Тест точки входа проверяет HTTP-доступность всех вариантов и локальных ресурсов под `/stonehaus/`, а также переход из v2 в v1. Тесты v2 сохраняют проверки границ концепции.

## 3. Публикация

Публичный адрес — [cj999935.tw1.ru/stonehaus/](https://cj999935.tw1.ru/stonehaus/). Отдельные варианты: [v1](https://cj999935.tw1.ru/stonehaus/v1/), [v2](https://cj999935.tw1.ru/stonehaus/v2/) и [v3](https://cj999935.tw1.ru/stonehaus/v3/). Изменения начинают работать на хостинге после поставки. Статические цели зарегистрированы в [Timeweb](../../infra/timeweb/targets.json). Полная поставка с backup и проверкой HTTPS: `node scripts/deploy-sites.mjs plan stonehaus`, затем `publish stonehaus --apply` из корня Sandbox. Она обновляет точку входа, её CSS и каталоги версий Stonehaus. Первичная установка и восстановление — в [процедуре поставки](deployment.md).
