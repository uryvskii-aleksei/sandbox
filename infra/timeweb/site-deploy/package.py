"""Детерминированная упаковка выбранного сайта без workspace, секретов и соседних apps."""

import gzip
import io
import json
from pathlib import Path
import sys
import tarfile

from receiver import MAX_FILE, MAX_FILES, MAX_TOTAL, SiteError, allowed_path, sha256, validate_identity, validate_target


def package(source, output, target, commit):
    validate_identity(commit)
    validate_target(target)
    source = Path(source)
    if source.is_symlink() or not source.is_dir():
        raise SiteError("Expected the built application's actual directory.")
    files = {}
    total = 0
    for path in sorted(source.rglob("*")):
        if path.is_symlink() or (not path.is_dir() and not path.is_file()):
            raise SiteError("Artifacts cannot contain symlinks or special files.")
        if path.is_file():
            name = allowed_path(target, path.relative_to(source).as_posix())
            total += path.stat().st_size
            if path.stat().st_size > MAX_FILE or total > MAX_TOTAL or len(files) >= MAX_FILES:
                raise SiteError("The built artifact exceeds its limits.")
            files[name] = sha256(path)
    if not set(target["requiredFiles"]).issubset(files) or any(item.get("file") not in files for item in target["checks"] if "file" in item):
        raise SiteError("Incomplete built application.")
    manifest = {"version": 1, "app": target["app"], "commit": commit, "files": files}
    with Path(output).open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                metadata = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
                member = tarfile.TarInfo("manifest.json")
                member.mode = 0o644
                member.size = len(metadata)
                archive.addfile(member, io.BytesIO(metadata))
                for name in sorted(files):
                    path = source / name
                    member = tarfile.TarInfo("site/" + name)
                    member.mode = 0o644
                    member.size = path.stat().st_size
                    with path.open("rb") as data:
                        archive.addfile(member, data)
    return {"commit": commit, "sha256": sha256(output), "files": len(files), "bytes": total}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 5:
            raise SiteError("Expected SOURCE OUTPUT TARGET_JSON COMMIT.")
        print(json.dumps(package(sys.argv[1], sys.argv[2], json.loads(Path(sys.argv[3]).read_text()), sys.argv[4])))
    except Exception as error:
        print("Site packaging failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
