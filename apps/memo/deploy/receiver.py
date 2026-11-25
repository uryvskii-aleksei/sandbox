"""Приёмник одного приложения. Устанавливается вне public_html и вызывается по SSH."""

import fcntl
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
import uuid

MAX_ARCHIVE = 32 * 1024 * 1024
MAX_FILE = 12 * 1024 * 1024
MAX_FILES = 512
REQUIRED = {
    "index.html", "api.php", ".htaccess", "release.json", "backend/.htaccess",
    "backend/api.php", "backend/bootstrap.php", "backend/cards.php", "backend/preview.php", "backend/workspace.php",
    "database/.htaccess", "database/migrate.php", "database/schema.sql",
}


class DeployError(RuntimeError):
    pass


def validate_commit(value):
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise DeployError("Expected an exact Git commit SHA.")


def validate_member_name(name):
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise DeployError("Invalid artifact path.")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise DeployError("Artifact paths must be relative and normalized.")
    top_files = {"index.html", "api.php", ".htaccess", "release.json", "config.example.php"}
    if name in top_files:
        return
    if len(parts) == 2 and parts[0] == "backend" and (
        parts[1] == ".htaccess" or re.fullmatch(r"[A-Za-z0-9_-]+\.php", parts[1])
    ):
        return
    if name in {"database/migrate.php", "database/schema.sql", "database/.htaccess"}:
        return
    if parts[0] == "assets" and len(parts) > 1 and not any(part.startswith(".") for part in parts):
        if PurePosixPath(name).suffix.lower() in {
            ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf",
        }:
            return
    raise DeployError("Unexpected or private file in artifact: " + name)


def extract_artifact(archive_path, destination, commit, digest):
    validate_commit(commit)
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise DeployError("Expected an artifact SHA-256.")
    if archive_path.stat().st_size > MAX_ARCHIVE:
        raise DeployError("Artifact exceeds its size limit.")
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != digest:
        raise DeployError("Artifact checksum mismatch.")
    names = set()
    total = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            validate_member_name(member.name)
            if not member.isfile() or member.name in names:
                raise DeployError("Artifact entries must be unique regular files.")
            total += member.size
            if member.size > MAX_FILE or total > MAX_ARCHIVE or len(names) >= MAX_FILES:
                raise DeployError("Unpacked artifact exceeds its limits.")
            names.add(member.name)
            path = destination / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(member).read(member.size + 1)
            if len(data) != member.size:
                raise DeployError("Truncated artifact entry.")
            path.write_bytes(data)
            path.chmod(0o644)
    if not REQUIRED.issubset(names):
        raise DeployError("Incomplete application artifact.")
    marker = json.loads((destination / "release.json").read_text())
    if marker != {"version": 1, "app": "mind-assistant", "commit": commit}:
        raise DeployError("Release marker does not match the requested application/commit.")
    marker["artifactSha256"] = digest
    marker["deploymentStatus"] = "verifying"
    (destination / "release.json").write_text(json.dumps(marker, sort_keys=True) + "\n")
    # Cron может использовать umask 077. Apache должен обходить публичные каталоги.
    destination.chmod(0o755)
    for directory in destination.rglob("*"):
        if directory.is_dir():
            directory.chmod(0o755)
    return names


class Deployment:
    def __init__(self, home):
        self.home = Path(home).resolve()
        self.root = self.home / ".sandbox" / "mind-assistant"
        self.public = self.home / "public_html" / "memo"
        self.config = self.root / "config.php"

    def initialize(self):
        if (self.home / "public_html").is_symlink() or not (self.home / "public_html").is_dir():
            raise DeployError("Expected the account's actual public_html directory.")
        for directory in [self.home / ".sandbox", self.root, self.root / "releases", self.root / "backups"]:
            if directory.is_symlink():
                raise DeployError("Deployment directories must not be symlinks.")
            directory.mkdir(mode=0o700, exist_ok=True)
            directory.chmod(0o700)
        if self.public.is_symlink():
            raise DeployError("The public application must be a real directory on this hosting.")
        if self.public.exists() and not (self.public / "release.json").is_file():
            raise DeployError("Refusing to overwrite an unmanaged application directory.")

    def run(self, args, label, **kwargs):
        kwargs.setdefault("timeout", 180)
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
        if result.returncode:
            # Не выводим командный stderr: конфигурация и реквизиты остаются на сервере.
            raise DeployError(label + " failed.")
        return result.stdout

    def current(self):
        path = self.public / "release.json"
        if not path.exists():
            return None
        marker = json.loads(path.read_text())
        if marker.get("app") != "mind-assistant":
            raise DeployError("Destination marker belongs to another application.")
        return marker

    def target_url(self):
        target = json.loads((self.root / "target.json").read_text())
        url = urlparse(target["url"])
        if target.get("version") != 1 or target.get("remoteRoot") != str(self.root) or target.get("publicPath") != str(self.public):
            raise DeployError("Server destination mapping does not match this account/application.")
        if url.scheme != "https" or url.hostname != f"{self.home.name}.tw1.ru" or url.username or url.password or url.port or url.query or url.fragment or url.path != "/memo/":
            raise DeployError("Invalid public application URL.")
        return target["url"]

    def lint(self, stage):
        for path in sorted(stage.rglob("*.php")):
            self.run(["php", "-d", "display_errors=0", "-l", str(path)], "PHP syntax check")

    def configuration(self):
        if not self.config.is_file() or self.config.is_symlink() or self.config.stat().st_mode & 0o077:
            raise DeployError("A private server config.php with mode 600 is required.")
        raw = self.run(["php", "-r", "echo json_encode(require $argv[1]);", str(self.config)], "Configuration read")
        config = json.loads(raw)
        for key in ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_PORT"]:
            if not isinstance(config.get(key), str) or not config[key]:
                raise DeployError("Incomplete server database configuration.")
        if config.get("APP_ENV") != "production" or not re.fullmatch(r"[A-Za-z0-9_]+", config["DB_NAME"]):
            raise DeployError("Invalid production database configuration.")
        expected = self.home.name + "_mindassistant"
        if config["DB_NAME"] != expected or config["DB_USER"] != expected:
            raise DeployError("The receiver requires the dedicated Memo database and user.")
        return config

    def backup(self, config, commit):
        identity = str(int(time.time())) + "-" + uuid.uuid4().hex[:8]
        output = self.root / "backups" / (identity + ".sql")
        def option(value):
            return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r") + '"'
        with tempfile.NamedTemporaryFile(mode="w", dir=self.root, prefix="mysql-", delete=False) as handle:
            login_file = Path(handle.name)
            handle.write("[client]\n" + "\n".join(
                name + "=" + option(config[key]) for name, key in [
                    ("host", "DB_HOST"), ("port", "DB_PORT"), ("user", "DB_USER"), ("password", "DB_PASSWORD"),
                ]
            ) + "\n")
        try:
            with output.open("xb") as handle:
                output.chmod(0o600)
                result = subprocess.run([
                    "mysqldump", "--defaults-extra-file=" + str(login_file), "--single-transaction",
                    "--no-tablespaces", "--skip-lock-tables", "--column-statistics=0", "--set-gtid-purged=OFF", "--hex-blob", config["DB_NAME"],
                ], stdout=handle, stderr=subprocess.PIPE, timeout=180)
            if result.returncode:
                output.unlink()
                raise DeployError("Database backup failed; publication stopped before migration.")
        except subprocess.TimeoutExpired:
            output.unlink(missing_ok=True)
            raise DeployError("Database backup timed out; publication stopped before migration.")
        finally:
            login_file.unlink(missing_ok=True)
        (output.with_suffix(".json")).write_text(json.dumps({"beforeCommit": commit, "previous": self.current()}) + "\n")
        return output.name

    def migrate(self, stage):
        local_config = stage / "config.local.php"
        # Веб-PHP Timeweb не читает файлы вне public_html даже при is_readable=true.
        # Источник остаётся приватным. Рабочая копия 600 защищена FilesMatch в .htaccess.
        local_config.write_bytes(self.config.read_bytes())
        local_config.chmod(0o600)
        self.run(["php", str(stage / "database" / "migrate.php")], "Database migration")

    def verify(self, commit, digest):
        public_url = self.target_url()
        checked_path = ""
        def request(relative):
            nonlocal checked_path
            checked_path = relative.split("?", 1)[0] or "/"
            request = urllib.request.Request(public_url + relative, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=12) as response:
                return response.status, response.read(1024 * 1024)
        last_error = None
        for attempt in range(5):
            try:
                status, body = request("release.json?release=" + commit)
                release = json.loads(body)
                if status != 200 or release.get("commit") != commit or release.get("artifactSha256") != digest:
                    raise DeployError("Public release marker mismatch.")
                if json.loads(request("api/health")[1]).get("data", {}).get("status") != "ready":
                    raise DeployError("Public API is not ready.")
                if request("")[0] != 200 or request("workplace/123")[0] != 200:
                    raise DeployError("Frontend or SPA route is unavailable.")
                for relative in ["config.local.php", "backend/bootstrap.php", "database/schema.sql"]:
                    try:
                        request(relative)
                    except urllib.error.HTTPError as error:
                        if error.code == 403:
                            continue
                    raise DeployError("A private application path is not protected.")
                return
            except Exception as error:
                last_error = error
                if attempt < 4:
                    time.sleep(1)
        code = " HTTP " + str(last_error.code) if isinstance(last_error, urllib.error.HTTPError) else " invalid response"
        raise DeployError("HTTPS verification failed at " + checked_path + code + ".") from last_error

    def publish(self, stage, commit, digest):
        previous = self.current()
        if previous and previous.get("commit") == commit:
            if previous.get("artifactSha256") != digest:
                raise DeployError("This commit already has a different artifact. Reconcile before retrying.")
            self.verify(commit, digest)
            self.mark_ready()
            return {"status": "already-current", "commit": commit}
        config = self.configuration()
        backup = self.backup(config, commit)
        self.migrate(stage)
        old = self.root / "releases" / ("previous-" + uuid.uuid4().hex)
        if self.public.exists():
            self.public.rename(old)
        try:
            stage.rename(self.public)
            self.verify(commit, digest)
            self.mark_ready()
        except Exception as error:
            if self.public.exists():
                self.public.rename(self.root / "releases" / ("failed-" + uuid.uuid4().hex))
            if old.exists():
                old.rename(self.public)
            detail = " " + str(error) if isinstance(error, DeployError) else ""
            raise DeployError("Publication failed; previous files restored. Database changes were not reversed." + detail)
        return {"status": "published", "commit": commit, "backup": backup, "url": self.target_url()}

    def mark_ready(self):
        marker = self.current()
        marker["deploymentStatus"] = "ready"
        temporary = self.public / "release.json.new"
        temporary.write_text(json.dumps(marker, sort_keys=True) + "\n")
        temporary.replace(self.public / "release.json")


def parse_command(argv):
    if len(argv) != 3 or argv[0] not in ("plan", "publish"):
        raise DeployError("Expected plan|publish COMMIT SHA256.")
    validate_commit(argv[1])
    if not re.fullmatch(r"[a-f0-9]{64}", argv[2]):
        raise DeployError("Expected an artifact SHA-256.")
    return argv


def main():
    action, commit, digest = parse_command(sys.argv[1:])
    deployment = Deployment(Path.home())
    deployment.initialize()
    with (deployment.root / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DeployError("Another deployment is already running.")
        with tempfile.TemporaryDirectory(prefix="incoming-", dir=deployment.root) as temporary:
            root = Path(temporary)
            archive = root / "artifact.tar.gz"
            with archive.open("wb") as output:
                size = 0
                while chunk := sys.stdin.buffer.read(65536):
                    size += len(chunk)
                    if size > MAX_ARCHIVE:
                        raise DeployError("Incoming artifact is too large.")
                    output.write(chunk)
            stage = root / "site"
            stage.mkdir()
            names = extract_artifact(archive, stage, commit, digest)
            deployment.lint(stage)
            if action == "plan":
                result = {"status": "planned", "commit": commit, "destination": str(deployment.public),
                          "files": sorted(names), "current": deployment.current(), "configured": deployment.config.is_file()}
            else:
                result = deployment.publish(stage, commit, digest)
            print(json.dumps({"ok": True, **result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, DeployError) else "Deployment failed: " + type(error).__name__
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        sys.exit(1)
