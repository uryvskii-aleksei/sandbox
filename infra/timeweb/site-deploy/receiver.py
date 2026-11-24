"""Scoped-поставка Purpur/Stonehaus без замены общего document root."""

import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
import uuid

MAX_ARCHIVE = 160 * 1024 * 1024
MAX_TOTAL = 192 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024
MAX_FILES = 2000
FIELDS = {"version", "app", "user", "sshHost", "publicPath", "url", "ownedFiles", "ownedDirectories", "requiredFiles", "checks"}
EXTENSIONS = {".html", ".css", ".js", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".ttf", ".woff", ".woff2", ".otf", ".eot", ".mp4", ".webm", ".mp3", ".wav", ".txt", ".xml", ".avif"}


class SiteError(RuntimeError):
    pass


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(131072):
            result.update(chunk)
    return result.hexdigest()


def validate_identity(commit, digest=None):
    if not isinstance(commit, str) or not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise SiteError("Expected an exact source commit SHA.")
    if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
        raise SiteError("Expected an artifact SHA-256.")


def normal_path(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise SiteError("Invalid public artifact path.")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise SiteError("Artifact paths must be relative and normalized.")
    for index, part in enumerate(parts):
        if part.startswith(".") and not (part == ".htaccess" and index == len(parts) - 1):
            raise SiteError("Private files cannot enter a public artifact.")
        if re.match(r"^(?:config(?:\.|$)|id_rsa|id_ed25519|node_modules$)", part, re.I):
            raise SiteError("Private configuration or dependencies cannot enter a public artifact.")
    return parts


def allowed_path(target, name):
    parts = normal_path(name)
    if name in {"release.json", "release-purpur.json"}:
        raise SiteError("Release markers are created by the receiver.")
    if name not in target["ownedFiles"] and not (len(parts) > 1 and parts[0] in target["ownedDirectories"]):
        raise SiteError("Artifact path is outside the selected application's ownership: " + name)
    if name.endswith(".php"):
        if target["app"] != "purpur" or name not in {"order.php", "cdek-points.php", "purpur/v1/order.php", "purpur/v1/cdek-points.php"}:
            raise SiteError("Unexpected PHP entry point in the artifact.")
    elif parts[-1] != ".htaccess" and PurePosixPath(name).suffix.lower() not in EXTENSIONS:
        raise SiteError("Unsupported artifact file type.")
    return name


def validate_target(target, home=None):
    if not isinstance(target, dict) or set(target) != FIELDS or type(target["version"]) is not int or target["version"] != 1:
        raise SiteError("Invalid site destination manifest.")
    app = target["app"]
    if app not in ("purpur", "stonehaus") or not isinstance(target["user"], str) or not re.fullmatch(r"[a-z][a-z0-9]*", target["user"]):
        raise SiteError("Invalid application/account identity.")
    if not isinstance(target["sshHost"], str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", target["sshHost"]):
        raise SiteError("Invalid SSH alias.")
    account = Path(home) if home is not None else Path("/home") / target["user"][0] / target["user"]
    public = account / "public_html"
    if app == "stonehaus":
        public /= "stonehaus"
    if target["publicPath"] != str(public) or account.name != target["user"]:
        raise SiteError("The destination is not this application's configured account directory.")
    url = urlparse(target["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.port or url.query or url.fragment or url.path != ("/" if app == "purpur" else "/stonehaus/"):
        raise SiteError("Expected the selected application's HTTPS base URL.")
    for key in ("ownedFiles", "ownedDirectories", "requiredFiles"):
        if not isinstance(target[key], list) or not all(isinstance(name, str) for name in target[key]) or len(target[key]) != len(set(target[key])):
            raise SiteError("Invalid or duplicate file ownership entries.")
    permitted = {"assets", "concept", "purpur"} if app == "purpur" else {"v1", "v2", "v3"}
    if not set(target["ownedDirectories"]).issubset(permitted) or (app == "stonehaus" and target["ownedFiles"]):
        raise SiteError("The site cannot own sibling applications or the common document root.")
    for name in target["ownedFiles"]:
        if len(normal_path(name)) != 1:
            raise SiteError("Root file ownership must name individual files.")
        allowed_path(target, name)
    for name in target["requiredFiles"]:
        allowed_path(target, name)
    if not target["requiredFiles"] or not isinstance(target["checks"], list) or not target["checks"]:
        raise SiteError("Required files and concrete HTTPS checks are missing.")
    for check in target["checks"]:
        if not isinstance(check, dict) or set(check) not in ({"path", "status"}, {"path", "status", "file"}):
            raise SiteError("Invalid HTTPS check.")
        if not isinstance(check["path"], str) or check["status"] not in (200, 400, 405):
            raise SiteError("Only explicit safe GET checks are supported.")
        if check["path"]:
            normal_path(check["path"].removesuffix("/"))
        if "file" in check:
            allowed_path(target, check["file"])
            if check["status"] != 200:
                raise SiteError("A public file check must expect HTTP 200.")
    return target


def extract_artifact(archive_path, destination, target, commit, digest):
    validate_identity(commit, digest)
    if archive_path.stat().st_size > MAX_ARCHIVE or sha256(archive_path) != digest:
        raise SiteError("Artifact size or checksum mismatch.")
    files = {}
    manifest = None
    total = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            if not member.isfile() or member.size < 0 or member.size > MAX_FILE:
                raise SiteError("Artifact entries must be bounded regular files.")
            total += member.size
            if total > MAX_TOTAL or len(files) >= MAX_FILES:
                raise SiteError("Unpacked artifact exceeds its limits.")
            if member.name == "manifest.json":
                if manifest is not None or member.size > 1024 * 1024:
                    raise SiteError("Duplicate or oversized artifact manifest.")
                manifest = json.loads(archive.extractfile(member).read())
                continue
            if not member.name.startswith("site/"):
                raise SiteError("Unexpected archive namespace.")
            name = allowed_path(target, member.name[5:])
            if name in files:
                raise SiteError("Duplicate artifact entry.")
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(member).read(member.size + 1)
            if len(data) != member.size:
                raise SiteError("Truncated artifact entry.")
            path.write_bytes(data)
            path.chmod(0o644)
            files[name] = hashlib.sha256(data).hexdigest()
    if not isinstance(manifest, dict) or type(manifest.get("version")) is not int or manifest != {"version": 1, "app": target["app"], "commit": commit, "files": files}:
        raise SiteError("The artifact manifest does not match its verified files/application/source.")
    if not set(target["requiredFiles"]).issubset(files) or any(check.get("file") not in files for check in target["checks"] if "file" in check):
        raise SiteError("Incomplete application artifact.")
    return manifest


class Deployment:
    def __init__(self, home, target):
        self.home = Path(home).resolve()
        self.target = validate_target(target, self.home)
        self.app = target["app"]
        self.root = self.home / ".sandbox" / "site-deploy" / self.app
        self.public = Path(target["publicPath"])
        self.marker = "release-purpur.json" if self.app == "purpur" else "release.json"

    def initialize(self):
        common_public = self.home / "public_html"
        if common_public.is_symlink() or not common_public.is_dir() or self.public.is_symlink() or not self.public.is_dir():
            raise SiteError("Expected the existing actual public site directory.")
        for path in [self.home / ".sandbox", self.root.parent, self.root, self.root / "backups"]:
            if path.is_symlink():
                raise SiteError("Private deployment directories cannot be symlinks.")
            path.mkdir(mode=0o700, exist_ok=True)
            path.chmod(0o700)

    def destination(self, name, marker=False):
        if not (marker and name == self.marker):
            allowed_path(self.target, name)
        path = self.public
        for part in normal_path(name):
            path /= part
            if path.is_symlink():
                raise SiteError("Refusing a symlink in a public destination path.")
        if path.exists() and not path.is_file():
            raise SiteError("A destination file conflicts with an existing directory.")
        return path

    def current(self):
        path = self.destination(self.marker, marker=True)
        if not path.exists():
            return None
        marker = json.loads(path.read_text())
        if marker.get("version") != 1 or marker.get("app") != self.app:
            raise SiteError("A release marker belongs to another application.")
        return marker

    def plan(self, manifest):
        changed = []
        for name, digest in manifest["files"].items():
            path = self.destination(name)
            if not path.exists() or sha256(path) != digest:
                changed.append(name)
        return {"status": "planned", "app": self.app, "commit": manifest["commit"], "destination": str(self.public), "files": len(manifest["files"]), "changedFiles": sorted(changed), "current": self.current()}

    def lint(self, stage):
        for path in sorted(stage.rglob("*.php")):
            result = subprocess.run(["php", "-d", "display_errors=0", "-l", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
            if result.returncode:
                raise SiteError("PHP syntax check failed.")

    def backup(self, names, manifest):
        identity = str(int(time.time())) + "-" + uuid.uuid4().hex[:8]
        archive_path = self.root / "backups" / (identity + ".tar.gz")
        metadata_path = archive_path.with_suffix(".json")
        records = []
        created_archive = False
        created_metadata = False
        try:
            with archive_path.open("xb") as raw:
                created_archive = True
                archive_path.chmod(0o600)
                with tarfile.open(fileobj=raw, mode="w:gz") as archive:
                    for name in [*names, self.marker]:
                        path = self.destination(name, marker=name == self.marker)
                        record = {"path": name, "existed": path.exists()}
                        if path.exists():
                            data = path.read_bytes()
                            record.update({"sha256": hashlib.sha256(data).hexdigest(), "mode": stat.S_IMODE(path.stat().st_mode)})
                            member = tarfile.TarInfo(name)
                            member.size = len(data)
                            member.mode = record["mode"]
                            archive.addfile(member, io.BytesIO(data))
                        records.append(record)
            metadata = {"version": 1, "app": self.app, "beforeCommit": manifest["commit"], "previous": self.current(), "files": records}
            with metadata_path.open("x") as output:
                created_metadata = True
                output.write(json.dumps(metadata, sort_keys=True) + "\n")
            metadata_path.chmod(0o600)
        except Exception:
            if created_archive:
                archive_path.unlink(missing_ok=True)
            if created_metadata:
                metadata_path.unlink(missing_ok=True)
            raise SiteError("Site backup failed; public files were not changed.")
        return archive_path, records

    def atomic_write(self, name, data, mode=0o644, marker=False):
        destination = self.destination(name, marker)
        parent = self.public
        for part in PurePosixPath(name).parts[:-1]:
            parent /= part
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise SiteError("Unsafe destination parent.")
            if not parent.exists():
                parent.mkdir(mode=0o755)
                parent.chmod(0o755)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".sandbox-deploy-", delete=False) as output:
                temporary = Path(output.name)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            temporary.chmod(mode)
            temporary.replace(destination)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def restore(self, backup, records, written):
        by_path = {item["path"]: item for item in records}
        conflicts = []
        with tarfile.open(backup, "r:gz") as archive:
            for name, expected in reversed(list(written.items())):
                path = self.destination(name, marker=name == self.marker)
                if not path.is_file() or sha256(path) != expected:
                    conflicts.append(name)
                    continue
                previous = by_path[name]
                if previous["existed"]:
                    data = archive.extractfile(name).read()
                    if hashlib.sha256(data).hexdigest() != previous["sha256"]:
                        raise SiteError("Backup content checksum mismatch.")
                    self.atomic_write(name, data, previous["mode"], marker=name == self.marker)
                else:
                    path.unlink()
        if conflicts:
            raise SiteError("Rollback preserved externally changed files; reconcile the private backup before retrying.")

    def request(self, path, commit, common=False):
        configured = urlparse(self.target["url"])
        base = configured.scheme + "://" + configured.netloc + "/" if common else self.target["url"]
        url = base + path + "?release=" + commit + "&check=" + str(time.time_ns())
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "Sandbox-Sites-Deploy/1"})
        try:
            response = urllib.request.urlopen(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError) as error:
            raise SiteError("HTTPS request failed at " + (path or "/") + ": " + type(error).__name__ + ".") from error
        with response:
            location = urlparse(response.geturl())
            if location.scheme != "https" or location.netloc != configured.netloc:
                raise SiteError("An HTTPS check redirected outside the configured hosting destination.")
            body = response.read(MAX_FILE + 1)
            if len(body) > MAX_FILE:
                raise SiteError("An HTTPS check exceeded its response limit.")
            return response.code, body

    def verify_neighbours(self, commit):
        # Общий .htaccess может сломать маршруты соседей, не изменяя их файлов.
        status, body = self.request("mind-assistant/api/health", commit, common=True)
        try:
            healthy = json.loads(body)
        except (ValueError, UnicodeError):
            healthy = {}
        data = healthy.get("data") if isinstance(healthy, dict) else None
        if status != 200 or not isinstance(healthy, dict) or healthy.get("ok") is not True or not isinstance(data, dict) or data.get("status") != "ready":
            raise SiteError("A protected neighbouring application (MindAssistant) failed its HTTPS health check.")
        relatives = ["stonehaus/v1/", "stonehaus/v2/", "stonehaus/v3/"] if self.app == "purpur" else [""]
        for relative in relatives:
            expected = self.home / "public_html" / relative / "index.html"
            status, body = self.request(relative, commit, common=True)
            if not expected.is_file() or status != 200 or hashlib.sha256(body).hexdigest() != sha256(expected):
                raise SiteError("A protected neighbouring site's HTTPS content changed at " + (relative or "/") + ".")

    def verify(self, manifest, digest):
        commit = manifest["commit"]
        for check in self.target["checks"]:
            status, body = self.request(check["path"], commit)
            if status != check["status"]:
                raise SiteError("HTTPS verification failed at " + (check["path"] or "/") + " HTTP " + str(status) + ".")
            if "file" in check and hashlib.sha256(body).hexdigest() != manifest["files"][check["file"]]:
                raise SiteError("Published file checksum mismatch at " + (check["path"] or "/") + ".")
        status, body = self.request(self.marker, commit)
        try:
            marker = json.loads(body)
        except (ValueError, UnicodeError) as error:
            raise SiteError("The public release marker is not JSON (HTTP " + str(status) + ").") from error
        if status != 200 or not isinstance(marker, dict) or marker.get("app") != self.app or marker.get("commit") != commit or marker.get("artifactSha256") != digest:
            raise SiteError("The public release marker does not match this artifact.")
        self.verify_neighbours(commit)

    def publish(self, stage, manifest, digest):
        plan = self.plan(manifest)
        current = plan["current"]
        if current and current.get("commit") == manifest["commit"] and current.get("artifactSha256") != digest:
            raise SiteError("This source commit already has a different artifact. Reconcile before retrying.")
        if current and current.get("commit") == manifest["commit"] and current.get("artifactSha256") == digest and current.get("deploymentStatus") == "ready" and not plan["changedFiles"]:
            self.verify(manifest, digest)
            return {"status": "already-current", "app": self.app, "commit": manifest["commit"], "changedFiles": []}
        backup, records = self.backup(plan["changedFiles"], manifest)
        before = {item["path"]: item for item in records}
        written = {}
        try:
            for name in [*plan["changedFiles"], self.marker]:
                old = self.destination(name, marker=name == self.marker)
                prior = before[name]
                if old.exists() != prior["existed"] or (old.exists() and sha256(old) != prior["sha256"]):
                    raise SiteError("The destination changed after backup; stopped before overwriting it.")
                if name == self.marker:
                    data = (json.dumps({"version": 1, "app": self.app, "commit": manifest["commit"], "artifactSha256": digest, "deploymentStatus": "verifying"}, sort_keys=True) + "\n").encode()
                else:
                    data = (stage / name).read_bytes()
                self.atomic_write(name, data, marker=name == self.marker)
                written[name] = hashlib.sha256(data).hexdigest()
            self.verify(manifest, digest)
            marker_path = self.destination(self.marker, marker=True)
            if not marker_path.is_file():
                raise SiteError("The release marker changed during verification; stopped before marking it ready.")
            marker_bytes = marker_path.read_bytes()
            if hashlib.sha256(marker_bytes).hexdigest() != written[self.marker]:
                raise SiteError("The release marker changed during verification; stopped before marking it ready.")
            marker = json.loads(marker_bytes)
            marker["deploymentStatus"] = "ready"
            ready_bytes = (json.dumps(marker, sort_keys=True) + "\n").encode()
            self.atomic_write(self.marker, ready_bytes, marker=True)
            written[self.marker] = hashlib.sha256(ready_bytes).hexdigest()
        except Exception as error:
            self.restore(backup, records, written)
            detail = " " + str(error) if isinstance(error, SiteError) else ""
            raise SiteError("Publication failed; this attempt's file changes were restored." + detail)
        return {"status": "published", "app": self.app, "commit": manifest["commit"], "changedFiles": plan["changedFiles"], "backup": backup.name, "url": self.target["url"]}


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("plan", "publish"):
        raise SiteError("Expected plan|publish COMMIT SHA256.")
    action, commit, digest = sys.argv[1:]
    validate_identity(commit, digest)
    target_path = Path(__file__).with_name("target.json")
    if target_path.is_symlink() or not target_path.is_file():
        raise SiteError("Expected an installed ordinary target.json file.")
    target = json.loads(target_path.read_text())
    deployment = Deployment(Path.home(), target)
    deployment.initialize()
    with (deployment.root.parent / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SiteError("Another site deployment is already running.")
        with tempfile.TemporaryDirectory(prefix="incoming-", dir=deployment.root) as temporary:
            directory = Path(temporary)
            archive = directory / "artifact.tar.gz"
            with archive.open("wb") as output:
                count = 0
                while chunk := sys.stdin.buffer.read(131072):
                    count += len(chunk)
                    if count > MAX_ARCHIVE:
                        raise SiteError("Incoming artifact exceeds its size limit.")
                    output.write(chunk)
            stage = directory / "site"
            stage.mkdir()
            manifest = extract_artifact(archive, stage, target, commit, digest)
            deployment.lint(stage)
            result = deployment.plan(manifest) if action == "plan" else deployment.publish(stage, manifest, digest)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, SiteError) else "Site deployment failed: " + type(error).__name__
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        raise SystemExit(1)
