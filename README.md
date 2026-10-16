# Intracranial Stimulation Atlas

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
