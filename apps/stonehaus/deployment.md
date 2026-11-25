# Поставка Stonehaus на Timeweb

## 1. Назначения

Публичная точка входа — [cj999935.tw1.ru/stonehaus/](https://cj999935.tw1.ru/stonehaus/). Она предлагает выбор трёх вариантов без автоматического перенаправления. Прямые адреса `/stonehaus/v1/`, `/stonehaus/v2/` и `/stonehaus/v3/` сохраняются.

Три статические цели `stonehaus-v1`, `stonehaus-v2`, `stonehaus-v3` зарегистрированы в [реестре Timeweb](../../infra/timeweb/targets.json). Для полной поставки точки входа (`index.html`, `styles.css`) и трёх каталогов версий с backup и автоматическим файловым возвратом используется [манифест приложения](deploy/timeweb.json) и scoped receiver. CLI и тесты проверяют согласованность назначений. Файловые пути берутся только из этих конфигураций и сверяются с фактической настройкой сайта на Timeweb перед поставкой. Соседние `/purpur/` и `/memo/` не входят в поставку Stonehaus.

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

Команды проверяют источник и CI, выполняют проверки/сборку Stonehaus и создают архив с манифестом контрольных сумм. `plan` распаковывает его приватно и показывает отличия, не меняя публичные файлы и backup. `publish` сохраняет прежние изменяемые файлы вне сайта, затем обновляет только `index.html`, `styles.css` и v1/v2/v3 внутри Stonehaus. Устаревшие и чужие файлы автоматически не удаляются. Замена отдельных файлов атомарна, всего дерева — нет.

Receiver проверяет по HTTPS точные байты точки входа, её CSS, HTML и CSS трёх версий и метку `/stonehaus/release.json`. После успеха её статус — `ready`. При повторе того же SHA/архива без различий нет повторной записи и backup. Проверка не отправляет заявки, не бронирует даты и не производит оплату.

Проверяются также главная Purpur по `/purpur/`, её варианты `/purpur/v1/`–`v3/` и API health Memo по `/memo/api/health`. Они должны оставаться доступны по HTTPS с прежним содержимым/готовой БД.

Для отдельной версии остаются `npm run timeweb -- check stonehaus-v2` и `npm run timeweb -- plan stonehaus-v2`. Общий статический помощник выполняет rsync на месте и не создаёт backup/rollback, поэтому полная поставка выше предпочтительна для выпуска всех версий.

### 3.1. Одноразовый переход на пути cj999935.tw1.ru

Перед первичной миграцией проверьте существующие каталоги по SSH, технический домен по HTTPS и CI коммита `main`. Подготовьте резервную копию. Если новая точка входа Stonehaus ещё отсутствует, отдельным ограниченным действием разместите только `index.html` и `styles.css` из его проверенного артефакта, сохранив существующие файлы вне публичного сайта. Проверьте точные байты этих двух файлов и неизменность трёх каталогов версий. Метка полной поставки этим шагом не создаётся.

Затем мигрируют Memo с проверкой `/memo/api/health`, Purpur и полностью Stonehaus. Такая последовательность удовлетворяет строгим взаимным проверкам главных страниц и всех версий. Обходные флаги и отключение проверок не применяются. Старые файлы Purpur в общем корне домена сохраняются. После завершения миграции используйте обычную полную поставку выше.

## 4. Восстановление

Копии лежат в `~/.sandbox/site-deploy/stonehaus/backups/<id>.tar.gz` и `<id>.tar.json`, вне публичного сайта. При неудачной HTTPS-проверке receiver возвращает прежние затронутые файлы/метку и удаляет только файлы, созданные его попыткой. Ручное изменение, сделанное после публикации, не перезаписывается rollback автоматически: требуется сверка.

Восстановление файлов и сохранность соседних приложений проверяются в изолированных тестах. Production не ломается ради теста. Перед ручным восстановлением проверьте текущую метку и совместимость backup с ручными изменениями. Правила — в [восстановлении Timeweb](../../.agents/skills/timeweb/references/recovery.md).
