"""License audit for backend (installed venv) and frontend (package-lock.json). Writes LICENSES.md.

Run with the backend venv's interpreter so installed package metadata is visible:
    backend/.venv/bin/python scripts/license_audit.py

With --check, compares against the committed LICENSES.md instead of writing it.
Exits non-zero if a package that ships with the app has a disallowed or unknown license.
Dev-only tools are listed for transparency but do not fail the audit (they are not distributed).
"""

import json
import re
import sys
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRONG_COPYLEFT = re.compile(r"AGPL|Affero|(?<!L)GPL|General Public License", re.I)
WEAK_COPYLEFT = re.compile(r"LGPL|Lesser|Library General|MPL|Mozilla|EPL|Eclipse|CDDL", re.I)
NOT_COMMERCIAL = re.compile(r"SSPL|BUSL|Business Source|Commons Clause|CC-BY-NC|Non-?Commercial|research only", re.I)


def _canon(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def python_license(dist: metadata.Distribution) -> str:
    md = dist.metadata
    if expr := md.get("License-Expression"):
        return expr
    classifiers = [c.split("::")[-1].strip() for c in md.get_all("Classifier") or [] if c.startswith("License ::")]
    classifiers = [c for c in classifiers if c != "OSI Approved"]
    if classifiers:
        return " OR ".join(sorted(set(classifiers)))
    lic = (md.get("License") or "").strip()
    # Some packages paste the whole license text into this field; keep the first line.
    return lic.splitlines()[0][:60] if lic else "UNKNOWN"


def python_runtime_closure() -> set[str]:
    """Everything the image installs: the hash-pinned runtime lock, which Docker and CI install as-is."""
    names = set()
    for line in (ROOT / "backend/requirements.lock").read_text().splitlines():
        if m := re.match(r"^([A-Za-z0-9_.-]+)==", line):
            names.add(_canon(m.group(1)))
    return names


# Native libraries that wheels bundle (in <package>.libs/). Python metadata only describes the Python
# package, so these are checked separately: a GPL library loaded in-process would break the rules.
NATIVE_LICENSES = {
    "libx265": "GPL-2.0-or-later",
    "libheif": "LGPL-3.0",
    "libde265": "LGPL-3.0",
    "libgfortran": "GPL-3.0-with-GCC-exception",
    "libquadmath": "LGPL-2.1",
    "libscipy-openblas64-": "BSD-3-Clause",
    "libfreetype": "FTL OR GPL-2.0 (used under FTL)",
    "libharfbuzz": "MIT",
    "libjpeg": "IJG AND BSD-3-Clause",
    "liblcms2": "MIT",
    "liblzma": "0BSD",
    "libopenjp2": "BSD-2-Clause",
    "libpng16": "libpng-2.0",
    "libtiff": "libtiff",
    "libwebp": "BSD-3-Clause",
    "libwebpdemux": "BSD-3-Clause",
    "libwebpmux": "BSD-3-Clause",
    "libsharpyuv": "BSD-3-Clause",
    "libavif": "BSD-2-Clause",
    "libbrotlicommon": "MIT",
    "libbrotlidec": "MIT",
    "libzstd": "BSD-3-Clause",
    "libxcb": "MIT",
    "libxau": "MIT",
}
# Licenses that are fine for a separately loaded, unmodified shared library.
NATIVE_OK = re.compile(r"GCC-exception|\(used under FTL\)|^LGPL", re.I)


def _native_name(filename: str) -> str:
    stem = filename.split(".so")[0]
    return _canon(re.sub(r"-[0-9a-f]{8}(?:-[0-9a-f]{8})?$", "", stem))


def native_rows(runtime: set[str]) -> tuple[list[str], list[str]]:
    rows, problems = [], []
    for dist in metadata.distributions():
        pkg = _canon(dist.metadata["Name"])
        if pkg not in runtime:
            continue
        for f in dist.files or []:
            path = str(f)
            if path.endswith("LICENSES_bundled.txt"):
                head = (f.locate().read_text(errors="replace").splitlines() or [""])[0]
                if STRONG_COPYLEFT.search(head) and not WEAK_COPYLEFT.search(head):
                    problems.append(f"Bundled libraries: {pkg} says '{head.strip()}'")
            if ".libs/" not in path or ".so" not in path:
                continue
            lib = _native_name(path.split("/")[-1])
            lic = NATIVE_LICENSES.get(lib, "UNKNOWN")
            if lic == "UNKNOWN":
                status = "unknown"
            elif NATIVE_OK.search(lic):
                status = "review"
            else:
                status = classify(lic)
            if status in ("disallowed", "unknown"):
                problems.append(f"Bundled libraries: {lib} in {pkg} ({lic})")
            rows.append(f"| {pkg} | {lib} | {lic} | {status} |")
    out = [
        "## Native libraries bundled in Python wheels",
        "",
        "Loaded as separate shared libraries, unmodified. LGPL libraries can be replaced in the image; their sources are "
        "linked from each wheel's bundled licence file. The FreeType credit: portions of this software are copyright "
        "The FreeType Project (www.freetype.org). All rights reserved.",
        "",
        "| Package | Library | License | Status |",
        "|---|---|---|---|",
        *sorted(set(rows)),
        "",
    ]
    return out, problems


def python_rows() -> list[tuple[str, str, str, bool]]:
    runtime = python_runtime_closure()
    rows = {}
    for dist in metadata.distributions():
        name = _canon(dist.metadata["Name"])
        if name in {"pip", "setuptools", "wheel"}:
            continue
        rows[name] = (name, dist.version, python_license(dist), name in runtime)
    return sorted(rows.values())


def npm_rows() -> list[tuple[str, str, str, bool]]:
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    rows = []
    for path, pkg in lock["packages"].items():
        if not path:
            continue
        name = path.split("node_modules/")[-1]
        # devOptional packages (types, schema tools) are only installed for development builds.
        shipped = not pkg.get("dev", False) and not pkg.get("devOptional", False)
        rows.append((name, pkg.get("version", "?"), pkg.get("license") or "UNKNOWN", shipped))
    return sorted(set(rows))


def classify(lic: str) -> str:
    if lic == "UNKNOWN":
        return "unknown"
    if NOT_COMMERCIAL.search(lic):
        return "disallowed"
    if WEAK_COPYLEFT.search(lic):
        return "review"
    if STRONG_COPYLEFT.search(lic):
        return "disallowed"
    return "ok"


def section(title: str, rows: list[tuple[str, str, str, bool]]) -> tuple[list[str], list[str]]:
    problems = []
    shipped = [r for r in rows if r[3]]
    dev = [r for r in rows if not r[3]]
    out = [f"## {title}", "", f"{len(shipped)} packages ship with the app; {len(dev)} are dev/test tools only.", ""]
    out += ["### Shipped", "", "| Package | Version | License | Status |", "|---|---|---|---|"]
    for name, ver, lic, _ in shipped:
        status = classify(lic)
        if status in ("disallowed", "unknown"):
            problems.append(f"{title}: {name} {ver} ({lic})")
        out.append(f"| {name} | {ver} | {lic} | {status} |")
    counts: dict[str, int] = {}
    for _, _, lic, _ in dev:
        counts[lic] = counts.get(lic, 0) + 1
    out += ["", "### Dev and test tools (not distributed), by license", "", "| License | Packages |", "|---|---|"]
    out += [f"| {lic} | {n} |" for lic, n in sorted(counts.items(), key=lambda kv: -kv[1])]
    flagged = [f"{n} {v} ({lic})" for n, v, lic, _ in dev if classify(lic) != "ok"]
    if flagged:
        out += ["", "Dev tools needing a note: " + "; ".join(flagged)]
    return out + [""], problems


def main() -> int:
    py, py_problems = section("Backend (Python)", python_rows())
    native, native_problems = native_rows(python_runtime_closure())
    js, js_problems = section("Frontend (npm)", npm_rows())
    problems = py_problems + native_problems + js_problems
    lines = [
        "# Third-party licenses",
        "",
        f"Generated by `scripts/license_audit.py` on {datetime.now(UTC).date().isoformat()}. "
        "Licenses come from installed package metadata (Python) and package-lock.json (npm). "
        '"review" means weak copyleft (LGPL/MPL): allowed when used unmodified as a separate library.',
        "",
        "System tools outside these lists: Tesseract OCR (Apache-2.0, run as a separate process), "
        "the Debian tesseract-ocr package and its libraries (leptonica BSD-2-Clause, libarchive BSD-2-Clause, and others), "
        "PostgreSQL (PostgreSQL License), k6 (AGPL-3.0, an external load-test CLI that is not linked or shipped), "
        "gitleaks (MIT, dev hook only).",
        "",
        *py,
        *native,
        *js,
        "## Result",
        "",
        "No shipped package has a disallowed or unknown license."
        if not problems
        else "Problems:\n" + "\n".join(f"- {p}" for p in problems),
        "",
    ]
    new = "\n".join(lines)
    target = ROOT / "LICENSES.md"
    if "--check" in sys.argv:
        # CI mode: the committed file must match what the current lockfiles produce (date line aside).
        def body(text: str) -> list[str]:
            return [ln for ln in text.splitlines() if not ln.startswith("Generated by")]

        if not target.exists() or body(target.read_text()) != body(new):
            problems.append("LICENSES.md is out of date; run `make licenses` and commit it")
    else:
        target.write_text(new)
    print("\n".join(problems) or "license audit passed")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
