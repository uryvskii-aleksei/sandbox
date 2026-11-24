"""Проверяет реальный Claude Code Write/PostToolUse через локальный ответ-фикстуру.

CLI должен быть установлен отдельно. Скрипт не устанавливает пакеты и не использует
коммерческую модель: Messages endpoint привязан к 127.0.0.1, конфигурация изолирована.
Это проверка runtime/hooks, а не качества ответов модели или выбора skills.
"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading

REPOSITORY = Path(__file__).resolve().parents[3]
SOURCE = "const value={items:[1,2]};"
EXPECTED = "const value = { items: [1, 2] };\n"


def prepare(root):
    hook = root / ".agents/hooks/scripts/format-touched.cjs"
    hook.parent.mkdir(parents=True)
    shutil.copy2(REPOSITORY / ".agents/hooks/scripts/format-touched.cjs", hook)
    (root / "node_modules").mkdir()
    (root / "node_modules/prettier").symlink_to(
        REPOSITORY / "node_modules/prettier", target_is_directory=True
    )
    (root / ".claude").mkdir()
    (root / "config").mkdir()
    (root / "untouched.js").write_text(SOURCE)
    observer = root / "observe.cjs"
    observer.write_text(
        "const fs=require('node:fs');"
        "const p=JSON.parse(fs.readFileSync(0,'utf8'));"
        "fs.appendFileSync(" + json.dumps(str(root / "events.jsonl")) + ","
        "JSON.stringify({event:p.hook_event_name,tool:p.tool_name,"
        "path:p.tool_input?.file_path})+'\\n');process.stdout.write('{}\\n');"
    )
    config = json.loads((REPOSITORY / ".claude/settings.json").read_text())
    observer_hook = {"type": "command", "command": "node " + shlex.quote(str(observer)), "timeout": 10}
    config["hooks"]["PostToolUse"][0]["hooks"].append(observer_hook)
    config["hooks"]["Setup"] = [{"matcher": "init", "hooks": [observer_hook]}]
    (root / ".claude/settings.json").write_text(json.dumps(config))


def fixture_server(root, requests):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            size = int(self.headers.get("Content-Length", 0))
            if size > 8 * 1024 * 1024:
                self.send_error(413)
                return
            body = json.loads(self.rfile.read(size) or b"{}")
            tools = [tool.get("name") for tool in body.get("tools", [])]
            # Заголовки авторизации и полный prompt намеренно не журналируются.
            requests.append({"path": self.path, "stream": body.get("stream", False), "tools": tools})
            if self.path.split("?", 1)[0].endswith("count_tokens"):
                self.send_json({"input_tokens": 1})
                return
            if self.path.split("?", 1)[0] != "/v1/messages":
                self.send_error(404)
                return
            complete = any(
                part.get("type") == "tool_result" and part.get("tool_use_id") == "fixture_write"
                for message in body.get("messages", [])
                if isinstance(message.get("content"), list)
                for part in message["content"]
            )
            if "Write" in tools and not complete:
                content = [{"type": "tool_use", "id": "fixture_write", "name": "Write", "input": {
                    "file_path": str(root / "edited.js"), "content": SOURCE,
                }}]
                reason = "tool_use"
            else:
                content = [{"type": "text", "text": "Local hook fixture completed."}]
                reason = "end_turn"
            message = {"id": "msg_fixture", "type": "message", "role": "assistant", "content": content,
                       "model": body.get("model", "fixture"), "stop_reason": reason, "stop_sequence": None,
                       "usage": {"input_tokens": 1, "output_tokens": 1}}
            if not body.get("stream"):
                self.send_json(message)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            start = {**message, "content": [], "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 0}}
            self.event("message_start", {"message": start})
            for index, block in enumerate(content):
                if block["type"] == "tool_use":
                    initial = {**block, "input": {}}
                    delta = {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}
                else:
                    initial = {"type": "text", "text": ""}
                    delta = {"type": "text_delta", "text": block["text"]}
                self.event("content_block_start", {"index": index, "content_block": initial})
                self.event("content_block_delta", {"index": index, "delta": delta})
                self.event("content_block_stop", {"index": index})
            self.event("message_delta", {"delta": {"stop_reason": reason, "stop_sequence": None},
                                         "usage": {"output_tokens": 1}})
            self.event("message_stop", {})

        def send_json(self, value):
            data = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def event(self, name, payload):
            data = {"type": name, **payload}
            self.wfile.write(("event: " + name + "\ndata: " + json.dumps(data) + "\n\n").encode())
            self.wfile.flush()

    return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def verify(cli, root):
    prepare(root)
    requests = []
    server = fixture_server(root, requests)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TERM"} or key.startswith("LC_")}
    environment.update({
        "CLAUDE_CONFIG_DIR": str(root / "config"),
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:" + str(server.server_port),
        "ANTHROPIC_API_KEY": "local-fixture-not-a-real-key",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1",
    })
    common = [cli, "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']
    try:
        version = subprocess.run([cli, "--version"], cwd=root, env=environment, capture_output=True, text=True, timeout=10).stdout.strip()
        setup = subprocess.run(common + ["--init-only"], cwd=root, env=environment,
                               capture_output=True, text=True, timeout=25)
        result = subprocess.run(common + ["-p", "Write edited.js with the requested fixture content.",
                                "--tools", "Write", "--allowedTools", "Write", "--permission-mode", "acceptEdits",
                                "--no-session-persistence", "--output-format", "stream-json", "--verbose"],
                                cwd=root, env=environment, capture_output=True, text=True, timeout=45)
        (root / "runtime.stdout").write_text(result.stdout)
        (root / "runtime.stderr").write_text(result.stderr)
        event_file = root / "events.jsonl"
        events = [json.loads(line) for line in event_file.read_text().splitlines()] if event_file.exists() else []
        checks = {
            "localFixtureUsed": any(item["path"].split("?", 1)[0] == "/v1/messages" for item in requests),
            "setupSucceeded": setup.returncode == 0 and any(item["event"] == "Setup" for item in events),
            "runtimeSucceeded": result.returncode == 0,
            "realWriteEvent": any(item["event"] == "PostToolUse" and item.get("tool") == "Write"
                                  and item.get("path") == str(root / "edited.js") for item in events),
            "formattedByHook": (root / "edited.js").is_file() and (root / "edited.js").read_text() == EXPECTED,
            "unrelatedFilePreserved": (root / "untouched.js").read_text() == SOURCE,
        }
        return {"ok": all(checks.values()), "cliVersion": version, "setupExit": setup.returncode,
                "runtimeExit": result.returncode, "checks": checks, "events": events,
                "loopbackRequests": len(requests), "modelResponseSource": "local deterministic fixture"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True, help="Путь к официальному установленному Claude Code CLI")
    parser.add_argument("--keep-artifacts", action="store_true", help="Сохранить синтетические файлы во временном каталоге")
    args = parser.parse_args()
    cli = shutil.which(args.cli)
    if not cli:
        parser.error("Claude Code CLI не найден. Установите его отдельно из официального источника.")
    root = Path(tempfile.mkdtemp(prefix="sandbox-claude-hook-runtime-"))
    try:
        result = verify(cli, root)
        if args.keep_artifacts:
            result["artifacts"] = str(root)
        print(json.dumps(result))
        return 0 if result["ok"] else 1
    except Exception as error:
        print(json.dumps({"ok": False, "errorType": type(error).__name__,
                          "artifacts": str(root) if args.keep_artifacts else None}))
        return 1
    finally:
        if not args.keep_artifacts:
            shutil.rmtree(root)


if __name__ == "__main__":
    raise SystemExit(main())
