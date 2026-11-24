"""Проверяет native Codex apply_patch и доверенный PostToolUse с локальной SSE-фикстурой.

Нужны установленный Codex CLI, зависимости репозитория и заранее доверенный hook.
Скрипт не выдаёт доверие, не обходит sandbox/approvals и не вызывает платную модель.
Процессные overrides не сохраняются. В репозитории создаётся только собственный
пробник scripts/hook-runtime-probe.js. Существующий файл никогда не перезаписывается.
"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import threading
import time

REPOSITORY = Path(__file__).resolve().parents[3]
PROBE = "scripts/hook-runtime-probe.js"
SOURCE = 'const hookProof={runtime:"Codex",values:[1,2]};\n'
EDITED = 'const hookProof={runtime:"Codex",values:[3,4]};\n'
EXPECTED = "const hookProof = { runtime: 'Codex', values: [3, 4] };\n"


def source_manifest():
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=REPOSITORY
    ).decode().split("\0")
    return {name: hashlib.sha256((REPOSITORY / name).read_bytes()).hexdigest()
            for name in sorted(set(paths)) if name and name != PROBE
            and (REPOSITORY / name).is_file() and not (REPOSITORY / name).is_symlink()}


def trusted_hook(cli, environment):
    process = subprocess.Popen([cli, "app-server", "--stdio"], cwd=REPOSITORY, env=environment,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True, bufsize=1)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)

    def send(value):
        process.stdin.write(json.dumps(value) + "\n")
        process.stdin.flush()

    def receive(identity):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if selector.select(timeout=1):
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError("Локальный app-server завершился до ответа.")
                value = json.loads(line)
                if value.get("id") == identity:
                    if "error" in value:
                        raise RuntimeError("App-server отклонил проверку hooks/list.")
                    return value["result"]
        raise TimeoutError("Истекло время ожидания локального app-server.")

    try:
        send({"id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "sandbox-hook-smoke", "version": "1.0.0"},
            "capabilities": {"experimentalApi": True}}})
        receive(1)
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "hooks/list", "params": {"cwds": [str(REPOSITORY)]}})
        data = receive(2).get("data", [])
        for project in data:
            if project.get("errors"):
                raise RuntimeError("Hooks/list обнаружил ошибку конфигурации проекта.")
            for hook in project.get("hooks", []):
                if (hook.get("sourcePath") == str(REPOSITORY / ".codex/hooks.json")
                        and hook.get("eventName") == "postToolUse"
                        and "apply_patch" in hook.get("matcher", "").split("|")):
                    if hook.get("enabled") and hook.get("trustStatus") == "trusted":
                        return {"enabled": True, "trustStatus": "trusted"}
        raise RuntimeError("Сначала включите и проверьте .codex/hooks.json в Settings → Hooks.")
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def write_catalog(root):
    # Минимальный ModelInfo, а не копия личного каталога или системного prompt.
    # Схема: github.com/openai/codex, codex-rs/protocol/src/openai_models.rs.
    model = {
        "slug": "hook-runtime-fixture", "display_name": "Local hook fixture",
        "description": "Deterministic localhost fixture, no inference",
        "supported_reasoning_levels": [], "shell_type": "shell_command",
        "visibility": "list", "supported_in_api": True, "priority": 0,
        "support_verbosity": False, "apply_patch_tool_type": "freeform",
        "truncation_policy": {"mode": "bytes", "limit": 10000},
        "experimental_supported_tools": [], "supports_parallel_tool_calls": False,
        "prefer_websockets": False, "include_apps_usage_instructions": False,
        "base_instructions": "Use only the supplied native apply_patch fixture. Do not run commands.",
    }
    catalog = root / "fixture-models.json"
    catalog.write_text(json.dumps({"models": [model]}))
    return catalog


def fixture_server(requests):
    patch = ("*** Begin Patch\n*** Update File: " + PROBE + "\n@@\n-" + SOURCE.rstrip("\n")
             + "\n+" + EDITED.rstrip("\n") + "\n*** End Patch")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            size = int(self.headers.get("Content-Length", 0))
            if size > 8 * 1024 * 1024 or self.path != "/v1/responses":
                self.send_error(413 if size > 8 * 1024 * 1024 else 404)
                return
            body = json.loads(self.rfile.read(size))
            tools = [{"name": tool.get("name"), "type": tool.get("type")}
                     for tool in body.get("tools", [])]
            # Не сохраняются заголовки авторизации, input и системные инструкции.
            requests.append({"path": self.path, "tools": tools})
            complete = any(item.get("type") == "custom_tool_call_output"
                           and item.get("call_id") == "call_fixture"
                           for item in body.get("input", []) if isinstance(item, dict))
            if len(requests) == 1 and {"name": "apply_patch", "type": "custom"} in tools:
                item = {"type": "custom_tool_call", "id": "ctc_fixture", "call_id": "call_fixture",
                        "name": "apply_patch", "input": patch}
            else:
                item = {"type": "message", "id": "msg_fixture", "role": "assistant",
                        "content": [{"type": "output_text", "text":
                                     "Local hook fixture completed." if complete else "Fixture failed."}]}
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            response = {"id": "resp_fixture_" + str(len(requests)), "object": "response",
                        "status": "in_progress", "output": []}
            self.event("response.created", {"response": response})
            self.event("response.output_item.added", {"output_index": 0, "item": item})
            self.event("response.output_item.done", {"output_index": 0, "item": item})
            self.event("response.completed", {"response": {**response, "status": "completed",
                       "output": [item], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}})

        def event(self, name, payload):
            self.wfile.write(("event: " + name + "\ndata: "
                              + json.dumps({"type": name, **payload}) + "\n\n").encode())
            self.wfile.flush()

    return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def verify(cli, root):
    probe = REPOSITORY / PROBE
    if probe.exists() or probe.is_symlink():
        raise RuntimeError("Пробник уже существует. Скрипт не перезаписывает чужие файлы: " + PROBE)
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TERM"}
                   or key.startswith("LC_")}
    environment["NO_PROXY"] = "127.0.0.1,localhost"
    trust = trusted_hook(cli, environment)
    catalog = write_catalog(root)
    before = source_manifest()
    requests = []
    server = fixture_server(requests)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with probe.open("x") as probe_file:
        probe_file.write(SOURCE)
    overrides = {
        "model_provider": "local_hook_fixture", "model": "hook-runtime-fixture",
        "model_catalog_json": str(catalog), "mcp_servers": {}, "features.apps": False,
        "web_search": "disabled", "model_providers.local_hook_fixture.name": "Local hook fixture",
        "model_providers.local_hook_fixture.base_url": "http://127.0.0.1:" + str(server.server_port) + "/v1",
        "model_providers.local_hook_fixture.wire_api": "responses",
        "model_providers.local_hook_fixture.requires_openai_auth": False,
        "model_providers.local_hook_fixture.supports_websockets": False,
        "model_providers.local_hook_fixture.request_max_retries": 0,
        "model_providers.local_hook_fixture.stream_max_retries": 0,
        "model_providers.local_hook_fixture.stream_idle_timeout_ms": 10000,
    }
    command = [cli, "exec", "--cd", str(REPOSITORY), "--sandbox", "workspace-write", "--ephemeral", "--json"]
    for key, value in overrides.items():
        command.extend(["-c", key + "=" + ("{}" if isinstance(value, dict) else json.dumps(value))])
    command.append("Runtime hook smoke. Only apply the local fixture patch to " + PROBE
                   + ". Do not run commands, manually format, edit other files, install, mutate Git, delegate or publish.")
    try:
        version = subprocess.run([cli, "--version"], env=environment, capture_output=True, text=True, timeout=10).stdout.strip()
        result = subprocess.run(command, cwd=REPOSITORY, env=environment, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=60)
        (root / "runtime.stdout").write_text(result.stdout)
        (root / "runtime.stderr").write_text(result.stderr)
        events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
        changes = [event["item"] for event in events if event.get("type") == "item.completed"
                   and event.get("item", {}).get("type") == "file_change"]
        after = source_manifest()
        changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
        checks = {
            "runtimeSucceeded": result.returncode == 0,
            "nativeApplyPatchCompleted": len(changes) == 1 and changes[0].get("status") == "completed"
                and changes[0].get("changes") == [{"path": str(probe), "kind": "update"}],
            "formattedByHook": probe.read_text() == EXPECTED,
            "unrelatedSourcePreserved": not changed,
            "localFixtureUsed": len(requests) == 2,
        }
        return {"ok": all(checks.values()), "cliVersion": version, "trust": trust,
                "runtimeExit": result.returncode, "checks": checks, "changedSourceFiles": changed,
                "loopbackRequests": len(requests), "modelResponseSource": "local deterministic Responses SSE fixture"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        # Не удаляем неожиданно изменённый другим процессом файл.
        if probe.is_file() and probe.read_text() in {SOURCE, EDITED, EXPECTED}:
            probe.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True, help="Путь к официальному установленному Codex CLI")
    parser.add_argument("--keep-artifacts", action="store_true", help="Сохранить синтетические логи во временном каталоге")
    args = parser.parse_args()
    cli = shutil.which(args.cli)
    if not cli:
        parser.error("Codex CLI не найден. Установите его отдельно из официального источника.")
    root = Path(tempfile.mkdtemp(prefix="sandbox-codex-hook-runtime-"))
    try:
        result = verify(cli, root)
        if args.keep_artifacts:
            result["artifacts"] = str(root)
        print(json.dumps(result))
        return 0 if result["ok"] else 1
    except Exception as error:
        print(json.dumps({"ok": False, "errorType": type(error).__name__, "error": str(error),
                          "artifacts": str(root) if args.keep_artifacts else None}))
        return 1
    finally:
        if not args.keep_artifacts:
            shutil.rmtree(root)


if __name__ == "__main__":
    raise SystemExit(main())
