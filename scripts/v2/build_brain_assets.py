#!/usr/bin/env python3
"""Build the anatomical assets Atlas v2 draws: one template brain, four published parcellations,
and the FreeSurfer subcortical structures as closed 3D meshes.

WHY A NEW ASSET FAMILY

v1 draws an ICBM152 2009c pial whose right hemisphere is a mirror of the left, whose licence is
unrecorded, and onto which the parcellations had to be resampled. v2's job is "click a published
parcel, read what people felt there", so the brain it draws must be the brain the parcellations
are defined on. That is FreeSurfer's fsaverage:

  * DK (aparc), Destrieux (aparc.a2009s) and Yeo-7 are distributed BY FreeSurfer on fsaverage, and
    HCP-MMP1.0 (Glasser 2016) is distributed on fsaverage by the projection MNE ships
    (fetch_hcp_mmp_parcellation). Every vertex label below is read from those files, not
    resampled, re-projected or re-drawn.
  * fsaverage surface RAS IS MNI305 (its talairach.xfm is the identity; verified here: the T1's
    vox2ras equals its vox2ras-tkr). Our site coordinates are MNI305, and the 60 pure-ECoG
    subjects' coordinates are fsaverage vertex positions outright (app/src/lib/space/
    coordinateSpace.ts). So sites, surfaces and subcortical meshes share one frame, with no
    transform anywhere in this script.

NO DECIMATION

Every vertex and every triangle of fsaverage's pial and inflated surfaces is written as FreeSurfer
distributes it (163,842 vertices and 327,680 triangles per hemisphere; the two hemispheres share
one triangle list, which is asserted). Each vertex carries the published label of that same vertex
in each annotation, so a parcel on screen is the parcel in the file, at the file's resolution (mean
edge 0.78 mm) -- what freeview or MNE's Brain would show. (The 9 Oct build kept fsaverage's first
40,962 vertices -- the fsaverage6 subset -- which halves the boundary resolution; it was exact at
the vertices it kept, but there is no reason left to keep less than the file.)

The HCP-MMP1.0 annotations are the Mills (2016) fsaverage projection that MNE-Python distributes
(fetch_hcp_mmp_parcellation); their md5 is asserted against the hashes MNE pins for that download.

SUBCORTICAL MESHES

FreeSurfer's fsaverage aseg.mgz (same MNI305 frame), one binary mask per structure, marching cubes
(Lorensen & Cline 1987) at the 0.5 level, then Taubin lambda|mu smoothing (Taubin 1995; the
constants scripts/build_outer_surface.py already uses) because plain Laplacian smoothing shrinks
a mesh. Each mesh's enclosed volume is compared against its voxel count, and its vertices against
the unsmoothed marching-cubes surface; the numbers go in the manifest and a structure that moves
more than the tolerances below FAILS the build rather than shipping.

OUTPUTS (app/public/atlas/brain/)

  {lh,rh}.pial.f32 / .inflated.f32   float32 xyz, 163,842 vertices (fsaverage, as distributed)
  tris.u32                            uint32 triangle indices, 327,680 faces (shared by both hemispheres)
  {lh,rh}.sulc.f32                    FreeSurfer sulc (shading only)
  parc/{atlas}.{lh,rh}.u16            per-vertex index into parc/{atlas}.json labels (0 = none)
  parc/{atlas}.json                   label table: key, display name, hemisphere, colour, group
  subcortical.bin / subcortical.json  concatenated float32 positions + uint32 indices, per structure
  manifest.json                       inputs + sha256, outputs + sha256, frame, checks measured

Run:  python3 scripts/v2/build_brain_assets.py              (fetches fsaverage via MNE if absent)
      python3 scripts/v2/build_brain_assets.py --check      (rebuild in memory, compare hashes)
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app/public/atlas/brain"
MMP_NAMES = ROOT / "scripts/v2/reference/HCP-MMP1_UniqueRegionList.csv"
# Dianne Patterson's region list (bitbucket.org/dpat/tools REF/ATLASES), the table most HCP-MMP
# analyses cite for long names and Glasser's 22 sections. Pinned by hash: a silently edited copy
# would rename areas on screen.
MMP_NAMES_SHA256 = "ee4b54984b9e8601f4a8f55378a909a3b414e02af89072c5dd8e7bb74c2ef623"

FSAVERAGE_N = 163842
FSAVERAGE_FACES = 327680
# md5 of ?h.HCPMMP1.annot as pinned by MNE-Python's fetch_hcp_mmp_parcellation (Mills 2016,
# figshare files 5528816 / 5528819). A different file would be a different parcellation.
HCPMMP1_MD5 = {"lh": "46a102b59b2fb1bb4bd62d51bf02e975", "rh": "75e96b331940227bbcb07c1c791c2463"}
TAUBIN_LAMBDA = 0.5
TAUBIN_MU = -0.53
SUBCORTICAL_SMOOTH_PASSES = 10
# A subcortical mesh may differ from its voxel volume by at most this fraction, and its vertices
# may sit at most this far (mean) from the unsmoothed marching-cubes surface. Both are measured
# and recorded; these are the gates, set before the first run and not moved after it.
MAX_VOLUME_ERROR = 0.05
MAX_MEAN_DISPLACEMENT_MM = 0.5

# Display-only offset for the inflated surfaces: each hemisphere is moved sideways so the two
# balloons do not interpenetrate at the midline. Inflated coordinates are never used to place or
# measure anything.
INFLATED_GAP_MM = 6.0

# FreeSurfer aseg structures offered as clickable deep structures. Ventral DC and brainstem are
# segmented but left out: neither is a target anyone reads stimulation reports for, and both
# would sit in front of the structures that are.
SUBCORTICAL = [
    (10, "Left-Thalamus", "Thalamus", "lh"), (49, "Right-Thalamus", "Thalamus", "rh"),
    (11, "Left-Caudate", "Caudate", "lh"), (50, "Right-Caudate", "Caudate", "rh"),
    (12, "Left-Putamen", "Putamen", "lh"), (51, "Right-Putamen", "Putamen", "rh"),
    (13, "Left-Pallidum", "Globus pallidus", "lh"), (52, "Right-Pallidum", "Globus pallidus", "rh"),
    (17, "Left-Hippocampus", "Hippocampus", "lh"), (53, "Right-Hippocampus", "Hippocampus", "rh"),
    (18, "Left-Amygdala", "Amygdala", "lh"), (54, "Right-Amygdala", "Amygdala", "rh"),
    (26, "Left-Accumbens-area", "Nucleus accumbens", "lh"), (58, "Right-Accumbens-area", "Nucleus accumbens", "rh"),
]


# Yeo et al. 2011, 7-network solution: network numbers as distributed, names as the paper uses them.

# Glasser areas whose section the two machine-readable mappings disagree on. Both are faithful to
# Glasser et al. 2016's Supplementary Neuroanatomical Results, which itself places these six areas
# in two sections: the region list follows Supplementary Table 1's bold "primary section in which
# the area is described"; MNE's HCPMMP1_combined follows the member list that opens each section
# (read from the supplement on 9 Oct 2026; scratchpad research/01_parcellation_standards.md quotes
# the pages). For NAVIGATION -- "which group do I find this area under" -- the member lists are the
# right reading, so the six are pinned to them. Both assignments stay in manifest.json.
SECTION_OVERRIDES: dict[str, str] = {
    "23C": "Posterior Cingulate",
    "A47R": "Orbital and Polar Frontal",
    "52": "Insular and Frontal Opercular",
    "PFCM": "Posterior Opercular",
    "TF": "Lateral Temporal",
    "POFC": "Orbital and Polar Frontal",
}

# display names (short) and Desikan's long names: one table, also read by the tests
sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_names import DK_LONG, NAMES  # noqa: E402

DESTRIEUX_NAMES = ROOT / "scripts/v2/reference/destrieux_labels_canlab.csv"
# Destrieux et al. 2010 Table 1 long names, as distributed by the CANlab Neuroimaging_Pattern_Masks
# repository (Atlases_and_parcellations/2009_destrieux/destrieux_labels.csv). Pinned by hash.
DESTRIEUX_NAMES_SHA256 = "39f9a2c62f19aa5b8faa7ad5109b71e2b8a8ff14b2dc39447c5a1099e5c2222a"

# Labels that mark "no parcel here" in each annotation: the medial wall and its relatives.
NON_PARCEL = {"unknown", "Unknown", "corpuscallosum", "Medial_wall", "???", "FreeSurfer_Defined_Medial_Wall"}

ATLASES = [
    # id, annot stem, display name, short description
    ("glasser", "HCPMMP1", "Glasser (HCP-MMP1.0)", "360 areas; Glasser et al. 2016, Nature"),
    ("dk", "aparc", "Desikan-Killiany", "68 regions; Desikan et al. 2006, NeuroImage"),
    ("destrieux", "aparc.a2009s", "Destrieux", "148 regions; Destrieux et al. 2010, NeuroImage"),
    ("yeo7", "Yeo2011_7Networks_N1000", "Yeo 7 networks", "7 networks; Yeo et al. 2011, J Neurophysiol"),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fsaverage_dir(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    default = Path.home() / "mne_data/MNE-fsaverage-data/fsaverage"
    if default.exists():
        return default
    import mne  # noqa: PLC0415 -- only needed to fetch
    return Path(mne.datasets.fetch_fsaverage(verbose=False))


def mmp_table() -> dict[str, dict]:
    if sha256(MMP_NAMES) != MMP_NAMES_SHA256:
        raise SystemExit(f"{MMP_NAMES} does not match its pinned sha256")
    out = {}
    with open(MMP_NAMES, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            # The list spells one section two ways (TPOJ1's row drops a hyphen). One section, so
            # normalise the spelling; the count check below would catch a 23rd section.
            section = r["cortex"].replace("Temporo-Parieto_Occipital", "Temporo-Parieto-Occipital")
            # Keyed case-insensitively: the list spells area 7PL as "7Pl" while the annotation
            # (and Glasser 2016) spell it "7PL". The uniqueness check below keeps this honest.
            out[f"{r['LR']}_{r['region']}_ROI".upper()] = {
                "short": r["region"],
                "long": r["regionLongName"].rsplit("_", 1)[0].replace("_", " "),
                "section": section.replace("_", " "),
            }
    if len(out) != 360 or len({v["section"] for v in out.values()}) != 22:
        raise SystemExit("HCP-MMP1 region list must have 360 areas in 22 sections")
    return out


def destrieux_table() -> dict[str, str]:
    if sha256(DESTRIEUX_NAMES) != DESTRIEUX_NAMES_SHA256:
        raise SystemExit(f"{DESTRIEUX_NAMES} does not match its pinned sha256")
    out = {}
    with open(DESTRIEUX_NAMES, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["labels"].startswith("L_"):
                out[r["labels"][2:].replace("&", "_and_")] = r["label_descriptions"].rsplit(" (left)", 1)[0]
    return out


def taubin(V: np.ndarray, F: np.ndarray, passes: int) -> np.ndarray:
    from scipy import sparse  # noqa: PLC0415
    n = len(V)
    i = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    j = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = sparse.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    A.data[:] = 1.0  # duplicate edges collapse to adjacency
    deg = np.asarray(A.sum(axis=1)).ravel()
    W = sparse.diags(1.0 / np.maximum(deg, 1)) @ A
    P = V.copy()
    for _ in range(passes):
        P = P + TAUBIN_LAMBDA * (W @ P - P)
        P = P + TAUBIN_MU * (W @ P - P)
    return P


def mesh_volume(V: np.ndarray, F: np.ndarray) -> float:
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0)


def build_subcortical(fs: Path):
    import nibabel as nib  # noqa: PLC0415
    from scipy.spatial import cKDTree  # noqa: PLC0415
    from skimage.measure import marching_cubes  # noqa: PLC0415

    img = nib.load(str(fs / "mri/aseg.mgz"))
    aseg = np.asarray(img.dataobj).astype(np.int32)
    affine = img.affine
    voxel_mm3 = float(abs(np.linalg.det(affine[:3, :3])))
    from mne._freesurfer import read_freesurfer_lut  # noqa: PLC0415
    lut, colours = read_freesurfer_lut()
    id_to_name = {v: k for k, v in lut.items()}

    blobs, structures = [], []
    offset = 0
    for label, key, name, hemi in SUBCORTICAL:
        mask = aseg == label
        nvox = int(mask.sum())
        if nvox == 0:
            raise SystemExit(f"aseg label {label} ({key}) is empty in {fs}")
        pad = np.pad(mask, 1).astype(np.float32)
        verts, faces, _, _ = marching_cubes(pad, level=0.5)
        verts -= 1.0  # undo the pad
        ras = nib.affines.apply_affine(affine, verts)
        smooth = taubin(ras, faces.astype(np.int64), SUBCORTICAL_SMOOTH_PASSES)
        vol_mc = mesh_volume(ras, faces)
        vol_sm = mesh_volume(smooth, faces)
        vol_vox = nvox * voxel_mm3
        disp = np.linalg.norm(smooth - ras, axis=1)
        # distance from each smoothed vertex to the nearest unsmoothed vertex: a conservative
        # (upper-bound) proxy for distance to the unsmoothed surface
        d_surf, _ = cKDTree(ras).query(smooth)
        vol_err = abs(vol_sm - vol_vox) / vol_vox
        if vol_err > MAX_VOLUME_ERROR or float(d_surf.mean()) > MAX_MEAN_DISPLACEMENT_MM:
            raise SystemExit(f"{key}: volume error {vol_err:.3f} or mean displacement {d_surf.mean():.2f} mm exceeds the gate")
        pos = smooth.astype(np.float32)
        idx = faces.astype(np.uint32)
        blobs.append(pos.tobytes())
        blobs.append(idx.tobytes())
        fs_name = id_to_name.get(label, key)
        rgb = [int(x) for x in colours[fs_name][:3]] if fs_name in colours else [200, 200, 200]
        structures.append({
            "key": key,
            "aseg_label": label,
            "aseg_name": fs_name,
            "name": name,
            "hemisphere": hemi,
            "color": "#%02x%02x%02x" % tuple(rgb),
            "positions": {"byteOffset": offset, "count": int(len(pos))},
            "indices": {"byteOffset": offset + pos.nbytes, "count": int(idx.size)},
            "checks": {
                "voxels": nvox,
                "voxel_volume_mm3": round(vol_vox, 1),
                "marching_cubes_volume_mm3": round(vol_mc, 1),
                "smoothed_volume_mm3": round(vol_sm, 1),
                "volume_error_fraction": round(vol_err, 4),
                "mean_vertex_shift_mm": round(float(disp.mean()), 3),
                "mean_distance_to_unsmoothed_mm": round(float(d_surf.mean()), 3),
                "max_distance_to_unsmoothed_mm": round(float(d_surf.max()), 3),
            },
        })
        offset += pos.nbytes + idx.nbytes
    return b"".join(blobs), structures


def build(fs: Path, glasser: bool = False) -> dict[str, bytes]:
    import nibabel as nib  # noqa: PLC0415

    t1 = nib.load(str(fs / "mri/T1.mgz"))
    if not np.allclose(t1.header.get_vox2ras(), t1.header.get_vox2ras_tkr()):
        raise SystemExit("fsaverage scanner RAS != tkr RAS; the surfaces would not be MNI305")
    files: dict[str, bytes] = {}
    surf_stats = {}

    pial, infl, faces = {}, {}, {}
    for h in ("lh", "rh"):
        p, fp = nib.freesurfer.read_geometry(str(fs / f"surf/{h}.pial"))
        i, fi = nib.freesurfer.read_geometry(str(fs / f"surf/{h}.inflated"))
        if len(p) != FSAVERAGE_N or len(fp) != FSAVERAGE_FACES or not np.array_equal(fp, fi):
            raise SystemExit(f"{h}: not fsaverage's {FSAVERAGE_N}-vertex pial/inflated pair")
        pial[h], infl[h], faces[h] = p, i, fp
        e = np.linalg.norm(p[fp[:, 0]] - p[fp[:, 1]], axis=1)
        surf_stats[h] = {"vertices": int(len(p)), "faces": int(len(fp)), "mean_edge_mm": round(float(e.mean()), 3),
                         "median_edge_mm": round(float(np.median(e)), 3), "max_edge_mm": round(float(e.max()), 3)}
    if not np.array_equal(faces["lh"], faces["rh"]):
        raise SystemExit("lh and rh fsaverage triangle lists differ; one shared tris.u32 would be wrong")
    tris = faces["lh"]

    # Inflated (display only): FreeSurfer centres each inflated hemisphere on the origin, so the two
    # overlap. Like MNE's Brain (offset=True for inflated surfaces), shift each sideways so they sit
    # apart; additionally centre each on its own pial centre in y/z so folding<->inflating does not
    # slide the brain across the screen. Inflated coordinates are never used to place anything.
    for h, sign in (("lh", -1), ("rh", 1)):
        c = infl[h].mean(0)
        target_yz = pial[h].mean(0)
        moved = infl[h] - c
        moved[:, 1:] += target_yz[1:]
        inner = moved[:, 0].max() if sign < 0 else moved[:, 0].min()
        moved[:, 0] += sign * INFLATED_GAP_MM / 2 - inner
        infl[h] = moved

    files["tris.u32"] = tris.astype(np.uint32).tobytes()
    for h in ("lh", "rh"):
        files[f"{h}.pial.f32"] = pial[h].astype(np.float32).tobytes()
        files[f"{h}.inflated.f32"] = infl[h].astype(np.float32).tobytes()
        sulc = nib.freesurfer.read_morph_data(str(fs / f"surf/{h}.sulc"))
        files[f"{h}.sulc.f32"] = sulc.astype(np.float32).tobytes()

    mmp = mmp_table() if glasser else {}
    destrieux = destrieux_table()
    parc_meta = []
    # Glasser was removed from the v2 app on 10 Oct ("for now"); --glasser builds it again
    atlases = [a for a in ATLASES if glasser or a[0] != "glasser"]
    for atlas_id, stem, title, cite in atlases:
        labels = [{"index": 0, "key": None, "name": "No parcel", "hemisphere": None, "color": None, "group": None}]
        per_hemi = {}
        min_vertices = None
        for h in ("lh", "rh"):
            path = fs / f"label/{h}.{stem}.annot"
            if stem == "HCPMMP1" and hashlib.md5(path.read_bytes()).hexdigest() != HCPMMP1_MD5[h]:
                raise SystemExit(f"{path} is not the Mills 2016 projection MNE distributes (md5 mismatch)")
            lab, ctab, names = nib.freesurfer.read_annot(str(path))
            names = [n.decode() for n in names]
            out = np.zeros(len(lab), np.uint16)
            for k, nm in enumerate(names):
                if nm in NON_PARCEL:
                    continue
                n_full = int((lab == k).sum())
                if n_full == 0:
                    continue  # in the colour table, absent from the surface
                min_vertices = n_full if min_vertices is None else min(min_vertices, n_full)
                index = len(labels)
                rgb = ctab[k, :3].tolist()
                entry = {"index": index, "key": f"{h}.{nm}", "annot_name": nm, "hemisphere": h,
                         "color": "#%02x%02x%02x" % tuple(int(x) for x in rgb), "vertices": n_full}
                if atlas_id == "glasser":
                    m = mmp.get(nm.upper())
                    if m is None:
                        raise SystemExit(f"glasser area {nm} missing from the region list")
                    entry.update(name=m["long"], short=m["short"], group=m["section"])
                elif atlas_id == "dk":
                    if nm not in NAMES["dk"] or nm not in DK_LONG:
                        raise SystemExit(f"DK label {nm} has no display name")
                    entry.update(name=NAMES["dk"][nm], long=DK_LONG[nm], short=nm, group=None)
                elif atlas_id == "yeo7":
                    entry.update(name=NAMES["yeo7"][nm], long=NAMES["yeo7"][nm], short=nm, group=None)
                elif atlas_id == "destrieux":
                    if nm not in destrieux or nm not in NAMES["destrieux"]:
                        raise SystemExit(f"Destrieux label {nm} has no name")
                    entry.update(name=NAMES["destrieux"][nm], long=destrieux[nm], short=nm, group=None)
                else:
                    raise SystemExit(f"no naming rule for atlas {atlas_id}")
                labels.append(entry)
                out[lab == k] = index
            per_hemi[h] = out
            files[f"parc/{atlas_id}.{h}.u16"] = out.tobytes()
        expected = {"glasser": 360, "dk": 68, "destrieux": 148, "yeo7": 14}[atlas_id]
        if len(labels) - 1 != expected:
            raise SystemExit(f"{atlas_id}: {len(labels) - 1} parcels, expected {expected}")
        files[f"parc/{atlas_id}.json"] = json.dumps(
            {"id": atlas_id, "title": title, "citation": cite, "annotation": stem, "labels": labels},
            indent=1).encode()
        parc_meta.append({"id": atlas_id, "title": title, "citation": cite, "parcels": len(labels) - 1,
                          "min_vertices": min_vertices})

    # Glasser sections must agree with the HCPMMP1_combined annotation MNE ships alongside it:
    # every area's vertices should fall in one combined region. Measured as purity. The combined
    # annotation's spelling ("Early Auditory Cortex") is the one shown on screen.
    purity = None
    if glasser:
        purity, display = glasser_section_purity(fs, mmp)
        gl = json.loads(files["parc/glasser.json"])
        for e in gl["labels"][1:]:
            area = e["annot_name"].split("_", 1)[1].rsplit("_", 1)[0].upper()
            section = SECTION_OVERRIDES.get(area, e["group"])
            e["group"] = display[_norm(section)]
            if area in SECTION_OVERRIDES:
                e["group_source"] = "Glasser 2016 Supplementary Neuroanatomical Results (override; see SECTION_OVERRIDES)"
        files["parc/glasser.json"] = json.dumps(gl, indent=1).encode()

    sub_bin, structures = build_subcortical(fs)
    files["subcortical.bin"] = sub_bin
    files["subcortical.json"] = json.dumps({"structures": structures}, indent=1).encode()

    inputs = {}
    for rel in ["surf/lh.pial", "surf/rh.pial", "surf/lh.inflated", "surf/rh.inflated", "surf/lh.sulc",
                "surf/rh.sulc", "mri/aseg.mgz"] + [f"label/{h}.{s}.annot" for _, s, _, _ in atlases for h in ("lh", "rh")]:
        inputs[f"fsaverage/{rel}"] = sha256(fs / rel)
    if glasser:
        inputs["scripts/v2/reference/HCP-MMP1_UniqueRegionList.csv"] = MMP_NAMES_SHA256
    inputs["scripts/v2/reference/destrieux_labels_canlab.csv"] = DESTRIEUX_NAMES_SHA256

    manifest = {
        "builder": "scripts/v2/build_brain_assets.py",
        "frame": "MNI305 = fsaverage surface RAS (fsaverage talairach.xfm is the identity; checked: T1 vox2ras == vox2ras-tkr)",
        "template": "FreeSurfer fsaverage (as distributed by MNE-Python's fetch_fsaverage)" + ("; HCPMMP1 annotations from MNE's fetch_hcp_mmp_parcellation" if glasser else ""),
        "geometry": {
            "method": "fsaverage pial and inflated as distributed: every vertex, every triangle, no decimation",
            "surfaces": surf_stats,
        },
        **({"hcpmmp1_md5": HCPMMP1_MD5} if glasser else {}),
        "inflated_display_gap_mm": INFLATED_GAP_MM,
        "parcellations": parc_meta,
        **({"glasser_section_purity": purity} if glasser else {}),
        "subcortical": {
            "source": "fsaverage mri/aseg.mgz",
            "method": f"marching cubes at 0.5 on each binary mask, then Taubin smoothing (lambda {TAUBIN_LAMBDA}, mu {TAUBIN_MU}, {SUBCORTICAL_SMOOTH_PASSES} passes)",
            "gates": {"max_volume_error_fraction": MAX_VOLUME_ERROR, "max_mean_distance_to_unsmoothed_mm": MAX_MEAN_DISPLACEMENT_MM},
            "structures": len(structures),
        },
        "licences": {
            "fsaverage surfaces, aseg, aparc, aparc.a2009s, Yeo2011": "FreeSurfer distribution (FreeSurfer Software License); redistribution terms to be confirmed before any public release",
            **({"HCPMMP1 (Glasser 2016) on fsaverage": "derived from HCP-MMP1.0 (HCP data use terms) via the Mills 2016 fsaverage projection; NOT cleared for public redistribution"} if glasser else {}),
        },
        "redistributable": False,
        "inputs": inputs,
    }
    files["manifest.json"] = json.dumps(manifest, indent=1).encode()
    return files


def glasser_section_purity(fs: Path, mmp: dict) -> dict:
    import nibabel as nib  # noqa: PLC0415
    worst, total, agree = 1.0, 0, 0
    display: dict[str, str] = {}
    disagreements: list[dict] = []
    for h in ("lh", "rh"):
        a, _, an = nib.freesurfer.read_annot(str(fs / f"label/{h}.HCPMMP1.annot"))
        c, _, cn = nib.freesurfer.read_annot(str(fs / f"label/{h}.HCPMMP1_combined.annot"))
        an = [x.decode() for x in an]
        cn = [x.decode() for x in cn]
        for k, nm in enumerate(an):
            if nm in NON_PARCEL:
                continue
            sel = a == k
            if not sel.any():
                continue
            vals, counts = np.unique(c[sel], return_counts=True)
            top = counts.max()
            worst = min(worst, top / sel.sum())
            total += int(sel.sum())
            agree += int(top)
            combined_name = cn[vals[counts.argmax()]]
            ours = mmp[nm.upper()]["section"]
            if _norm(combined_name) != _norm(ours):
                # The two machine-readable mappings disagree for six areas per hemisphere. Neither
                # is the primary source (Glasser 2016, Supplementary Neuroanatomical Results), so
                # the disagreement is recorded, not resolved by preference; SECTION_OVERRIDES
                # pins an area only once the primary source has been read.
                disagreements.append({"area": nm, "region_list": ours, "mne_combined": combined_name})
            else:
                display[_norm(ours)] = combined_name
    return ({"vertex_agreement": round(agree / total, 5), "worst_area_purity": round(float(worst), 4),
             "section_disagreements": disagreements}, display)


def _norm(s: str) -> str:
    import re  # noqa: PLC0415
    s = re.sub(r"\(.*?\)", "", s).lower().replace("cortex", "").replace("-", " ").replace("_", " ").replace(" and ", " ")
    return " ".join(s.split())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fsaverage", help="fsaverage subject dir (default: MNE's download)")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--check", action="store_true", help="rebuild in memory and compare with the files on disk")
    ap.add_argument("--glasser", action="store_true", help="also build Glasser (HCP-MMP1.0), removed from the app on 10 Oct")
    a = ap.parse_args()
    files = build(fsaverage_dir(a.fsaverage), glasser=a.glasser)
    out = Path(a.out)
    if a.check:
        bad = [k for k, v in files.items() if not (out / k).exists() or (out / k).read_bytes() != v]
        if bad:
            print("STALE or missing:", *bad, sep="\n  ")
            return 1
        print(f"{len(files)} asset files match a fresh build")
        return 0
    for k, v in files.items():
        p = out / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(v)
    m = json.loads(files["manifest.json"])
    print(f"wrote {len(files)} files to {out}")
    print("parcellations:", ", ".join(f"{p['id']} {p['parcels']} (smallest {p['min_vertices']} vertices)" for p in m["parcellations"]))
    if "glasser_section_purity" in m:
        print("glasser section purity:", m["glasser_section_purity"])
    for s in json.loads(files["subcortical.json"])["structures"]:
        c = s["checks"]
        print(f"  {s['key']:<22} vox {c['voxel_volume_mm3']:>8} mesh {c['smoothed_volume_mm3']:>8} err {c['volume_error_fraction']:.3f} "
              f"d̄ {c['mean_distance_to_unsmoothed_mm']:.2f} mm (max {c['max_distance_to_unsmoothed_mm']:.2f})")
    total = sum(len(v) for v in files.values())
    print(f"total {total / 1e6:.1f} MB uncompressed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
