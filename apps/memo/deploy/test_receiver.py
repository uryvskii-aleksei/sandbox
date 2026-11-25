import hashlib
import io
import json
import os
import subprocess
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import receiver
import pull
from package import package

COMMIT = "a" * 40
OTHER = "b" * 40
DIGEST = "c" * 64


class FakeDeployment(receiver.Deployment):
    def __init__(self, home):
        super().__init__(home)
        self.calls = []
        self.failure = None

    def configuration(self):
        return {}

    def target_url(self):
        return "https://example.test/memo/"

    def backup(self, config, commit):
        self.calls.append("backup")
        if self.failure == "backup":
            raise receiver.DeployError("Backup failed")
        return "test.sql"

    def migrate(self, stage):
        self.calls.append("migrate")

    def verify(self, commit, digest):
        self.calls.append("verify")
        if self.failure == "verify":
            raise receiver.DeployError("Verification failed")


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sandbox-deploy-test-")
        self.root = Path(self.temporary.name)
        self.home = self.root / "cj999935"
        (self.home / "public_html").mkdir(parents=True)
        (self.home / "public_html" / "existing-site.txt").write_text("Keep this website")
        self.deployment = FakeDeployment(self.home)
        self.deployment.initialize()

    def tearDown(self):
        self.temporary.cleanup()

    def source(self):
        source = self.root / "source"
        source.mkdir(exist_ok=True)
        for name in receiver.REQUIRED - {"release.json"}:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("<?php\n" if name.endswith(".php") else "source")
        return source

    def archive(self, entries):
        output = self.root / "malformed.tar.gz"
        with tarfile.open(output, "w:gz") as archive:
            for name, content, kind in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        return output, hashlib.sha256(output.read_bytes()).hexdigest()

    def stage(self, commit=COMMIT):
        stage = self.deployment.root / ("stage-" + commit[0])
        stage.mkdir(exist_ok=True)
        (stage / "release.json").write_text(json.dumps({"app": "mind-assistant", "commit": commit, "artifactSha256": DIGEST}))
        (stage / "index.html").write_text(commit)
        return stage

    def installed(self):
        self.stage(OTHER).rename(self.deployment.public)

    def test_target_uses_memo_mount_and_preserves_legacy_private_storage(self):
        deployment = receiver.Deployment(self.home)
        target = {
            "version": 1,
            "remoteRoot": str(deployment.root),
            "publicPath": str(deployment.public),
            "url": "https://cj999935.tw1.ru/memo/",
        }
        manifest = deployment.root / "target.json"
        manifest.write_text(json.dumps(target))
        self.assertEqual(deployment.target_url(), target["url"])
        self.assertEqual(deployment.root, self.home.resolve() / ".sandbox" / "mind-assistant")
        self.assertEqual(deployment.public, self.home.resolve() / "public_html" / "memo")
        for change in [
            {"url": "https://another-account.tw1.ru/memo/"},
            {"url": "https://cj999935.tw1.ru/mind-assistant/"},
            {"publicPath": str(self.home / "public_html" / "mind-assistant")},
            {"remoteRoot": str(self.home / ".sandbox" / "memo")},
        ]:
            manifest.write_text(json.dumps({**target, **change}))
            with self.subTest(change=change), self.assertRaises(receiver.DeployError):
                deployment.target_url()

    def test_deterministic_package_and_verified_extraction(self):
        source = self.source()
        first, second = self.root / "first.gz", self.root / "second.gz"
        before = package(source, first, COMMIT)
        os.utime(source / "index.html", (123456, 123456))
        after = package(source, second, COMMIT)
        self.assertEqual(before, after)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        target = self.root / "extracted"
        target.mkdir()
        names = receiver.extract_artifact(first, target, COMMIT, before["sha256"])
        self.assertEqual(names, receiver.REQUIRED)
        self.assertEqual(json.loads((target / "release.json").read_text())["artifactSha256"], before["sha256"])

    def test_rejects_private_paths_traversal_and_symlinks(self):
        for name in ["../outside", "/index.html", "assets/../../x", ".env", "config.local.php", "assets/run.php", "database/backup.sql"]:
            with self.subTest(name=name), self.assertRaises(receiver.DeployError):
                receiver.validate_member_name(name)
        archive, digest = self.archive([("assets/link.js", b"", tarfile.SYMTYPE)])
        with self.assertRaises(receiver.DeployError):
            receiver.extract_artifact(archive, self.root / "extracted", COMMIT, digest)
        source = self.source()
        (source / "assets").mkdir()
        (source / "assets" / "link.js").symlink_to(source / "index.html")
        with self.assertRaises(ValueError):
            package(source, self.root / "package.gz", COMMIT)

    def test_extraction_makes_public_directories_traversable_under_private_cron_umask(self):
        source = self.source()
        (source / "assets" / "nested").mkdir(parents=True)
        (source / "assets" / "nested" / "index.js").write_text("source")
        archive = self.root / "release.gz"
        metadata = package(source, archive, COMMIT)
        previous = os.umask(0o077)
        try:
            stage = self.root / "stage"
            stage.mkdir()
            receiver.extract_artifact(archive, stage, COMMIT, metadata["sha256"])
        finally:
            os.umask(previous)
        for directory in [stage, *[p for p in stage.rglob("*") if p.is_dir()]]:
            self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
        self.assertEqual((stage / "index.html").stat().st_mode & 0o777, 0o644)

    def test_rejects_changed_checksum_duplicates_and_size_overflow(self):
        archive, digest = self.archive([("index.html", b"hello", tarfile.REGTYPE)] * 2)
        target = self.root / "extracted"
        target.mkdir()
        with self.assertRaisesRegex(receiver.DeployError, "checksum"):
            receiver.extract_artifact(archive, target, COMMIT, "0" * 64)
        with self.assertRaisesRegex(receiver.DeployError, "unique"):
            receiver.extract_artifact(archive, target, COMMIT, digest)
        with patch.object(receiver, "MAX_FILE", 1), self.assertRaisesRegex(receiver.DeployError, "limits"):
            receiver.extract_artifact(archive, target, COMMIT, digest)

    def test_publish_preserves_previous_release_and_sibling_site(self):
        legacy = self.home / "public_html" / "mind-assistant"
        legacy.mkdir()
        (legacy / "index.html").write_text("Preserve the previous public installation")
        self.installed()
        result = self.deployment.publish(self.stage(), COMMIT, DIGEST)
        self.assertEqual(result["status"], "published")
        self.assertEqual(self.deployment.calls, ["backup", "migrate", "verify"])
        self.assertEqual((legacy / "index.html").read_text(), "Preserve the previous public installation")
        self.assertEqual((self.deployment.public / "index.html").read_text(), COMMIT)
        previous = list((self.deployment.root / "releases").glob("previous-*"))
        self.assertEqual((previous[0] / "index.html").read_text(), OTHER)
        self.assertEqual((self.home / "public_html" / "existing-site.txt").read_text(), "Keep this website")

    def test_failed_backup_prevents_migration_and_file_changes(self):
        self.installed()
        self.deployment.failure = "backup"
        with self.assertRaises(receiver.DeployError):
            self.deployment.publish(self.stage(), COMMIT, DIGEST)
        self.assertEqual(self.deployment.calls, ["backup"])
        self.assertEqual((self.deployment.public / "index.html").read_text(), OTHER)

    def test_failed_verification_restores_previous_files(self):
        self.installed()
        self.deployment.failure = "verify"
        with self.assertRaisesRegex(receiver.DeployError, "Database changes were not reversed"):
            self.deployment.publish(self.stage(), COMMIT, DIGEST)
        self.assertEqual((self.deployment.public / "index.html").read_text(), OTHER)
        self.assertTrue(list((self.deployment.root / "releases").glob("failed-*")))

    def test_retry_does_not_repeat_database_effects(self):
        self.stage().rename(self.deployment.public)
        result = self.deployment.publish(self.stage(), COMMIT, DIGEST)
        self.assertEqual(result["status"], "already-current")
        self.assertEqual(self.deployment.calls, ["verify"])
        with self.assertRaisesRegex(receiver.DeployError, "different artifact"):
            self.deployment.publish(self.root / "unused", COMMIT, "d" * 64)
        self.assertEqual(self.deployment.calls, ["verify"])

    def test_refuses_unmanaged_destination(self):
        self.deployment.public.mkdir()
        (self.deployment.public / "manual.txt").write_text("manual")
        with self.assertRaisesRegex(receiver.DeployError, "unmanaged"):
            self.deployment.initialize()
        self.assertEqual((self.deployment.public / "manual.txt").read_text(), "manual")

    def test_receiver_rejects_unknown_operations_and_extra_arguments(self):
        self.assertEqual(receiver.parse_command(["plan", COMMIT, DIGEST]), ["plan", COMMIT, DIGEST])
        for command in [["bash"], ["publish", COMMIT, DIGEST, "extra"], ["delete", COMMIT, DIGEST], ["publish", COMMIT + ";unsafe", DIGEST]]:
            with self.subTest(command=command), self.assertRaises(receiver.DeployError):
                receiver.parse_command(command)

    def test_backup_credentials_stay_out_of_arguments_and_temporary_files_are_removed(self):
        deployment = receiver.Deployment(self.home)
        config = {"DB_HOST": "localhost", "DB_USER": "test", "DB_PASSWORD": "synthetic-password", "DB_NAME": "test", "DB_PORT": "3306"}
        def invoke(args, **kwargs):
            self.assertNotIn(config["DB_PASSWORD"], " ".join(args))
            credentials = Path(args[1].split("=", 1)[1])
            self.assertEqual(credentials.stat().st_mode & 0o777, 0o600)
            self.assertIn(config["DB_PASSWORD"], credentials.read_text())
            kwargs["stdout"].write(b"-- synthetic backup\n")
            return SimpleNamespace(returncode=0)
        with patch.object(receiver.subprocess, "run", side_effect=invoke):
            name = deployment.backup(config, COMMIT)
        self.assertEqual((deployment.root / "backups" / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(deployment.root.glob("mysql-*")), [])

    def test_timed_out_backup_removes_partial_sql_and_credentials(self):
        deployment = receiver.Deployment(self.home)
        config = {"DB_HOST": "localhost", "DB_USER": "test", "DB_PASSWORD": "synthetic-password", "DB_NAME": "test", "DB_PORT": "3306"}
        def timeout(args, **kwargs):
            kwargs["stdout"].write(b"incomplete SQL")
            raise subprocess.TimeoutExpired("mysqldump", 180)
        with patch.object(receiver.subprocess, "run", side_effect=timeout), self.assertRaisesRegex(receiver.DeployError, "timed out"):
            deployment.backup(config, COMMIT)
        self.assertEqual(list((deployment.root / "backups").iterdir()), [])
        self.assertEqual(list(deployment.root.glob("mysql-*")), [])

    def metadata(self, digest=DIGEST):
        return {"version": 1, "app": "mind-assistant", "commit": COMMIT, "sha256": digest, "artifact": "mind-assistant-" + COMMIT + ".tar.gz"}

    def test_pull_metadata_cannot_select_another_artifact_or_application(self):
        self.assertEqual(pull.validate_metadata(self.metadata()), self.metadata())
        for change in [{"app": "other"}, {"commit": "invalid"}, {"artifact": "../config.php"}, {"artifact": "https://example.test/artifact"}, {"sha256": "invalid"}]:
            with self.subTest(change=change), self.assertRaises(receiver.DeployError):
                pull.validate_metadata({**self.metadata(), **change})

    def test_pull_skips_unchanged_ready_release_without_database_effects(self):
        self.stage().rename(self.deployment.public)
        self.deployment.mark_ready()
        with patch.object(pull, "Deployment", return_value=self.deployment), patch.object(pull, "download", return_value=json.dumps(self.metadata()).encode()) as download:
            self.assertIsNone(pull.pull(self.home))
        self.assertEqual(download.call_count, 1)
        self.assertEqual(self.deployment.calls, [])

    def test_pull_requires_current_successful_ci_before_downloading_or_applying_an_artifact(self):
        success = {"head_sha": COMMIT, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success"}
        for change in [{"conclusion": "failure"}, {"status": "in_progress"}, {"head_branch": "feature/test"}, {"head_sha": OTHER}, {"event": "pull_request"}]:
            with self.subTest(change=change), self.assertRaises(receiver.DeployError):
                pull.verified_ci({"workflow_runs": [{**success, **change}]}, COMMIT)
        with self.assertRaises(receiver.DeployError):
            pull.verified_ci({"workflow_runs": [{**success, "conclusion": "failure"}, success]}, COMMIT)
        with patch.object(pull, "Deployment", return_value=self.deployment), patch.object(pull, "download", side_effect=[json.dumps(self.metadata()).encode(), b'{"workflow_runs": []}']) as download:
            with self.assertRaises(receiver.DeployError):
                pull.pull(self.home)
        self.assertEqual(download.call_count, 2)
        self.assertEqual(self.deployment.calls, [])

    def test_pull_checks_and_promotes_a_published_artifact(self):
        artifact = self.root / "artifact.gz"
        metadata = package(self.source(), artifact, COMMIT)
        ci = {"workflow_runs": [{"head_sha": COMMIT, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success"}]}
        with patch.object(pull, "Deployment", return_value=self.deployment), patch.object(pull, "download", side_effect=[json.dumps(self.metadata(metadata["sha256"])).encode(), json.dumps(ci).encode(), artifact.read_bytes()]), patch.object(self.deployment, "lint") as lint:
            result = pull.pull(self.home)
        self.assertEqual(result["status"], "published")
        lint.assert_called_once()
        self.assertEqual(self.deployment.current()["deploymentStatus"], "ready")
        self.assertEqual(self.deployment.calls, ["backup", "migrate", "verify"])

    def test_download_size_limit_precedes_artifact_parsing(self):
        with patch.object(pull.urllib.request, "urlopen", return_value=io.BytesIO(b"too large")):
            with self.assertRaises(receiver.DeployError):
                pull.download("https://example.test/", 2)


if __name__ == "__main__":
    unittest.main()
