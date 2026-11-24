"""Timeweb забирает опубликованный артефакт без SSH-секретов в GitHub."""

import fcntl
import json
from pathlib import Path
import re
import tempfile
import time
import urllib.error
import urllib.request

from receiver import Deployment, DeployError, MAX_ARCHIVE, extract_artifact, validate_commit

RAW_ROOT = "https://raw.githubusercontent.com/uryvskii-aleksei/sandbox/refs/heads/deploy/mind-assistant/"
API_ROOT = "https://api.github.com/repos/uryvskii-aleksei/sandbox/"


def download(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "Sandbox-MindAssistant-Deploy/1", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise DeployError("Published response exceeds its size limit.")
        return data


def validate_metadata(data):
    if not isinstance(data, dict) or set(data) != {"version", "app", "commit", "sha256", "artifact"}:
        raise DeployError("Invalid published deployment metadata.")
    if data["version"] != 1 or data["app"] != "mind-assistant":
        raise DeployError("Published metadata belongs to another application.")
    validate_commit(data["commit"])
    if data["artifact"] != "mind-assistant-" + data["commit"] + ".tar.gz" or not re.fullmatch(r"[a-f0-9]{64}", data["sha256"]):
        raise DeployError("Invalid immutable artifact identity.")
    return data


def verified_ci(data, commit):
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise DeployError("Invalid CI response.")
    run = next((item for item in data["workflow_runs"] if isinstance(item, dict) and
                item.get("head_sha") == commit and item.get("head_branch") == "main" and item.get("event") == "push"), None)
    if not run or run.get("status") != "completed" or run.get("conclusion") != "success":
        raise DeployError("The latest main push CI for this commit has not succeeded.")


def pull(home):
    deployment = Deployment(home)
    deployment.initialize()
    with (deployment.root / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return None
        try:
            raw = download(RAW_ROOT + "deployment.json?check=" + str(int(time.time())), 8192)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise
        metadata = validate_metadata(json.loads(raw))
        current = deployment.current()
        if current and current.get("commit") == metadata["commit"] and current.get("artifactSha256") == metadata["sha256"] and current.get("deploymentStatus") == "ready":
            return None
        ci = download(API_ROOT + "actions/workflows/harness.yml/runs?head_sha=" + metadata["commit"] + "&event=push&per_page=20", 1024 * 1024)
        verified_ci(json.loads(ci), metadata["commit"])
        with tempfile.TemporaryDirectory(prefix="pull-", dir=deployment.root) as temporary:
            root = Path(temporary)
            archive = root / "artifact.tar.gz"
            archive.write_bytes(download(RAW_ROOT + metadata["artifact"], MAX_ARCHIVE))
            stage = root / "site"
            stage.mkdir()
            extract_artifact(archive, stage, metadata["commit"], metadata["sha256"])
            deployment.lint(stage)
            return deployment.publish(stage, metadata["commit"], metadata["sha256"])


if __name__ == "__main__":
    try:
        result = pull(Path.home())
        if result:
            print(json.dumps({"ok": True, **result}))
    except Exception as error:
        message = str(error) if isinstance(error, DeployError) else "Deployment pull failed: " + type(error).__name__
        print(json.dumps({"ok": False, "error": message}))
        raise SystemExit(1)
