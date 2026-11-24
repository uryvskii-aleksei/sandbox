# GitHub

## 1. Автоматизация

[workflows/harness.yml](workflows/harness.yml) проверяет обвязку и приложения, собирает сайты и MindAssistant. Отдельная матрица запускает API и собранный PHP-артефакт MindAssistant на PHP 8.2 и 8.4 с MySQL.

[workflows/deploy-mind-assistant.yml](workflows/deploy-mind-assistant.yml) выпускает проверенный коммит `main` по ручному запуску или push в `release/mind-assistant`. Артефакт публикуется в `deploy/mind-assistant`, Timeweb забирает его по HTTPS без SSH-секретов в Actions. Workflow завершается успешно после проверки опубликованного релиза. Команда запуска и серверная настройка — в [поставке MindAssistant](../apps/mind-assistant/deployment.md). Обычный push в `main` запускает только проверки.

## 2. Шаблоны

Issue описывает результат и критерии приёмки. PR фиксирует цель, изменения, проведённые проверки и план, когда он нужен. Не оставляйте подсказки шаблона в опубликованном описании. Настройка авторизации — в [документации GitHub](../docs/github.md).
