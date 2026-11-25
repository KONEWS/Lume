"""Check the room catalog artwork path in a signed APK/HAP pair after integration."""
import hashlib
import sys
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
assets = root / "mobile/player-assets/player"
if len(sys.argv) != 3:
    raise SystemExit("Usage: python scripts/verify-room-catalog-packages.py app.apk entry.hap")

for filename, extension in zip(sys.argv[1:], (".apk", ".hap")):
    package = Path(filename)
    assert package.suffix == extension, filename
    with ZipFile(package) as archive:
        names = archive.namelist()
        prefix = next(p.removesuffix("index.html") for p in names if p.endswith("/player/index.html"))
        for name in ("song-details.js", "library-covers.js", "player.js"):
            assert archive.read(prefix + name) == (assets / name).read_bytes(), (package, name)
        native = [p for p in names if p.endswith("/liblume.so")]
        bridge = "classes.dex" if extension == ".apk" else next(p for p in names if p.endswith("/modules.abc"))
        assert native, package
        for member in [bridge, *native]:
            data = archive.read(member)
            for marker in (b"/api/catalog-cover/", b"catalogThumbnail", b"coverRequests", b"coverRevision"):
                assert marker in data, (package, member, marker)
        assert b"?visible=" in archive.read(bridge), (package, "viewport bridge")
        for member in native:
            assert b"visible\x00" in archive.read(member), (package, "viewport request handler")
    print(package.name, hashlib.sha256(package.read_bytes()).hexdigest())
