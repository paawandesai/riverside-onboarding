"""Copyright and license notices for the npm packages shipped in the browser bundle.

Rewrites the npm section of frontend/public/third-party-notices.txt (served with the app) from each
shipped package's own LICENSE file. Needs frontend/node_modules (run `npm ci` first):
    python3 scripts/js_notices.py

With --check, only confirms from package-lock.json that every shipped package has a notice, so CI
doesn't need node_modules.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTICES = ROOT / "frontend/public/third-party-notices.txt"
MARKER = "######## npm packages in the JavaScript bundle ########"
# Fonts carry their own OFL notices in the section above the marker.
SKIP_PREFIXES = ("@fontsource/",)


def shipped_packages() -> list[tuple[str, str, str]]:
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    out = []
    for path, pkg in lock["packages"].items():
        if not path or pkg.get("dev") or pkg.get("devOptional"):
            continue
        name = path.split("node_modules/")[-1]
        if not name.startswith(SKIP_PREFIXES):
            out.append((name, pkg.get("version", "?"), pkg.get("license") or "UNKNOWN"))
    return sorted(set(out))


def header(name: str, version: str, lic: str) -> str:
    return f"=== {name} {version} ({lic}) ==="


def license_text(name: str) -> str | None:
    folder = ROOT / "frontend/node_modules" / name
    for candidate in sorted(folder.glob("*")):
        if candidate.is_file() and candidate.name.upper().startswith(("LICENSE", "LICENCE", "COPYING")):
            return candidate.read_text(errors="replace").strip()
    return None


def main() -> int:
    current = NOTICES.read_text()
    fonts = current.split(MARKER)[0].rstrip() + "\n"
    packages = shipped_packages()
    if "--check" in sys.argv:
        missing = [n for n, v, lic in packages if header(n, v, lic) not in current]
        if missing:
            print("third-party-notices.txt is missing: " + ", ".join(missing) + "; run `make licenses` and commit it")
            return 1
        print("js notices check passed")
        return 0
    blocks, missing = [], []
    for name, version, lic in packages:
        text = license_text(name)
        if text is None:
            missing.append(name)
            text = f"License: {lic}. The package ships no license file; see https://www.npmjs.com/package/{name}"
        blocks.append(f"{header(name, version, lic)}\n{text}\n")
    NOTICES.write_text(fonts + "\n" + MARKER + "\n\n" + "\n".join(blocks))
    print(f"wrote notices for {len(packages)} packages" + (f"; no license file in: {', '.join(missing)}" if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
