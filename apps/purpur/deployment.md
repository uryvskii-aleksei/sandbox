# Поставка Purpur на Timeweb

## 1. Назначение

[deploy/timeweb.json](deploy/timeweb.json) определяет технический адрес, SSH alias, общий корень `/home/c/cj999935/public_html`, принадлежащие Purpur имена файлов/каталогов и безопасные HTTPS-проверки. Этот документ описывает PHP-сайт. Универсальный статический помощник `npm run timeweb` для его публикации не используется.

Purpur владеет отдельными корневыми файлами и деревьями `assets/`, `concept/`, `purpur/`. Каталоги `stonehaus/`, `mind-assistant/` и файлы вне манифеста не входят в поставку. Общий `public_html` не переименовывается и не заменяется целиком. Устаревшие файлы автоматически не удаляются.

## 2. Первичная установка

Нужны существующий личный SSH alias `timeweb-sandbox`, проверенный host key, Node.js 24+, Python 3.10+ на macOS и PHP/Python на Timeweb. Ключ не копируется в GitHub. На хостинге Node и Docker не нужны.

Сверьте уже установленные файлы и отсутствие symlink в приватном назначении. Установите только receiver и несекретное назначение вне публичного сайта:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes timeweb-sandbox 'umask 077; mkdir -p /home/c/cj999935/.sandbox/site-deploy/purpur/backups'
scp -o BatchMode=yes -o StrictHostKeyChecking=yes infra/timeweb/site-deploy/receiver.py timeweb-sandbox:/home/c/cj999935/.sandbox/site-deploy/purpur/receiver.py.new
scp -o BatchMode=yes -o StrictHostKeyChecking=yes apps/purpur/deploy/timeweb.json timeweb-sandbox:/home/c/cj999935/.sandbox/site-deploy/purpur/target.json.new
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes timeweb-sandbox '/usr/bin/python3 -m py_compile /home/c/cj999935/.sandbox/site-deploy/purpur/receiver.py.new && chmod 700 /home/c/cj999935/.sandbox/site-deploy/purpur/receiver.py.new && chmod 600 /home/c/cj999935/.sandbox/site-deploy/purpur/target.json.new && mv /home/c/cj999935/.sandbox/site-deploy/purpur/receiver.py.new /home/c/cj999935/.sandbox/site-deploy/purpur/receiver.py && mv /home/c/cj999935/.sandbox/site-deploy/purpur/target.json.new /home/c/cj999935/.sandbox/site-deploy/purpur/target.json'
```

После изменения receiver или назначения повторите установку. CLI сверяет SHA-256 установленных файлов с текущим репозиторием и отказывает при расхождении.

## 3. План и публикация

Из корня Sandbox, с чистым текущим коммитом `origin/main` и успешным Harness CI для этого SHA:

```bash
node scripts/deploy-sites.mjs plan purpur
node scripts/deploy-sites.mjs publish purpur --apply
```

Обе команды проверяют источник/CI, выполняют проверки приложения и сборку, создают детерминированный архив с контрольными суммами и передают его только в приватное staging-место Timeweb. `plan` проверяет состав, PHP-синтаксис и точные различия с хостингом. Публичные файлы и резервные копии он не меняет.

`publish --apply` повторно сверяет текущие файлы, сохраняет изменяемые прежние файлы в приватном backup и обновляет только перечисленные пути. Каждый файл заменяется через временный файл и rename. Между заменами возможна короткая смешанная версия сайта: атомарной замены всего document root нет.

По HTTPS проверяются реальные байты главной страницы, CSS/JS и вариантов v1/v2/v3, а также метка `/release-purpur.json`. Для PHP используется только GET: `order.php` должен вернуть 405, `cdek-points.php` без параметров — 400. Заказы и письма не отправляются. Доставка писем и актуальность ответов внешнего CDEK этими проверками не подтверждаются.

Дополнительно проверяются API health Memo и HTML всех трёх версий Stonehaus. Это обнаруживает повреждение маршрутов соседей общим `.htaccess`, даже если их файлы остались прежними. Неуспешная проверка вызывает файловый возврат Purpur.

Успех помечается `deploymentStatus=ready`. Один и тот же SHA/архив без изменений проходит повторную проверку без backup и перезаписи. Другая сборка для уже установленного SHA отклоняется до выяснения причины.

## 4. Восстановление

Backup находится в `~/.sandbox/site-deploy/purpur/backups/<id>.tar.gz`, рядом `<id>.tar.json`: список затронутых файлов, прежние SHA/права и предыдущая метка. Эти файлы имеют права `600`, каталоги — `700`. Архив содержит только существовавшие изменяемые файлы этого приложения.

При ошибке HTTPS receiver возвращает свои изменённые файлы и прежнюю метку, удаляет только созданные этой попыткой файлы. Более новые ручные изменения он сохраняет и сообщает о конфликте для сверки с backup. Соседние приложения и прежние посторонние файлы не удаляются. Файловое восстановление проверяется изолированными тестами. Живой сбой на production ради проверки не создаётся.

При неизвестном результате сопоставьте публичную метку, вывод команды, хостинг и приватный backup перед повтором. Для ручного восстановления сначала установите совместимость выбранной копии и текущих ручных изменений. Автоматического удаления старых backup нет. Общие принципы — в [восстановлении Timeweb](../../.agents/skills/timeweb/references/recovery.md).
