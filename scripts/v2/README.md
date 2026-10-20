> In this public repository only `build_brain_assets.py` (the brain and area files, from
> FreeSurfer's public fsaverage template) and the area-name table (`area_names.py`,
> `apply_area_names.py`) are included. The other steps below read controlled patient data on
> the lab machine and live in the lab's research repository.

# The atlas: build scripts

The atlas is the site's only page (`app/index.html`, code in `app/src/atlas/`; it began as Atlas v2, a separate `v2.html`, until 16 Oct) that shares v1's data loader and
nothing else. It draws FreeSurfer's fsaverage with three published parcellations (Desikan-Killiany,
Destrieux, Yeo-7) and the FreeSurfer deep structures, lets a user select up to eight areas, shows the
bedside reports of the stimulations in them, colours a coverage map, and downloads the reports or the
map (figure, per-area table, GIFTI). Glasser was removed on 10 Oct, for now; `--glasser` on step 1
builds its assets again, and commit 257313d has the site-assignment route and the native-Glasser merge. The decisions behind it are in `notebook/2026-10-10-atlas-v2.md`.

Run order (all from the repo root):

| Step | Script | Writes | Tracked? |
|---|---|---|---|
| 1 | `build_brain_assets.py` | `app/public/atlas/brain/` — the full fsaverage pial/inflated/sulc (163,842 vertices per hemisphere, one shared `tris.u32`), per-vertex labels for Desikan-Killiany, Destrieux, Yeo-7, 14 subcortical meshes, `manifest.json` | yes (private repo; not cleared for public redistribution — see the manifest's `licences`) |
| 2 | `build_site_parcels.py --data data-real` | `app/public/atlas/data-real/site_parcels.json` (per site and per contact; stamped with the release); `docs/provenance/v2_site_parcels_validation.json` | controlled file: **no** (gitignored); validation record: yes (aggregates only) |
| 2s | `build_site_parcels.py --data data` | `app/public/atlas/data/site_parcels.json` (synthetic build) | yes |
| 3 | `build_report_text.py` | `app/public/atlas/data-real/report_text.json` (verbatim bedside text, stamped with the release) | **no** — controlled, gitignored, stripped from every build |
| lab | `native_glasser_lab_machine.py` | `build_staging/v2/native_glasser_contacts.csv`, kept for when Glasser returns (step 2 no longer reads it) | no |

Step 1 fetches fsaverage through MNE (`~/mne_data`) if it is not there. `--check` rebuilds in memory
and compares with the files on disk. `--fingerprint` writes `reference/fsaverage_fingerprint.json`,
a small record of fsaverage read straight from FreeSurfer's files (centroids, per-area vertex counts
and colours, deep-structure voxel centroids) that `test_v2_assets.py` checks the served assets
against on CI, where fsaverage is absent. Step 1 also measures which areas the folded brain hides
(`buried` in each `parc/*.json`, rule `BURIED` in the script): the app shows those on the smoothed
surface when one is picked.

Reference tables, pinned by hash in `build_brain_assets.py`:

- `reference/HCP-MMP1_UniqueRegionList.csv` — Glasser area long names and sections, used only with
  `--glasser` (U. Arizona neuroimaging core, bitbucket `dpat/tools`). Six areas are re-pinned to the
  section-membership lists of Glasser et al. 2016's supplement; see `SECTION_OVERRIDES`.
- `reference/destrieux_labels_canlab.csv` — Destrieux et al. 2010 long names (CANlab
  `Neuroimaging_Pattern_Masks`). It is a lightly edited copy of Table 1: it drops the gyral numbering
  (F1-F3, T1-T3, O1-O3), separates many words with non-breaking spaces, and spells "lingual" as
  "ligual" once. The builder collapses the spaces and corrects the spelling (`DESTRIEUX_FIXES`); the
  pinned file is left as published.

**The assignment rule** (details in `build_site_parcels.py`'s docstring and the notebook note):
measured labels only. DK, Destrieux, Yeo-7 and deep structures come from each patient's own iELVis
readout, and a contact with none is in no area. Surface contacts are drawn at the fsaverage vertex
they were registered to; depth contacts are not drawn. A person is held (in no area, marked in the
download) when anything on record questions where their electrodes are: the lab's own notes,
conflicting localisation sheets, contact identity verified only as a set, or no native coordinate. The app refuses either v2 file if
it was built for a different release than the one loaded.

To run the app: `cd app && npm run dev`, then open `http://localhost:5173/`. The data
directory follows `VITE_DATA_DIR` exactly as v1 does (`data-real` locally, synthetic `data` otherwise);
v2 reads `public/atlas/<the same name>/`, and a directory with no v2 build is an error.
(The optional AI overview of 10 Oct was removed on 16 Oct.)

Tests: `app/scripts/atlas.test.ts` (in `npm test`), `app/scripts/atlas_e2e.mjs` (the built site in a browser; CI), `scripts/tests/test_v2_assets.py` (CI), and
`scripts/tests/test_v2_native_glasser_lookup.py` and `scripts/tests/test_v2_assets_fresh.py` (both need the fsaverage download; declared SKIP on CI).
