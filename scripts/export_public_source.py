#!/usr/bin/env python3
"""Export the atlas's public source tree: the web app, its build and test scripts, the asset
builders, and the synthetic data, for LBCN-Stanford/brain-atlas. Nothing else.

The research repository holds much more than the atlas: the earlier analysis app, the canonical
ETL, audits, notebooks, the manuscript and publication drafts, and paths to controlled data. None
of that is part of the public atlas, so this is an ALLOWLIST (a file is exported only if it is
named here), the same rule as app/scripts/prune-dist.mjs for the built site.

After copying it checks the exported tree, and refuses (exit 1) if any check fails:
  - no controlled tree (data-real*, lab_data) and no file larger than 25 MB
  - the synthetic manifest is marked synthetic
  - no patient-initials token in any text file (the privacy workflow's pattern)

Usage:  python3 scripts/export_public_source.py OUT_DIR
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# source files, relative to the repository root
FILES = [
    "LICENSE", "LICENSE-DATA",
    "app/index.html", "app/package-lock.json", "app/tsconfig.json", "app/tsconfig.app.json",
    "app/tsconfig.node.json", "app/vite.config.ts", "app/DEPLOY.md",
    "app/public/404.html", "app/public/robots.txt", "app/public/sitemap.xml", "app/public/og-image.png",
    "app/public/favicon.svg", "app/public/atlas/data/site_parcels.json",
    *[f"app/public/data/{t}.json" for t in ["manifest", "patients", "sessions", "sites", "stimulation_events", "effect_labels", "qc_flags", "reports", "electrodes", "atlas_labels", "ccep_availability"]],
    # the seven shared modules the atlas imports (tsc --listFiles from src/atlas/main.tsx)
    "app/src/lib/ccep/constants.ts", "app/src/lib/core/data.ts", "app/src/lib/core/query.ts",
    "app/src/lib/core/schema.ts", "app/src/lib/space/anatomy.ts", "app/src/lib/space/coordinateSpace.ts",
    "app/src/lib/space/ontology.ts",
    "app/scripts/atlas.test.ts", "app/scripts/atlas_e2e.mjs", "app/scripts/prune-dist.mjs",
    "app/scripts/finalize-dist.mjs", "app/scripts/notices.mjs", "app/scripts/strip-controlled.mjs",
    "app/scripts/syntheticReports.ts", "app/scripts/synthetic_report_text.ts",
    "scripts/tests/test_v2_assets.py", "scripts/export_public_source.py",
    # the brain-asset builder works from the public fsaverage template only; the site and report
    # builders read controlled data on the lab machine and name held people, so they stay private
    "scripts/v2/build_brain_assets.py", "scripts/v2/README.md",
    "scripts/v2/area_names.py", "scripts/v2/apply_area_names.py",
]
# whole directories
DIRS = ["app/src/atlas", "app/public/atlas/brain", "app/licenses", "scripts/v2/reference"]
# never, even inside an allowed directory
NEVER = re.compile(r"(^|/)(data-real[^/]*|lab_data|build_staging|node_modules|dist|__pycache__)(/|$)|\.pyc$|\.DS_Store$")

# the privacy workflow's initials check, verbatim (.github/workflows/privacy.yml): initials attached
# to an S-number, except the reserved synthetic set
RESERVED = {"ZQ", "VW", "WX", "XN", "XR", "Kx", "XYZ"}
VARIANT = re.compile(r"^(?:([A-Z][A-Za-z]+)([a-z])|([a-z]))$")
TOKEN = re.compile(r"(?<![A-Za-z0-9])(?:[A-Z]+_)?S(\d+)_(\d+)_([A-Z][A-Za-z]*)")


def has_initials(text: str) -> bool:
    for m in TOKEN.finditer(text):
        v = VARIANT.match(m.group(3))
        ini = m.group(3) if not v else ("" if v.group(3) else v.group(1))
        if len(ini) >= 2 and ini not in RESERVED:
            return True
    return False


def copy(rel: str, out: Path) -> None:
    src = ROOT / rel
    if NEVER.search(rel):
        return
    dst = out / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out = Path(sys.argv[1]).resolve()
    if out.exists() and any(out.iterdir()):
        print(f"{out} is not empty")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    for rel in FILES:
        copy(rel, out)
    for d in DIRS:
        for p in (ROOT / d).rglob("*"):
            if p.is_file():
                copy(str(p.relative_to(ROOT)), out)
    # tracked files only: an untracked or ignored file inside an allowed directory stays out
    tracked = set(subprocess.run(["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n"))
    for p in list(out.rglob("*")):
        rel = str(p.relative_to(out))
        if p.is_file() and rel not in tracked and rel not in {"scripts/export_public_source.py"}:
            p.unlink()

    write_public_files(out)
    scrub_subject_ids(out)
    drop_private_record_tests(out)

    # ---- checks -------------------------------------------------------------------------------
    bad: list[str] = []
    for p in out.rglob("*"):
        rel = str(p.relative_to(out))
        if NEVER.search(rel):
            bad.append(f"controlled or build path: {rel}")
        if p.is_file() and p.stat().st_size > 25 * 1024 * 1024:
            bad.append(f"file over 25 MB: {rel}")
        if p.is_file() and p.suffix in {".ts", ".tsx", ".mjs", ".js", ".json", ".md", ".py", ".html", ".txt", ".cff", ".yml", ".css", ".csv"}:
            if has_initials(p.read_text(errors="ignore")):
                bad.append(f"patient-initials token in {rel}")
    if json.loads((out / "app/public/data/manifest.json").read_text()).get("synthetic") is not True:
        bad.append("app/public/data is not marked synthetic")
    if bad:
        print("REFUSED:\n  " + "\n  ".join(bad))
        return 1
    n = sum(1 for p in out.rglob("*") if p.is_file())
    print(f"exported {n} files to {out}")
    return 0


# A comment in the shared code may name a pseudonymous subject next to something about them (a
# device artifact on their scan, an excluded transform). The public copy keeps the point and drops
# the ID, so no detail is attached to a person. Examples of the ID FORMAT (sub-123, sub-007 in a
# formatting test) are not about anyone and are kept.
SUBJECT = re.compile(r"\bsub-\d{3}\b|\bS\d{2}_\d{2,3}[a-z]?\b")
KEEP_EXAMPLES = {"app/src/atlas/model/selection.ts", "app/scripts/atlas.test.ts"}


def scrub_subject_ids(out: Path) -> None:
    for p in (out / "app/src/lib").rglob("*.ts"):
        rel = str(p.relative_to(out))
        if rel in KEEP_EXAMPLES:
            continue
        t = p.read_text()
        t2 = SUBJECT.sub("one subject", t)
        if t2 != t:
            p.write_text(t2)
    note = out / "scripts/v2/README.md"
    if note.exists():
        note.write_text("> In this public repository only `build_brain_assets.py` is included: it builds the brain and area\n"
                        "> files from FreeSurfer's public fsaverage template. The other steps below read controlled\n"
                        "> patient data on the lab machine and live in the lab's research repository.\n\n" + note.read_text())


def drop_private_record_tests(out: Path) -> None:
    """test_v2_assets.py's ValidationRecord tests a record built from controlled data, which stays in
    the research repository; the public copy tests what the public repository holds."""
    p = out / "scripts/tests/test_v2_assets.py"
    t = p.read_text()
    a = t.find("class ValidationRecord(unittest.TestCase):")
    if a < 0:
        return
    b = t.find("\nclass ", a + 1)
    if b < 0:
        b = t.find("\nif __name__", a)
    p.write_text(t[:a] + t[b:].lstrip("\n") if b >= 0 else t[:a])


def write_public_files(out: Path) -> None:
    pkg = json.loads((ROOT / "app/package.json").read_text())
    pkg["name"] = "intracranial-stimulation-atlas"
    pkg["scripts"] = {
        "dev": "vite",
        "build": pkg["scripts"]["build"],
        "build:controlled": pkg["scripts"]["build:controlled"],
        "test": "tsx --tsconfig tsconfig.app.json --test \"scripts/*.test.ts\"",
        "test:e2e": "node scripts/atlas_e2e.mjs",
        "preview": "vite preview",
    }
    (out / "app/package.json").write_text(json.dumps(pkg, indent=2) + "\n")

    # the vite config without the earlier app's dev-server workarounds
    (out / "app/vite.config.ts").write_text("""import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// the build's identity, shown in the atlas's About sheet
try { process.env.VITE_BUILD_COMMIT ??= execSync('git rev-parse --short HEAD').toString().trim() } catch { /* not a git checkout */ }
process.env.VITE_BUILD_DATE ??= new Date().toISOString().slice(0, 10)

export default defineConfig({
  // relative, so the build works under any path (SITE_BASE sets the 404 redirect and canonical URL)
  base: './',
  plugins: [react()],
})
""")

    (out / ".gitignore").write_text("""node_modules/
app/dist/
# controlled, patient-derived data never enters this repository
app/public/data-real*/
app/public/atlas/data-real*/
lab_data/
build_staging/
__pycache__/
.DS_Store
""")

    (out / "CITATION.cff").write_text("""cff-version: 1.2.0
title: Intracranial Stimulation Atlas
message: If you use this software, please cite it as below, and cite the data release you used.
type: software
authors:
  - given-names: Ameya
    family-names: Choudhary
    affiliation: Laboratory of Behavioral and Cognitive Neuroscience, Stanford University
  - given-names: Aryan
    family-names: Kumar
    affiliation: Laboratory of Behavioral and Cognitive Neuroscience, Stanford University
repository-code: https://github.com/LBCN-Stanford/brain-atlas
url: https://lbcn-stanford.github.io/brain-atlas/
abstract: >-
  A web atlas of what people reported when small areas of their brain were electrically
  stimulated during clinical monitoring for epilepsy, organised by the areas of published brain
  atlases. This repository holds the web application, its build and test scripts, the builders of
  its brain and area assets, and a synthetic demonstration dataset. Patient-derived data are not
  distributed here.
keywords:
  - intracranial electrical stimulation
  - direct cortical stimulation
  - stereo-EEG
  - electrocorticography
  - brain atlas
license: BSD-3-Clause
""")

    (out / "README.md").write_text("""# Intracranial Stimulation Atlas

What people reported when a small area of their brain was electrically stimulated, organised by
the area of a published brain atlas where each stimulation took place. Built by the Laboratory of
Behavioral and Cognitive Neuroscience (LBCN, Parvizi Lab), Stanford University School of Medicine.

**Live demonstration:** https://lbcn-stanford.github.io/brain-atlas/ (synthetic data: every number
and report on it is invented).

## What is here

| Path | What it is |
|---|---|
| `app/` | the web app (Vite, React, three.js): `src/atlas/` the page, `src/lib/` the data loader and rules it uses |
| `app/public/atlas/brain/` | FreeSurfer fsaverage surfaces and area labels, converted for the browser (see `app/licenses/` and the built `NOTICE.txt`) |
| `app/public/data/`, `app/public/atlas/data/` | the synthetic demonstration release |
| `scripts/v2/` | the builders of the brain assets and of each site's areas (they read controlled data on the lab machine only) |

## Run it

```bash
cd app
npm ci
npm run dev        # http://localhost:5173/
npm test           # unit and data tests
npm run build      # dist/: the deployable site
npm run test:e2e   # the built site in a real browser
```

Deploying: `app/DEPLOY.md`.

## Data

Patient-derived data are not in this repository and never enter it (`.gitignore`). They were
collected under Stanford IRB protocol 11354 and are governed by it. The synthetic release has the
same schema, so everything here runs without them.

## Licence and citation

Code: BSD-3-Clause (`LICENSE`). Synthetic and derived data: CC BY 4.0 (`LICENSE-DATA`).
Third-party material (FreeSurfer, libraries, fonts): `app/licenses/` and the `NOTICE.txt` every
build writes. Cite with `CITATION.cff`.

The atlas was developed in the lab's research repository; this repository holds the atlas alone.
""")

    wf = out / ".github/workflows"
    wf.mkdir(parents=True, exist_ok=True)
    (wf / "ci.yml").write_text("""name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - name: typecheck
        run: npx tsc -b
      - name: tests
        run: npm test
      - name: build
        run: npm run build
      - name: no controlled data in the bundle
        run: test -z "$(find dist -type d -name 'data-real*')"
      - name: the built site in a browser
        run: |
          npx playwright install --with-deps chromium
          npm run test:e2e

  assets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python3 -m pip install --quiet "numpy>=1.24"
      - run: python3 scripts/tests/test_v2_assets.py
""")
    (wf / "pages.yml").write_text("""# Builds the synthetic demonstration site from main and publishes it to the gh-pages branch,
# which GitHub Pages serves at https://lbcn-stanford.github.io/brain-atlas/.
name: pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    env:
      SITE_BASE: /brain-atlas/
      SITE_URL: https://lbcn-stanford.github.io/brain-atlas/
      SITE_INDEX: 'no'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - name: synthetic data only
        run: node -e "const m=require('./public/data/manifest.json'); if(m.synthetic!==true){process.exit(1)}"
      - run: npm run build
      - run: test -z "$(find dist -type d -name 'data-real*')"
      - name: the built site in a browser
        run: |
          npx playwright install --with-deps chromium
          npm run test:e2e
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_branch: gh-pages
          publish_dir: app/dist
          force_orphan: true
          enable_jekyll: false
          commit_message: 'Site built from ${{ github.sha }} (synthetic data)'
          user_name: 'Aryan Kumar'
          user_email: '113646426+arynku@users.noreply.github.com'
""")


if __name__ == "__main__":
    sys.exit(main())
