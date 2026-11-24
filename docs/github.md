# GitHub

## 1. Репозиторий

Основной репозиторий — [uryvskii-aleksei/sandbox](https://github.com/uryvskii-aleksei/sandbox), remote `origin`, основная ветка `main`. Локальная привязка не означает наличие доступа к приватным данным, право push или подключение агента.

## 2. Доступ агента

В этой среде подключён официальный плагин GitHub под аккаунтом `uryvskii-aleksei`. Чтением API подтверждены доступ к `uryvskii-aleksei/sandbox` и права на запись и администрирование. Токен в проекте не хранится.

При настройке новой среды подключите в плагине свой аккаунт и разрешите доступ к этому репозиторию. После подключения попросите агента прочитать сведения именно о `uryvskii-aleksei/sandbox`. Проверьте фактический аккаунт и доступные операции.

Для сред без плагина есть шаблоны официального [GitHub MCP](https://github.com/github/github-mcp-server): [.codex/mcp.example.toml](../.codex/mcp.example.toml), [.mcp.example.json](../.mcp.example.json), [.cursor/mcp.example.json](../.cursor/mcp.example.json). Выберите один маршрут. Шаблоны не активируются автоматически.

Пример Codex использует `GITHUB_PERSONAL_ACCESS_TOKEN` из окружения. Перенесите только нужную секцию в личную конфигурацию, сохранив существующие настройки. Для Claude Code скопируйте `.mcp.example.json` в игнорируемый `.mcp.json`. Для Cursor используйте игнорируемый `.cursor/mcp.json`. Если ваша среда поддерживает OAuth этого сервера, можно выбрать его вместо PAT. Не храните значения токенов в файлах проекта.

Альтернативный CLI-маршрут после установки `gh`:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth status
gh repo view uryvskii-aleksei/sandbox
```

Авторизация CLI и плагина независимы. Успешный `git ls-remote` публичного репозитория не подтверждает доступ к issue или возможность push. `npm run doctor` проверяет локальные предпосылки, `npm run doctor -- --online` дополнительно проверяет чтение remote и авторизованный доступ через `gh`, если он установлен.

## 3. Задачи и PR

Используйте GitHub Issues для задач, Pull Requests для изменений и Actions для CI. [Шаблон PR](../.github/pull_request_template.md) помогает записать цель и проверку. Не создавайте issue ради небольшой локальной правки без необходимости. План сложной реализации хранится в разделе «План» PR.

Агент читает актуальный объект перед изменением и проверяет результат после записи. Создание PR, слияние, закрытие issue и публикация выполняются в пределах поручения. Привязку issue через `Closes #…` добавляйте, когда автоматическое закрытие при слиянии действительно требуется.

## 4. CI

[Harness](../.github/workflows/harness.yml) проверяет обвязку и приложения на push в `main` и на PR, собирает сайты и MindAssistant. API и собранный артефакт MindAssistant проверяются с MySQL на PHP 8.2 и 8.4. Проверки не получают ключи Timeweb.

Проверенный коммит `main` выпускается командой `npm run release:mind-assistant`. [Deploy MindAssistant](../.github/workflows/deploy-mind-assistant.yml) публикует артефакт со встроенным временным `GITHUB_TOKEN`, задание Timeweb забирает его по HTTPS и выполняет backup, миграцию и проверку релиза. SSH-ключи и пароль MySQL в GitHub не хранятся. Обычный push в `main` не запускает деплой. Настройка и восстановление — в [инструкции приложения](../apps/mind-assistant/deployment.md).

Доступность правил GitHub Environment зависит от тарифа и видимости репозитория. Наличие `environment` в YAML не доказывает включённую защиту: [документация GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
