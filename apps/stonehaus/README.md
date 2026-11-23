# Stone Haus

## 1. Версии

`site/v1/`, `site/v2/` и `site/v3/` — три варианта с Timeweb. Локальные незакоммиченные исходники v2 из соседнего Purpur сверены с хостингом: содержимое трёх файлов совпадает. Тест v2, его описание и задача сохранены в этом приложении.

Фото с Tilda и ролики Rutube остаются внешними ресурсами. Заявки, оплата и бронирование в концепции v2 не выполняются. [Исходное описание](archive/original-readme.md) и [задача v2](archive/stonehaus-v2-concept/README.md) — исторические документы.

## 2. Локальная работа

```bash
npm run dev:sites
npm test --workspace=@sandbox/stonehaus
npm run build --workspace=@sandbox/stonehaus
```

Откройте `http://127.0.0.1:4173/stonehaus/v1/`, `/stonehaus/v2/` или `/stonehaus/v3/`. Команды выполняются из корня. Сборка копирует версии в `dist/v1/`, `dist/v2/`, `dist/v3/`.

## 3. Публикация

На хостинге версии доступны в [stonehaus/v1](https://cj999935.tw1.ru/stonehaus/v1/), [v2](https://cj999935.tw1.ru/stonehaus/v2/) и [v3](https://cj999935.tw1.ru/stonehaus/v3/). Каждая версия имеет собственный каталог. Не направляйте артефакт приложения в корень Purpur. Настройки и ограничения поставки — в [Timeweb](../../infra/timeweb/README.md).
