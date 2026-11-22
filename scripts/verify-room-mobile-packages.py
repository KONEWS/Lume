"""Verify the shared player and the native room resource handler in both deliveries."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
assets = root / "mobile/player-assets"
sources = [file for file in assets.rglob("*") if file.is_file()]
report = {}

for kind in ("apk", "hap"):
    package = root / f"release/Lume-room-details.{kind}"
    with ZipFile(package) as archive:
        index = next(name for name in archive.namelist() if name.endswith("/player/index.html"))
        prefix = index.removesuffix("player/index.html")
        for file in sources:
            member = prefix + file.relative_to(assets).as_posix()
            assert archive.read(member) == file.read_bytes(), member
        native = [name for name in archive.namelist() if name.endswith("/liblume.so")]
        assert native and all(b"/api/track-details/" in archive.read(name) for name in native)
    report[kind] = {"sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
                    "assets": len(sources), "native": native}

target = root / "release/RoomDetails/verification/mobile-packages.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(target)
