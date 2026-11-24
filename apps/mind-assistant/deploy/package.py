"""Детерминированный артефакт React/PHP без локальных секретов."""

import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

from receiver import validate_member_name, validate_commit


def package(source, output, commit):
    validate_commit(commit)
    source = Path(source)
    files = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed in a deployment artifact.")
        if path.is_file():
            name = path.relative_to(source).as_posix()
            validate_member_name(name)
            if name == "release.json":
                raise ValueError("The build must not contain a pre-existing release marker.")
            files[name] = path.read_bytes()
    files["release.json"] = (json.dumps({
        "version": 1, "app": "mind-assistant", "commit": commit,
    }, sort_keys=True) + "\n").encode()
    with Path(output).open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    member.mode = 0o644
                    archive.addfile(member, io.BytesIO(data))
    return {"commit": commit, "sha256": hashlib.sha256(Path(output).read_bytes()).hexdigest(), "files": len(files)}


if __name__ == "__main__":
    try:
        print(json.dumps(package(*sys.argv[1:])))
    except Exception as error:
        print(f"Artifact preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
