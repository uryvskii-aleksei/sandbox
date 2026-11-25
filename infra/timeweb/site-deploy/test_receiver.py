import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import receiver
from package import package

REPOSITORY = Path(__file__).resolve().parents[3]
COMMIT = "a" * 40
OTHER = "b" * 40


def template(app="purpur"):
    return json.loads((REPOSITORY / "apps" / app / "deploy/timeweb.json").read_text())


def snapshot(directory):
    return {p.relative_to(directory).as_posix(): p.read_bytes() for p in directory.rglob("*") if p.is_file() and not p.is_symlink()}


class SiteDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sandbox-sites-receiver-")
        self.root = Path(self.temporary.name).resolve()
        self.home = self.root / "cj999935"
        self.common = self.home / "public_html"
        self.public = self.common / "purpur"
        self.common.mkdir(parents=True, mode=0o700)
        self.common.chmod(0o700)
        for path, data in {
            "index.html": "Keep old root Purpur homepage",
            ".htaccess": "Keep old root rewrite rules",
            "styles.css": "Keep old root Purpur CSS",
            "assets/legacy.js": "Keep old root Purpur asset",
            "concept/index.html": "Keep old root Purpur concept",
            "old-file.txt": "Keep stale files",
            "purpur/index.html": "Original homepage",
            "purpur/styles.css": "Original CSS",
            "purpur/v1/index.html": "Keep Purpur v1",
            "purpur/v2/index.html": "Keep Purpur v2",
            "purpur/v3/index.html": "Keep Purpur v3",
            "purpur/old-file.txt": "Keep stale app file",
            "memo/index.html": "Keep Memo",
            "memo/config.local.php": "Synthetic unrelated config",
            "stonehaus/index.html": "Keep Stonehaus selector",
            "stonehaus/styles.css": "Keep Stonehaus selector CSS",
            "stonehaus/v1/index.html": "Keep Stonehaus",
            "stonehaus/v2/index.html": "Keep Stonehaus v2",
            "stonehaus/v3/index.html": "Keep Stonehaus v3",
        }.items():
            destination = self.common / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(data)
        self.public.chmod(0o700)

    def tearDown(self):
        self.temporary.cleanup()

    def deployment(self, app="purpur"):
        target = template(app)
        target["publicPath"] = str(self.common / app)
        deployment = receiver.Deployment(self.home, target)
        deployment.initialize()
        deployment.verify = lambda manifest, digest: None
        return deployment

    def prepared(self, app="purpur"):
        target = template(app)
        source = self.root / (app + "-source")
        source.mkdir()
        names = set(target["requiredFiles"]) | {item["file"] for item in target["checks"] if "file" in item}
        names.add("assets/new.js" if app == "purpur" else "v2/new.js")
        for name in names:
            destination = source / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text("<?php\n" if name.endswith(".php") else "New content: " + name)
        archive = self.root / (app + ".tar.gz")
        metadata = package(source, archive, target, COMMIT)
        stage = self.root / (app + "-stage")
        stage.mkdir()
        manifest = receiver.extract_artifact(archive, stage, target, COMMIT, metadata["sha256"])
        return source, archive, metadata, stage, manifest

    def malformed(self, members):
        path = self.root / "bad.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, content, kind in members:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        return path, receiver.sha256(path)

    def test_destinations_cannot_expand_to_sibling_apps_or_arbitrary_commands(self):
        for app in ["purpur", "stonehaus"]:
            self.assertEqual(receiver.validate_target(template(app))["app"], app)
        for change in [
            {"publicPath": "/home/c/cj999935"},
            {"publicPath": "/home/c/cj999935/public_html"},
            {"publicPath": "/home/c/cj999935/public_html/memo"},
            {"publicPath": "/home/c/cj999935/public_html/stonehaus"},
            {"sshHost": "-oProxyCommand=unsafe"},
            {"user": "name;unsafe"},
            {"ownedDirectories": ["assets", "memo"]},
            {"ownedDirectories": ["assets", "purpur"]},
            {"ownedFiles": ["config.local.php"]},
            {"url": "https://user:password@example.test/"},
            {"url": "https://example.test/other/"},
            {"url": "https://example.test/purpur/"},
            {"url": "https://amodu.ru/purpur/"},
            {"url": "https://cj999935.tw1.ru/"},
            {"url": "https://cj999935.tw1.ru/purpur/purpur/"},
        ]:
            with self.subTest(change=change), self.assertRaises((receiver.SiteError, ValueError)):
                receiver.validate_target({**template(), **change})
        with self.assertRaises(receiver.SiteError):
            receiver.validate_target({**template("stonehaus"), "publicPath": "/home/c/cj999935/public_html"})
        for name in ["app.js", ".htaccess", "order.php", "config.local.php"]:
            with self.subTest(file=name), self.assertRaises(receiver.SiteError):
                receiver.validate_target({**template("stonehaus"), "ownedFiles": ["index.html", "styles.css", name]})

    def test_flattened_php_entry_points_keep_a_narrow_allowlist(self):
        for name in ["order.php", "cdek-points.php", "v1/order.php", "v1/cdek-points.php"]:
            self.assertEqual(receiver.allowed_path(template(), name), name)
        for name in ["purpur/v1/order.php", "v2/order.php", "v3/cdek-points.php", "v1/unsafe.php"]:
            with self.subTest(path=name), self.assertRaises(receiver.SiteError):
                receiver.allowed_path(template(), name)

    def test_packaging_is_deterministic_and_extraction_checks_every_file(self):
        source, archive, metadata, stage, manifest = self.prepared()
        os.utime(source / "index.html", (123456, 123456))
        second = self.root / "second.gz"
        self.assertEqual(package(source, second, template(), COMMIT), metadata)
        self.assertEqual(second.read_bytes(), archive.read_bytes())
        self.assertEqual(snapshot(source), snapshot(stage))
        self.assertEqual(set(manifest["files"]), set(snapshot(source)))

    def test_private_paths_traversal_and_symlinks_are_rejected_before_publication(self):
        for name in ["../outside", "/index.html", "assets/../outside", "assets/.env", "assets/config.local.php", "assets/private.key", "memo/index.html", "stonehaus/v1/index.html", "purpur/v1/index.html", "release-purpur.json", "assets/unsafe.php"]:
            with self.subTest(path=name), self.assertRaises(receiver.SiteError):
                receiver.allowed_path(template(), name)
        source, _, _, _, _ = self.prepared()
        (source / "assets" / "symlink.js").symlink_to(source / "index.html")
        with self.assertRaisesRegex(receiver.SiteError, "symlinks"):
            package(source, self.root / "symlink.gz", template(), COMMIT)

    def test_archive_links_duplicates_wrong_checksum_and_limits_are_rejected(self):
        stage = self.root / "bad-stage"
        stage.mkdir()
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE]:
            archive, digest = self.malformed([("site/assets/link.js", b"", kind)])
            with self.assertRaisesRegex(receiver.SiteError, "regular"):
                receiver.extract_artifact(archive, stage, template(), COMMIT, digest)
        archive, digest = self.malformed([("site/index.html", b"hello", tarfile.REGTYPE)] * 2)
        with self.assertRaisesRegex(receiver.SiteError, "checksum"):
            receiver.extract_artifact(archive, stage, template(), COMMIT, "0" * 64)
        with self.assertRaisesRegex(receiver.SiteError, "Duplicate"):
            receiver.extract_artifact(archive, stage, template(), COMMIT, digest)
        with patch.object(receiver, "MAX_FILE", 1), self.assertRaisesRegex(receiver.SiteError, "bounded"):
            receiver.extract_artifact(archive, stage, template(), COMMIT, digest)

    def test_a_foreign_or_incomplete_manifest_is_not_a_site_artifact(self):
        metadata = json.dumps({"version": 1, "app": "mind-assistant", "commit": COMMIT, "files": {"index.html": hashlib.sha256(b"hello").hexdigest()}}).encode()
        archive, digest = self.malformed([("manifest.json", metadata, tarfile.REGTYPE), ("site/index.html", b"hello", tarfile.REGTYPE)])
        stage = self.root / "bad-stage"
        stage.mkdir()
        with self.assertRaisesRegex(receiver.SiteError, "application/source"):
            receiver.extract_artifact(archive, stage, template(), COMMIT, digest)

    def test_plan_does_not_create_backups_or_change_any_public_files(self):
        deployment = self.deployment()
        before = snapshot(self.public)
        _, _, _, _, manifest = self.prepared()
        result = deployment.plan(manifest)
        self.assertIn("index.html", result["changedFiles"])
        self.assertEqual(snapshot(self.public), before)
        self.assertEqual(list((deployment.root / "backups").iterdir()), [])
        self.assertFalse((self.public / deployment.marker).exists())

    def test_success_only_updates_owned_files_and_retains_real_common_root(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        unrelated = {name: data for name, data in snapshot(self.common).items() if not name.startswith("purpur/")}
        result = deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual(result["status"], "published")
        self.assertEqual((self.public / "index.html").read_bytes(), (stage / "index.html").read_bytes())
        for name, data in unrelated.items():
            self.assertEqual((self.common / name).read_bytes(), data)
        self.assertEqual((self.public / "old-file.txt").read_text(), "Keep stale app file")
        self.assertEqual(self.common.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.public.stat().st_mode & 0o777, 0o700)
        self.assertFalse(self.public.is_symlink())
        self.assertEqual(deployment.current()["deploymentStatus"], "ready")
        backup = deployment.root / "backups" / result["backup"]
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        with tarfile.open(backup, "r:gz") as archive:
            self.assertEqual(archive.extractfile("index.html").read(), b"Original homepage")
            self.assertNotIn("memo/index.html", archive.getnames())
            self.assertNotIn("stonehaus/v1/index.html", archive.getnames())

    def test_stonehaus_cannot_change_purpur_memo_or_the_legacy_root(self):
        deployment = self.deployment("stonehaus")
        _, _, metadata, stage, manifest = self.prepared("stonehaus")
        homepage = (self.common / "index.html").read_bytes()
        purpur = snapshot(self.public)
        memo = snapshot(self.common / "memo")
        deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual((self.common / "index.html").read_bytes(), homepage)
        self.assertEqual(snapshot(self.public), purpur)
        self.assertEqual(snapshot(self.common / "memo"), memo)
        self.assertEqual((deployment.public / "index.html").read_bytes(), (stage / "index.html").read_bytes())
        self.assertEqual((deployment.public / "styles.css").read_bytes(), (stage / "styles.css").read_bytes())
        self.assertEqual((deployment.public / "v3/index.html").read_bytes(), (stage / "v3/index.html").read_bytes())

    def test_backup_failure_stops_before_any_public_write(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        before = snapshot(self.public)
        with patch.object(deployment, "backup", side_effect=receiver.SiteError("Backup failure")), self.assertRaisesRegex(receiver.SiteError, "Backup failure"):
            deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual(snapshot(self.public), before)

    def test_a_failed_new_backup_does_not_destroy_an_existing_backup(self):
        deployment = self.deployment()
        _, _, _, _, manifest = self.prepared()
        with patch.object(receiver.time, "time", return_value=12345), patch.object(receiver.uuid, "uuid4", return_value=SimpleNamespace(hex="f" * 32)):
            archive, _ = deployment.backup(["index.html"], manifest)
            previous_bytes = archive.read_bytes()
            previous_metadata = archive.with_suffix(".json").read_bytes()
            with self.assertRaisesRegex(receiver.SiteError, "backup failed"):
                deployment.backup(["index.html"], manifest)
        self.assertEqual(archive.read_bytes(), previous_bytes)
        self.assertEqual(archive.with_suffix(".json").read_bytes(), previous_metadata)

    def test_failed_https_restores_old_bytes_modes_marker_and_removes_only_new_files(self):
        deployment = self.deployment()
        (self.public / "styles.css").chmod(0o600)
        previous = {"version": 1, "app": "purpur", "commit": OTHER, "artifactSha256": "e" * 64, "deploymentStatus": "ready"}
        (self.public / deployment.marker).write_text(json.dumps(previous))
        _, _, metadata, stage, manifest = self.prepared()
        before = snapshot(self.public)
        deployment.verify = lambda manifest, digest: (_ for _ in ()).throw(receiver.SiteError("HTTP 500"))
        with self.assertRaisesRegex(receiver.SiteError, "file changes were restored"):
            deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual(snapshot(self.public), before)
        self.assertEqual((self.public / "styles.css").stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.public / "assets/new.js").exists())

    def test_public_symlink_escape_is_rejected_and_the_target_is_preserved(self):
        deployment = self.deployment()
        _, _, _, _, manifest = self.prepared()
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "new.js").write_text("Private unrelated file")
        (self.public / "assets").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(receiver.SiteError, "symlink"):
            deployment.plan(manifest)
        self.assertEqual((outside / "new.js").read_text(), "Private unrelated file")

    def test_retry_is_idempotent_and_a_different_artifact_for_the_same_source_is_rejected(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        deployment.publish(stage, manifest, metadata["sha256"])
        with patch.object(deployment, "backup", side_effect=AssertionError("Unexpected backup")):
            result = deployment.publish(stage, manifest, metadata["sha256"])
            self.assertEqual(result["status"], "already-current")
            with self.assertRaisesRegex(receiver.SiteError, "different artifact"):
                deployment.publish(stage, manifest, "d" * 64)

    def test_a_manual_edit_after_backup_is_not_overwritten(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        original = deployment.backup
        def backup(names, data):
            result = original(names, data)
            (self.public / "index.html").write_text("Manual edit during release")
            return result
        deployment.backup = backup
        with self.assertRaisesRegex(receiver.SiteError, "destination changed"):
            deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual((self.public / "index.html").read_text(), "Manual edit during release")

    def test_rollback_preserves_a_newer_manual_edit_instead_of_destroying_it(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        def fail(manifest, digest):
            (self.public / "index.html").write_text("Manual intervention after publication")
            raise receiver.SiteError("Verification failed")
        deployment.verify = fail
        with self.assertRaisesRegex(receiver.SiteError, "externally changed"):
            deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual((self.public / "index.html").read_text(), "Manual intervention after publication")
        self.assertEqual((self.public / "styles.css").read_text(), "Original CSS")

    def test_a_marker_changed_during_verification_is_not_promoted_or_overwritten(self):
        deployment = self.deployment()
        _, _, metadata, stage, manifest = self.prepared()
        before = snapshot(self.public)
        manual = (json.dumps({"version": 1, "app": "purpur", "commit": OTHER, "artifactSha256": "f" * 64, "deploymentStatus": "verifying", "manual": True}) + "\n").encode()
        def intervene(manifest, digest):
            (self.public / deployment.marker).write_bytes(manual)
        deployment.verify = intervene
        with self.assertRaisesRegex(receiver.SiteError, "externally changed"):
            deployment.publish(stage, manifest, metadata["sha256"])
        self.assertEqual(snapshot(self.public), {**before, deployment.marker: manual})
        self.assertEqual(json.loads((self.public / deployment.marker).read_text())["deploymentStatus"], "verifying")

    def test_https_requests_use_the_selected_app_mount_or_the_common_origin(self):
        for app in ["purpur", "stonehaus"]:
            deployment = self.deployment(app)
            requested = []
            response = MagicMock()
            response.__enter__.return_value = response
            response.code = 200
            response.read.return_value = b"Verified response"
            def open_request(request, timeout):
                requested.append(request.full_url)
                response.geturl.return_value = request.full_url
                return response
            with patch.object(receiver.urllib.request, "urlopen", side_effect=open_request):
                deployment.request("v1/", COMMIT)
                deployment.request("memo/api/health", COMMIT, common=True)
            self.assertEqual([receiver.urlparse(url).path for url in requested], [f"/{app}/v1/", "/memo/api/health"])
            for url in requested:
                parsed = receiver.urlparse(url)
                self.assertEqual((parsed.scheme, parsed.netloc), ("https", "cj999935.tw1.ru"))
                self.assertIn("release=" + COMMIT, parsed.query)
            response.geturl.return_value = "https://other.test/"
            with patch.object(receiver.urllib.request, "urlopen", return_value=response), self.assertRaisesRegex(receiver.SiteError, "outside"):
                deployment.request("", COMMIT)

    def test_neighbour_checks_include_memo_and_the_other_site_selector_and_versions(self):
        for app, neighbour in [("purpur", "stonehaus"), ("stonehaus", "purpur")]:
            deployment = self.deployment(app)
            paths = ["memo/api/health", f"{neighbour}/", *(f"{neighbour}/{version}/" for version in ["v1", "v2", "v3"])]
            calls = []
            def response(path, commit, common=False):
                self.assertTrue(common)
                self.assertEqual(commit, COMMIT)
                calls.append(path)
                if path == "memo/api/health":
                    return 200, b'{"ok":true,"data":{"status":"ready"}}'
                return 200, (self.common / path / "index.html").read_bytes()
            with patch.object(deployment, "request", side_effect=response):
                deployment.verify_neighbours(COMMIT)
            self.assertEqual(calls, paths)
            for broken in paths[1:]:
                def changed(path, commit, common=False):
                    return (200, b"Wrong application HTML") if path == broken else response(path, commit, common)
                with self.subTest(app=app, broken=broken), patch.object(deployment, "request", side_effect=changed), self.assertRaisesRegex(receiver.SiteError, "neighbouring site"):
                    deployment.verify_neighbours(COMMIT)

    def test_missing_neighbour_selector_blocks_checks_until_the_explicit_bootstrap(self):
        deployment = self.deployment()
        selector = self.common / "stonehaus/index.html"
        selector.unlink()
        before = snapshot(self.common)
        def response(path, commit, common=False):
            self.assertTrue(common)
            if path == "memo/api/health":
                return 200, b'{"ok":true,"data":{"status":"ready"}}'
            page = self.common / path / "index.html"
            return (200, page.read_bytes()) if page.is_file() else (404, b"Not installed")
        with patch.object(deployment, "request", side_effect=response):
            with self.assertRaisesRegex(receiver.SiteError, "neighbouring site"):
                deployment.verify_neighbours(COMMIT)
            self.assertEqual(snapshot(self.common), before)
            selector.write_bytes(b"Explicitly prepared Stonehaus selector")
            deployment.verify_neighbours(COMMIT)

    def test_https_verification_requires_actual_bytes_and_exact_marker(self):
        deployment = receiver.Deployment(self.home, {**template(), "publicPath": str(self.public)})
        _, _, metadata, stage, manifest = self.prepared()
        marker = {"version": 1, "app": "purpur", "commit": COMMIT, "artifactSha256": metadata["sha256"], "deploymentStatus": "verifying"}
        checks = {item["path"]: item for item in deployment.target["checks"]}
        calls = []
        def response(path, commit, common=False):
            calls.append(path)
            if common:
                if path == "memo/api/health":
                    return 200, b'{"ok":true,"data":{"status":"ready"}}'
                return 200, (self.common / path / "index.html").read_bytes()
            if path == deployment.marker:
                return 200, json.dumps(marker).encode()
            check = checks[path]
            return check["status"], (stage / check["file"]).read_bytes() if "file" in check else b'{"ok":false}'
        deployment.request = response
        deployment.verify(manifest, metadata["sha256"])
        self.assertIn("order.php", calls)
        self.assertIn("cdek-points.php", calls)
        with patch.object(deployment, "request", return_value=(200, b"Cached old HTML")), self.assertRaisesRegex(receiver.SiteError, "checksum mismatch"):
            deployment.verify(manifest, metadata["sha256"])
        def broken_neighbour(path, commit, common=False):
            if common and path == "memo/api/health":
                return 200, b"Incorrectly rewritten to the homepage"
            return response(path, commit, common)
        with patch.object(deployment, "request", side_effect=broken_neighbour), self.assertRaisesRegex(receiver.SiteError, "neighbouring application"):
            deployment.verify(manifest, metadata["sha256"])
        marker["artifactSha256"] = "f" * 64
        with self.assertRaisesRegex(receiver.SiteError, "release marker"):
            deployment.verify(manifest, metadata["sha256"])


if __name__ == "__main__":
    unittest.main()
