// Post-build governance gate (fail-CLOSED).
// `vite build` copies all of public/ into dist/, which includes the CONTROLLED real-data
// trees and the transcript-derived search index. A public/static deploy must NEVER ship
// those. This script removes them from dist/ after every build UNLESS the operator
// explicitly opts into a controlled internal artifact via BUILD_INCLUDE_CONTROLLED=1.
//
// Audit ref: archive/audits/audit_2026-07-21 C3/GOVPUB-001/SEM9-001 (fail-open build shipped controlled data).
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

// STRIP_DIST exists for app/scripts/stripControlled.test.ts, which runs this file against a
// scratch tree; every real build uses ../dist/.
const DIST = process.env.STRIP_DIST || new URL('../dist/', import.meta.url).pathname

// Controlled trees are matched by NAME, at ANY depth, not by an enumerated list. Until 9 October
// this was CONTROLLED_DIRS = ['data-real', 'data-real-staging'], an enumeration -- and an
// enumeration is the surface that silently drops members: public/data-real.pre-provenance/ (a
// backup scripts/migrate_coordinate_provenance.py wrote, holding report_search.json) was copied
// into dist/ by every build and removed by none, and Atlas v2's controlled tier lives one level
// down at v2/data-real/, which a top-level list cannot see either.
//
//   data-real          (any depth)  the controlled tier: removed unless BUILD_INCLUDE_CONTROLLED=1
//   data-real.<suffix> (any depth)  a SNAPSHOT of the controlled tier: removed unconditionally,
//                                   like the .bak files below -- a backup is never the current
//                                   dataset, so no controlled build ships one either
//   data-real-<suffix> (any depth)  staging twins: removed by purgeSuperseded's staging rule or here
// The synthetic trees (data/, v2/data/) are safe by construction and are left untouched.
const isControlledTree = (name) => /^data-real($|-)/.test(name)
const isControlledSnapshot = (name) => /^data-real\./.test(name)

async function exists(p) { try { await stat(p); return true } catch { return false } }

/* AUDIT EXPO-01: superseded snapshots must never ship in ANY artifact.
   The previous logic returned early on BUILD_INCLUDE_CONTROLLED=1 and removed nothing, so
   an internal controlled build shipped whatever happened to be sitting in public/ —
   including sites.json.bak and report_search.json.bak. The latter was the PRE-SCRUB bedside
   corpus: 227,549 characters that the examiner-scrub had deliberately removed (2,482 rows
   containing examiner interrogatives, versus 0 in the live file). "Controlled" is a decision
   about the CURRENT dataset; it is never a decision to ship the input of a scrub. These are
   therefore removed unconditionally, before the opt-in is even considered. */
async function purgeSuperseded(dir) {
  let n = 0
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (isControlledSnapshot(e.name)) { await rm(p, { recursive: true, force: true }); n++; console.log(`[strip-controlled] removed controlled snapshot ${p}`); continue }
      if (/(^|-)staging$|staging$/.test(e.name)) { await rm(p, { recursive: true, force: true }); n++; console.log(`[strip-controlled] removed staging tree ${p}`); continue }
      n += await purgeSuperseded(p)
    } else if (/\.bak$|\.orig$|\.old$|~$/.test(e.name)) {
      await rm(p, { force: true }); n++; console.log(`[strip-controlled] removed superseded snapshot ${p}`)
    }
  }
  return n
}

async function removeControlled(dir) {
  let n = 0
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name)
    if (isControlledTree(e.name)) { await rm(p, { recursive: true, force: true }); n++; console.log(`[strip-controlled] removed ${p}`); continue }
    n += await removeControlled(p)
  }
  return n
}

async function main() {
  if (!(await exists(DIST))) { console.log('[strip-controlled] no dist/ — nothing to do'); return }
  const purged = await purgeSuperseded(DIST)
  if (purged) console.warn(`[strip-controlled] purged ${purged} superseded artifact(s) — these are removed regardless of BUILD_INCLUDE_CONTROLLED.`)
  if (process.env.BUILD_INCLUDE_CONTROLLED === '1') {
    console.warn('[strip-controlled] BUILD_INCLUDE_CONTROLLED=1 — SHIPPING CONTROLLED DATA. Internal artifact only; do NOT deploy publicly.')
    return
  }
  const removed = await removeControlled(DIST)
  console.log(`[strip-controlled] done — public build is controlled-data-free (${removed} tree(s) removed; synthetic data/ preserved). Set BUILD_INCLUDE_CONTROLLED=1 for an internal controlled build.`)
}
main().catch((e) => { console.error('[strip-controlled] FAILED', e); process.exit(1) })
