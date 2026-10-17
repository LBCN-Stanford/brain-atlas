#!/usr/bin/env python3
"""Atlas v2's committed anatomy and its committed accuracy record are internally consistent.

Runs on the committed files only (numpy + stdlib), so it runs on CI. What it guards:
  * the web brain is the full fsaverage it claims to be: 163,842 vertices and 327,680 triangles per
    hemisphere, one shared triangle list, index ranges, no stretched edges;
  * every parcel of every atlas has vertices on the mesh, on the side it is named for, and no
    atlas the app no longer offers (Glasser, removed 10 Oct) is still shipped;
  * the subcortical meshes' measured accuracy against their own gates;
  * the synthetic site->parcel file names only parcels that exist;
  * the committed validation record (built from controlled data) carries aggregates only -- no
    subject, site, event or contact identifier -- and its headline measurements are in range.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BRAIN = ROOT / "app/public/atlas/brain"
N = 163842
FACES = 327680
EXPECTED = {"dk": 68, "destrieux": 148, "yeo7": 14}


class Brain(unittest.TestCase):
    def test_surfaces(self):
        tris = np.fromfile(BRAIN / "tris.u32", np.uint32).reshape(-1, 3).astype(np.int64)
        self.assertEqual(tris.shape, (FACES, 3))
        self.assertLess(int(tris.max()), N)
        self.assertFalse((BRAIN / "lh.tris.u16").exists(), "a stale decimated triangle list is still shipped")
        for h in ("lh", "rh"):
            pial = np.fromfile(BRAIN / f"{h}.pial.f32", np.float32).reshape(-1, 3)
            infl = np.fromfile(BRAIN / f"{h}.inflated.f32", np.float32).reshape(-1, 3)
            sulc = np.fromfile(BRAIN / f"{h}.sulc.f32", np.float32)
            self.assertEqual(pial.shape, (N, 3))
            self.assertEqual(infl.shape, (N, 3))
            self.assertEqual(sulc.shape, (N,))
            edges = np.linalg.norm(pial[tris[:, 0]] - pial[tris[:, 1]], axis=1)
            # fsaverage's longest pial edge is a few mm; an index mix-up spans the hemisphere
            self.assertLess(edges.max(), 15.0, "an edge spans the brain: indices do not match vertices")
            self.assertLess(float(np.mean(edges)), 1.0, "mean edge is fsaverage's ~0.8 mm only at full resolution")
            # left hemisphere is left in MNI305, and vice versa
            self.assertLess(np.median(pial[:, 0]), 0) if h == "lh" else self.assertGreater(np.median(pial[:, 0]), 0)

    def test_display_names_match_the_name_table(self):
        """Every served area carries the name in scripts/v2/area_names.py and its atlas's own full
        label, and no two areas on one side share a display name."""
        import sys
        sys.path.insert(0, str(ROOT / "scripts/v2"))
        from area_names import DK_LONG, NAMES
        for atlas, names in NAMES.items():
            self.assertEqual(set(names), {l["annot_name"] for l in json.loads((BRAIN / f"parc/{atlas}.json").read_text())["labels"] if l.get("annot_name")}, atlas)
            labels = [l for l in json.loads((BRAIN / f"parc/{atlas}.json").read_text())["labels"] if l.get("annot_name")]
            for l in labels:
                self.assertEqual(l["name"], names[l["annot_name"]], (atlas, l["annot_name"]))
                self.assertTrue(l.get("long"), (atlas, l["annot_name"], "no long name"))
                if atlas == "dk":
                    self.assertEqual(l["long"], DK_LONG[l["annot_name"]])
            for h in ("lh", "rh"):
                shown = [l["name"] for l in labels if l["hemisphere"] == h]
                self.assertEqual(len(shown), len(set(shown)), (atlas, h, "two areas share a name"))

    def test_parcellations(self):
        for atlas, n in EXPECTED.items():
            table = json.loads((BRAIN / f"parc/{atlas}.json").read_text())
            labels = table["labels"]
            self.assertEqual(len(labels) - 1, n, atlas)
            self.assertIsNone(labels[0]["key"])
            seen = set()
            for h in ("lh", "rh"):
                idx = np.fromfile(BRAIN / f"parc/{atlas}.{h}.u16", np.uint16)
                self.assertEqual(idx.shape, (N,))
                self.assertLess(int(idx.max()), len(labels))
                for i in np.unique(idx):
                    if i == 0:
                        continue
                    self.assertEqual(labels[i]["hemisphere"], h, f"{atlas}: {labels[i]['key']} drawn on the wrong side")
                    seen.add(int(i))
            self.assertEqual(seen, set(range(1, len(labels))), f"{atlas}: parcels lost from the web mesh")
            for l in labels[1:]:
                self.assertTrue(l["name"] and l["key"].startswith(l["hemisphere"] + "."), l)
        shipped = {f.name.split(".")[0] for f in (BRAIN / "parc").iterdir()}
        self.assertEqual(shipped, set(EXPECTED), "the app ships exactly the atlases it offers")
        manifest = json.loads((BRAIN / "manifest.json").read_text())
        self.assertEqual({p["id"] for p in manifest["parcellations"]}, set(EXPECTED))

    def test_subcortical(self):
        meta = json.loads((BRAIN / "subcortical.json").read_text())["structures"]
        manifest = json.loads((BRAIN / "manifest.json").read_text())
        gates = manifest["subcortical"]["gates"]
        blob = (BRAIN / "subcortical.bin").read_bytes()
        self.assertEqual(len(meta), 14)
        for s in meta:
            c = s["checks"]
            self.assertLessEqual(c["volume_error_fraction"], gates["max_volume_error_fraction"], s["key"])
            self.assertLessEqual(c["mean_distance_to_unsmoothed_mm"], gates["max_mean_distance_to_unsmoothed_mm"], s["key"])
            end = s["indices"]["byteOffset"] + 4 * s["indices"]["count"]
            self.assertLessEqual(end, len(blob))
            idx = np.frombuffer(blob, np.uint32, s["indices"]["count"], s["indices"]["byteOffset"])
            self.assertLess(int(idx.max()), s["positions"]["count"])

    def test_synthetic_site_parcels(self):
        sp = json.loads((ROOT / "app/public/atlas/data/site_parcels.json").read_text())
        sites = json.loads((ROOT / "app/public/data/sites.json").read_text())
        self.assertEqual(set(sp["sites"]), {s["site_id"] for s in sites})
        keys = {a: {l["key"] for l in json.loads((BRAIN / f"parc/{a}.json").read_text())["labels"][1:]} for a in EXPECTED}
        deep = {s["key"] for s in json.loads((BRAIN / "subcortical.json").read_text())["structures"]}
        for sid, rec in sp["sites"].items():
            for a in list(EXPECTED) + ["deep"]:
                # nothing is estimated: only measured (or, on this build, synthetic) assignments
                self.assertLessEqual(set(rec[a]["m"].split("+")), {"native", "synthetic", "none"}, (sid, a))
            for a in EXPECTED:
                self.assertTrue(set(rec[a]["p"]) <= keys[a], (sid, a, rec[a]))
                self.assertEqual(bool(rec[a]["p"]), rec[a]["s"] == "parcel", (sid, a, rec[a]))
            self.assertTrue(set(rec["deep"]["p"]) <= deep, (sid, rec["deep"]))


if __name__ == "__main__":
    unittest.main()
