#!/usr/bin/env python3
"""Write the display names from area_names.py into the served parcel tables, without rebuilding
the brain assets (which needs the fsaverage download). build_brain_assets.py writes the same
names when it runs; scripts/tests/test_v2_assets.py checks that the served tables match the table.

Each label gets `name` (shown) and `long` (the atlas's full label: Destrieux et al. 2010's long name,
Desikan et al. 2006's region name, Yeo's network name). Run from the repository root:
    python3 scripts/v2/apply_area_names.py [--check]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from area_names import DK_LONG, NAMES  # noqa: E402

PARC = HERE.parents[1] / "app/public/atlas/brain/parc"
ORDER = ["index", "key", "annot_name", "hemisphere", "color", "vertices", "name", "long", "short", "group"]


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for atlas, names in NAMES.items():
        p = PARC / f"{atlas}.json"
        raw = p.read_text()
        t = json.loads(raw)
        for lab in t["labels"]:
            nm = lab.get("annot_name")
            if not nm:
                continue
            if nm not in names:
                raise SystemExit(f"{atlas}: {nm} has no display name in area_names.py")
            # the long name is the atlas's own label; for Destrieux it is the name first written
            long = DK_LONG[nm] if atlas == "dk" else names[nm] if atlas == "yeo7" else lab.get("long", lab["name"])
            lab.update(name=names[nm], long=long)
            for k in ORDER[::-1]:
                if k in lab:
                    lab[k] = lab.pop(k)
            ordered = {k: lab[k] for k in ORDER if k in lab}
            ordered.update({k: v for k, v in lab.items() if k not in ordered})
            lab.clear()
            lab.update(ordered)
        out = json.dumps(t, indent=1, ensure_ascii=False)
        if out != raw:
            stale.append(atlas)
            if not check:
                p.write_text(out)
    if check:
        print("parcel names current" if not stale else f"parcel names out of date: {', '.join(stale)}")
        return 1 if stale else 0
    print(f"wrote names into: {', '.join(stale) or 'nothing (already current)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
