// Post-build allowlist: dist/ keeps only what the atlas reads, plus the site's own files.
// `vite build` copies all of public/ into dist/, and public/ also holds the earlier analysis app's
// assets (template volumes, third-party atlases under their own licences, every synthetic table,
// CSV exports). None of that is read by the atlas, and none of it should be served. A list of what
// to KEEP, not of what to drop: anything new that lands in public/ stays out until it is named here.
import { readdir, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const DIST = process.env.PRUNE_DIST || new URL('../dist/', import.meta.url).pathname

// the tables the atlas loads (src/atlas/data.tsx: lib/core REQUIRED plus 'reports')
const TABLES = ['manifest', 'patients', 'sessions', 'sites', 'stimulation_events', 'effect_labels', 'qc_flags', 'reports']
const DATA_DIRS = ['data', 'data-real']

const KEEP = [
  /^index\.html$/, /^404\.html$/, /^robots\.txt$/, /^sitemap\.xml$/, /^favicon\.svg$/, /^og-image\.png$/,
  /^site\.webmanifest$/, /^LICENSE(-DATA)?(\.txt)?$/, /^NOTICE(\.txt)?$/, /^CITATION\.(cff|bib)$/, /^\.nojekyll$/,
  /^assets\/[^/]+$/,
  /^atlas\/brain\/.+/,
  new RegExp(`^atlas\\/(${DATA_DIRS.join('|')})\\/(site_parcels|report_text)\\.json$`),
  new RegExp(`^(${DATA_DIRS.join('|')})\\/(${TABLES.join('|')})\\.json$`),
]

const keep = (rel) => KEEP.some((re) => re.test(rel))

async function walk(dir) {
  let removed = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const rel = relative(DIST, p).split(sep).join('/')
    if (e.isDirectory()) {
      removed += await walk(p)
      if ((await readdir(p)).length === 0) await rm(p, { recursive: true })
    } else if (!keep(rel)) {
      await rm(p)
      removed++
    }
  }
  return removed
}

async function main() {
  try { await stat(DIST) } catch { console.log('[prune-dist] no dist/ — nothing to do'); return }
  const n = await walk(DIST)
  console.log(`[prune-dist] removed ${n} file(s) the atlas does not read`)
}
main().catch((e) => { console.error('[prune-dist] FAILED', e); process.exit(1) })
