# Поставка Stonehaus на Timeweb

## 1. Назначения

Три статические цели `stonehaus-v1`, `stonehaus-v2`, `stonehaus-v3` зарегистрированы в [реестре Timeweb](../../infra/timeweb/targets.json). Каждая относится только к своему существующему каталогу `public_html/stonehaus/v1`, `v2` или `v3`.

Для полной поставки трёх версий с backup и автоматическим файловым возвратом используется [манифест приложения](deploy/timeweb.json) и scoped receiver. CLI и тесты проверяют, что он совпадает со всеми тремя статическими назначениями. Корень Purpur и `mind-assistant/` не входят в поставку.

## 2. Первичная установка

Используется существующий личный alias `timeweb-sandbox` со строгой проверкой host key. Закрытый ключ остаётся на компьютере. Нужны Node.js 24+ и Python 3.10+ локально, Python на Timeweb.

После сверки существующих приватных файлов установите receiver и назначение:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes timeweb-sandbox 'umask 077; mkdir -p /home/c/cj999935/.sandbox/site-deploy/stonehaus/backups'
scp -o BatchMode=yes -o StrictHostKeyChecking=yes infra/timeweb/site-deploy/receiver.py timeweb-sandbox:/home/c/cj999935/.sandbox/site-deploy/stonehaus/receiver.py.new
scp -o BatchMode=yes -o StrictHostKeyChecking=yes apps/stonehaus/deploy/timeweb.json timeweb-sandbox:/home/c/cj999935/.sandbox/site-deploy/stonehaus/target.json.new
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes timeweb-sandbox '/usr/bin/python3 -m py_compile /home/c/cj999935/.sandbox/site-deploy/stonehaus/receiver.py.new && chmod 700 /home/c/cj999935/.sandbox/site-deploy/stonehaus/receiver.py.new && chmod 600 /home/c/cj999935/.sandbox/site-deploy/stonehaus/target.json.new && mv /home/c/cj999935/.sandbox/site-deploy/stonehaus/receiver.py.new /home/c/cj999935/.sandbox/site-deploy/stonehaus/receiver.py && mv /home/c/cj999935/.sandbox/site-deploy/stonehaus/target.json.new /home/c/cj999935/.sandbox/site-deploy/stonehaus/target.json'
```

Повторите установку после изменения receiver или манифеста. CLI проверяет SHA-256 обоих файлов перед передачей артефакта.

## 3. Поставка

Из чистого текущего `origin/main` после успешного Harness CI:

```bash
node scripts/deploy-sites.mjs plan stonehaus
node scripts/deploy-sites.mjs publish stonehaus --apply
```

Команды проверяют источник и CI, выполняют проверки/сборку Stonehaus и создают архив с манифестом контрольных сумм. `plan` распаковывает его приватно и показывает отличия, не меняя публичные файлы и backup. `publish` сохраняет прежние изменяемые файлы вне сайта, затем обновляет только v1/v2/v3. Устаревшие и чужие файлы автоматически не удаляются. Замена отдельных файлов атомарна, всего дерева — нет.

Receiver проверяет по HTTPS точные байты HTML и CSS трёх версий и метку `/stonehaus/release.json`. После успеха её статус — `ready`. При повторе того же SHA/архива без различий нет повторной записи и backup. Проверка не отправляет заявки, не бронирует даты и не производит оплату.

Проверяются также главная страница Purpur и API health Memo. Они должны оставаться доступны по HTTPS с прежним содержимым/готовой БД.

Для отдельной версии остаются `npm run timeweb -- check stonehaus-v2` и `npm run timeweb -- plan stonehaus-v2`. Общий статический помощник выполняет rsync на месте и не создаёт backup/rollback, поэтому полная поставка выше предпочтительна для выпуска всех версий.

## 4. Восстановление

Копии лежат в `~/.sandbox/site-deploy/stonehaus/backups/<id>.tar.gz` и `<id>.tar.json`, вне публичного сайта. При неудачной HTTPS-проверке receiver возвращает прежние затронутые файлы/метку и удаляет только файлы, созданные его попыткой. Ручное изменение, сделанное после публикации, не перезаписывается rollback автоматически: требуется сверка.

Восстановление файлов и сохранность соседних приложений проверяются в изолированных тестах. Production не ломается ради теста. Перед ручным восстановлением проверьте текущую метку и совместимость backup с ручными изменениями. Правила — в [восстановлении Timeweb](../../.agents/skills/timeweb/references/recovery.md).
