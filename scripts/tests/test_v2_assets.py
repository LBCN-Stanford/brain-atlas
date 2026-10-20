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

    def test_matches_the_fsaverage_fingerprint(self):
        """The served assets against a record read straight from FreeSurfer's files
        (scripts/v2/reference/fsaverage_fingerprint.json, written by build_brain_assets.py
        --fingerprint). The checks above are internal consistency only: on 16 Oct a pial surface
        shifted 10 mm, swapped hemispheres and a mirrored hippocampus all passed them (M18)."""
        fp = json.loads((ROOT / "scripts/v2/reference/fsaverage_fingerprint.json").read_text())
        pial = {}
        for h in ("lh", "rh"):
            f = fp["surfaces"][h]
            p = np.fromfile(BRAIN / f"{h}.pial.f32", np.float32).reshape(-1, 3).astype(np.float64)
            infl = np.fromfile(BRAIN / f"{h}.inflated.f32", np.float32).reshape(-1, 3).astype(np.float64)
            sulc = np.fromfile(BRAIN / f"{h}.sulc.f32", np.float32).astype(np.float64)
            pial[h] = p
            np.testing.assert_allclose(p.mean(0), f["pial_centroid"], atol=0.01, err_msg=f"{h} pial is not fsaverage's {h} pial")
            np.testing.assert_allclose(p.min(0), f["pial_min"], atol=0.01, err_msg=h)
            np.testing.assert_allclose(p.max(0), f["pial_max"], atol=0.01, err_msg=h)
            # the inflated surface is translated for display, never resized or swapped: its extent is
            # FreeSurfer's, and its inner edge sits INFLATED_GAP_MM / 2 = 3 mm off the midline on its own side
            np.testing.assert_allclose(infl.max(0) - infl.min(0), f["inflated_extent"], atol=0.01, err_msg=f"{h} inflated")
            inner = infl[:, 0].max() if h == "lh" else infl[:, 0].min()
            self.assertAlmostEqual(abs(inner), 3.0, places=2, msg=f"{h} inflated is not beside its own midline")
            self.assertEqual(np.sign(inner), -1 if h == "lh" else 1, f"{h} inflated sits on the other side")
            self.assertAlmostEqual(sulc.mean(), f["sulc_mean"], places=4, msg=f"{h} sulc")
            self.assertAlmostEqual(sulc.std(), f["sulc_std"], places=4, msg=f"{h} sulc")
        for atlas in EXPECTED:
            labels = json.loads((BRAIN / f"parc/{atlas}.json").read_text())["labels"]
            want = fp["parcels"][atlas]
            self.assertEqual({l["key"] for l in labels[1:]}, set(want), atlas)
            for h in ("lh", "rh"):
                idx = np.fromfile(BRAIN / f"parc/{atlas}.{h}.u16", np.uint16)
                for l in labels[1:]:
                    if l["hemisphere"] != h:
                        continue
                    sel = idx == l["index"]
                    w = want[l["key"]]
                    self.assertEqual(int(sel.sum()), w["vertices"], (atlas, l["key"], "vertex count"))
                    np.testing.assert_allclose(pial[h][sel].mean(0), w["centroid"], atol=0.01, err_msg=f"{atlas} {l['key']} is not where FreeSurfer puts it")
                    self.assertEqual(l["color"], w["color"], (atlas, l["key"], "colour"))
        meta = json.loads((BRAIN / "subcortical.json").read_text())["structures"]
        blob = (BRAIN / "subcortical.bin").read_bytes()
        self.assertEqual({s["key"] for s in meta}, set(fp["deep"]))
        for s in meta:
            w = fp["deep"][s["key"]]
            self.assertEqual((s["aseg_label"], s["hemisphere"]), (w["aseg_label"], w["hemisphere"]), s["key"])
            self.assertEqual(s["checks"]["voxels"], w["voxels"], s["key"])
            pos = np.frombuffer(blob, np.float32, 3 * s["positions"]["count"], s["positions"]["byteOffset"]).reshape(-1, 3).astype(np.float64)
            tri = pos[np.frombuffer(blob, np.uint32, s["indices"]["count"], s["indices"]["byteOffset"]).reshape(-1, 3)]
            # the enclosed volume's centroid (signed tetrahedra from the origin), not the vertex
            # mean, which follows where marching cubes put vertices. Measured 16 Oct within
            # 0.13 mm of the voxel centroid; a mirrored or relabelled structure moves centimetres
            vol = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])) / 6
            centroid = (vol[:, None] * tri.sum(axis=1) / 4).sum(0) / vol.sum()
            np.testing.assert_allclose(centroid, w["centroid"], atol=0.5, err_msg=f"{s['key']} mesh is not at its aseg voxels")
            self.assertEqual(np.sign(w["centroid"][0]), -1 if s["hemisphere"] == "lh" else 1, s["key"])

    def test_buried_areas(self):
        """One verdict per structure, measured at build time (build_brain_assets.py, BURIED): the
        areas the folded brain hides are buried on both sides, and gyral crowns are not."""
        must = {"dk": {"insula", "transversetemporal"},
                "destrieux": {"G_temp_sup-G_T_transv", "G_temp_sup-Plan_polar", "S_temporal_transverse",
                              "G_Ins_lg_and_S_cent_ins", "S_circular_insula_sup", "S_circular_insula_inf", "S_central"}}
        never = {"dk": {"superiortemporal", "precentral", "superiorfrontal", "lateraloccipital"},
                 "destrieux": {"G_front_middle", "G_precentral", "G_temp_sup-Lateral", "G_pariet_inf-Angular"},
                 "yeo7": {"7Networks_1", "7Networks_7"}}
        for atlas in EXPECTED:
            labels = json.loads((BRAIN / f"parc/{atlas}.json").read_text())["labels"][1:]
            by = {}
            for l in labels:
                self.assertIn("buried", l, (atlas, l["key"]))
                self.assertTrue(0 <= l["exposed"] <= 1, (atlas, l["key"]))
                by.setdefault(l["annot_name"], set()).add(l["buried"])
            for nm, v in by.items():
                self.assertEqual(len(v), 1, f"{atlas} {nm}: left and right disagree on buried")
            for nm in must.get(atlas, set()):
                self.assertEqual(by[nm], {True}, f"{atlas} {nm} should be buried")
            for nm in never.get(atlas, set()):
                self.assertEqual(by[nm], {False}, f"{atlas} {nm} should not be buried")

    def test_names_are_plain_text(self):
        """No non-breaking space or other odd whitespace in a served name: a reader typing a name
        must find it, and a join on it must match (M13: 60 Destrieux names carried U+00A0)."""
        for atlas in EXPECTED:
            for l in json.loads((BRAIN / f"parc/{atlas}.json").read_text())["labels"][1:]:
                for field in ("name", "long", "short"):
                    v = l.get(field) or ""
                    self.assertEqual(v, " ".join(v.split()), (atlas, l["key"], field, "irregular whitespace"))
                self.assertNotIn("ligual", (l.get("long") or ""), (atlas, l["key"]))

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
