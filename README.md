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
| `scripts/v2/` | the builder of the brain and area assets from FreeSurfer's fsaverage, and the area-name table |

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

Code: BSD-3-Clause (`LICENSE`), copyright The Board of Trustees of the Leland Stanford Junior
University, for the Laboratory of Behavioral and Cognitive Neuroscience. Synthetic demonstration
data: CC BY 4.0 (`LICENSE-DATA`). The fsaverage surfaces and labels under `app/public/atlas/brain/`
are FreeSurfer's, under its licence (`NOTICE`). Libraries and fonts: the `NOTICE.txt` every build
writes. Cite with `CITATION.cff`.

The atlas was developed in the lab's research repository; this repository holds the atlas alone.
