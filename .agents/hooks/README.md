# Форматирование после агентского редактирования

## 1. Назначение

[format-touched.cjs](scripts/format-touched.cjs) извлекает пути из событий редактирования и запускает ближайший установленный Prettier только для затронутых существующих файлов. Форматтер ищется у файла и его предков, без соседних приложений. Пакеты автоматически не устанавливаются.

Файлы вне проекта, symlink за его пределы, `.imports`, `.aws`, личные настройки сред, `.env`, зависимости и результаты сборки пропускаются. Ошибка выводится в stderr. Хук остаётся fail-open, поэтому обязательный gate — `npm run format:check` и CI. Это механизм форматирования, а не защита секретов от публикации.

## 2. Адаптеры и доверие

| Среда       | Конфигурация                                 | Событие                                                                                    |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Codex       | [hooks.json](../../.codex/hooks.json)        | `PostToolUse`, matcher `ApplyPatch\|apply_patch`, в том числе patch в `tool_input.command` |
| Claude Code | [settings.json](../../.claude/settings.json) | `PostToolUse`, matcher `Edit\|Write`                                                       |
| Cursor      | [hooks.json](../../.cursor/hooks.json)       | `afterFileEdit`                                                                            |

Codex должен обнаружить, включить и доверять точному определению project hook. Проверьте `.codex/hooks.json` через Settings → Hooks → Review hooks или штатный `/hooks`. Изменённое определение может потребовать нового review. Скрипт проверки читает `hooks/list` и отказывается продолжать без `enabled: true` и `trustStatus: trusted`. Он не выдаёт доверие и не использует флаги обхода. Подробнее — [Codex Hooks](https://learn.chatgpt.com/docs/hooks).

Claude Code загружает project settings. Cursor должен открыть fixture как доверенную рабочую папку с доступным `node`. Контракты событий описаны в [Claude Code Hooks](https://code.claude.com/docs/en/hooks) и [Cursor Hooks](https://cursor.com/docs/hooks). Личные настройки моделей менять не требуется.

## 3. Повторяемые проверки

Нужны Node.js 24+ и Python 3.10+. Все команды выполняются из корня Sandbox после `npm ci`. CLI устанавливаются отдельно из официальных источников. Проверяющие скрипты ничего не устанавливают. Укажите имя CLI в `PATH` либо полный путь к executable через `--cli`.

### 3.1. Unit и payload fixtures

```bash
node --test .agents/hooks/scripts/*.test.cjs
```

Тесты проверяют извлечение путей, границы workspace, symlink, владение форматтером и работу реального Prettier через команды трёх адаптеров. Для `.imports` и `.aws` используются синтетические файлы. Передача готового JSON в команду hook не считается событием настоящего рантайма.

### 3.2. Native Codex CLI

```bash
python3 .agents/hooks/scripts/verify-codex-runtime.py --cli codex --keep-artifacts
```

Если CLI доступен только внутри установленного Codex desktop:

```bash
python3 .agents/hooks/scripts/verify-codex-runtime.py --cli /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex --keep-artifacts
```

[Скрипт](scripts/verify-codex-runtime.py) сначала читает доверие через локальный app-server. Затем native `codex exec` получает детерминированный Responses SSE с вызовом `apply_patch` от сервера на `127.0.0.1`. Временный model catalog объявляет этот инструмент. Provider, catalog и прочие overrides действуют только в дочернем процессе, личные настройки и persisted trust сохраняются. Флаги обхода trust, approvals и sandbox не используются. Коммерческая модель не вызывается.

Пробник `scripts/hook-runtime-probe.js` должен отсутствовать. Скрипт создаёт его эксклюзивно, передаёт неформатированный patch и проверяет native `file_change`, итоговые байты после hook и неизменность остальных файлов из Git-реестра без ignored-путей. Собственный пробник удаляется. Неожиданно изменённый пробник сохраняется для разбора. На время проверки не редактируйте другие исходники: это будет отмечено как изменение вне сценария.

Успех — `ok: true` и все поля `checks: true`, включая `nativeApplyPatchCompleted`, `formattedByHook` и `unrelatedSourcePreserved`. `hooks/list` с доверенным hook сам по себе не является успешным прогоном редактирования. Этот сценарий проверяет native CLI, а не доставку событий через wrapper `functions.exec`.

### 3.3. Claude Code CLI

```bash
python3 .agents/hooks/scripts/verify-claude-runtime.py --cli claude --keep-artifacts
```

[Скрипт](scripts/verify-claude-runtime.py) создаёт временный workspace и изолированный `CLAUDE_CONFIG_DIR`, копирует проектный hook и подключает установленный Prettier. Ответы модели заменены локальным Messages SSE на `127.0.0.1`. Используется синтетический ключ, реальные credentials не нужны. Личные настройки и модели не меняются, платных запросов нет.

Native Claude Code выполняет `Setup`, затем `Write`. Дополнительный наблюдатель сохраняет только имя события, инструмента и путь синтетического файла. Успех — `ok: true` и все `checks: true`, в том числе `realWriteEvent`, `formattedByHook` и `unrelatedFilePreserved`. Это реальная загрузка настроек и вызов инструментов CLI с локальной модельной фикстурой, а не имитация `PostToolUse` прямым вызовом скрипта.

Для обоих CLI без `--keep-artifacts` временные логи удаляются. С этим флагом скрипт печатает путь к своему временному каталогу. Логи не добавляются в Git. Они не содержат записанного скриптом полного model input или заголовков авторизации.

### 3.4. Cursor GUI

Создайте отдельную fixture-папку следующей командой. Она копирует текущий адаптер, не меняя Sandbox и настройки Cursor, и добавляет наблюдателя только в копию конфигурации:

```bash
python3 - <<'PY'
import json
from pathlib import Path
import shutil
import tempfile

repository = Path.cwd()
prettier = repository / "node_modules/prettier"
if not prettier.is_dir():
    raise SystemExit("Сначала выполните npm ci в корне Sandbox.")
fixture = Path(tempfile.mkdtemp(prefix="sandbox-cursor-hooks-"))
(fixture / ".agents/hooks/scripts").mkdir(parents=True)
shutil.copy2(repository / ".agents/hooks/scripts/format-touched.cjs",
             fixture / ".agents/hooks/scripts/format-touched.cjs")
(fixture / "node_modules").mkdir()
(fixture / "node_modules/prettier").symlink_to(prettier, target_is_directory=True)
(fixture / ".cursor").mkdir()
(fixture / "edited.js").write_text("const value = { items: [0] };\n")
(fixture / "untouched.js").write_text("const untouched={keep:true};")
(fixture / "AGENTS.md").write_text(
    "Edit only edited.js as requested. Do not run commands, format manually, "
    "install packages, publish or delegate.\n")
(fixture / "observe.cjs").write_text(
    "const fs=require('node:fs');"
    "const p=JSON.parse(fs.readFileSync(0,'utf8'));"
    "fs.appendFileSync('events.jsonl',JSON.stringify({"
    "event:p.hook_event_name,path:p.file_path,"
    "rawEdit:p.edits?.map(e=>e.new_string)})+'\\n');"
    "process.stdout.write('{}\\n');")
config = json.loads((repository / ".cursor/hooks.json").read_text())
config["hooks"]["afterFileEdit"].append({"command": "node observe.cjs", "timeout": 10})
(fixture / ".cursor/hooks.json").write_text(json.dumps(config))
print(fixture)
PY
```

Откройте напечатанную папку в отдельном окне Cursor, разрешите стандартное доверие workspace и дайте Agent запрос:

> В edited.js запиши точно строку `const value={items:[1,2]};`. Не запускай команды и не форматируй сам. Другие файлы не меняй.

Проверьте три независимых результата:

- `events.jsonl` содержит настоящее `afterFileEdit` для `edited.js` с `rawEdit` равным `const value={items:[1,2]};`.
- `edited.js` содержит `const value = { items: [1, 2] };` и завершающий перевод строки.
- `untouched.js` сохранился побайтно: `const untouched={keep:true};` без перевода строки.

Видимое форматирование без события не доказывает работу hook: его мог выполнить сам Agent или другой механизм редактора. Событие без итоговых байтов также недостаточно. После проверки удалите только созданную fixture-папку. Результат не требует изменения личной модели Cursor и не оценивает качество её ответов.

## 4. Подтверждённая совместимость

24 ноября 2026 года получены следующие наблюдения:

| Проверка                             | Наблюдение и граница                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI `0.171.0-alpha.13`         | Существующее доверие прочитано через `hooks/list`. Native `apply_patch` завершился, неформатированный patch стал форматированным файлом, остальные исходники сохранились. Ответ модели — локальная Responses SSE-фикстура.            |
| Claude Code CLI `2.1.331`            | Реальные `Setup` и `Write` → `PostToolUse` зарегистрированы наблюдателем. Итоговый файл отформатирован, соседний сохранён. Ответ модели — локальная Messages SSE-фикстура.                                                            |
| Cursor GUI `3.30.14`                 | Пользователь выполнил Agent edit в отдельной fixture-папке. Наблюдатель записал `afterFileEdit` с исходной неформатированной строкой. Итоговые байты форматированы, соседний файл сохранён. Результаты независимо перечитаны с диска. |
| Команды адаптеров и защитные границы | Восемь unit/integration tests прошли. Они дополняют реальные runtime-события, а не заменяют их.                                                                                                                                       |

Wrapper `functions.exec` в проверявшейся сессии не дал автоматического форматирования. Совместимость native Codex CLI не переносится на него автоматически. Обнаружение skills через app-server и поведенческая оценка инструкций описаны отдельно в [решении по обвязке](../../docs/designs/agent-harness.md#7-подтверждённые-проверки-и-пределы).
