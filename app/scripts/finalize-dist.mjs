// Last build step: fills the site's address into the files that need it.
//   SITE_BASE  the path the site is served under, e.g. '/' or '/brain-atlas/' (default '/')
//   SITE_URL   the canonical origin + base, e.g. 'https://lbcn-stanford.github.io/brain-atlas/'
//              (default: none; canonical and Open Graph URLs are then left out)
//   SITE_INDEX 'yes' lets search engines index the site; anything else (the default) asks them not
//              to, so a preview or demo is not indexed before the lab says it should be
// The 404 page needs SITE_BASE to send an unknown path to the root; index.html, robots.txt and the
// sitemap need SITE_URL for absolute links.
import { readFile, writeFile, stat, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = process.env.FINALIZE_DIST || new URL('../dist/', import.meta.url).pathname
const BASE = process.env.SITE_BASE || '/'
const URL_ = process.env.SITE_URL || ''
const INDEX = process.env.SITE_INDEX === 'yes'

if (!BASE.startsWith('/') || !BASE.endsWith('/')) throw new Error(`SITE_BASE must start and end with '/': ${BASE}`)
if (URL_ && !/^https:\/\/.+\/$/.test(URL_)) throw new Error(`SITE_URL must be an https URL ending in '/': ${URL_}`)

// schema.org Dataset metadata, so dataset search engines can find the release (filled from the
// manifest of the release the build ships)
async function jsonLd() {
  let m = null
  for (const d of ['data-real', 'data']) {
    try { m = JSON.parse(await readFile(join(DIST, d, 'manifest.json'), 'utf8')); break } catch { /* next */ }
  }
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Intracranial Stimulation Atlas: subjective responses to intracranial electrical stimulation',
    description: 'What people reported when small areas of their brain were electrically stimulated during clinical monitoring for epilepsy, one row per stimulation, with the stimulation parameters, the contact pair, its areas in published brain atlases (Desikan-Killiany, Destrieux, Yeo 7 networks, FreeSurfer deep structures), and the bedside report.' + (m?.synthetic ? ' This deployment shows synthetic demonstration data only.' : ''),
    version: m?.version ?? undefined,
    creator: { '@type': 'Organization', name: 'Laboratory of Behavioral and Cognitive Neuroscience (LBCN), Stanford University School of Medicine', url: 'https://med.stanford.edu/parvizi-lab.html' },
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    keywords: ['intracranial electrical stimulation', 'direct cortical stimulation', 'stereo-EEG', 'electrocorticography', 'subjective report', 'brain atlas', 'epilepsy'],
    ...(URL_ ? { url: URL_ } : {}),
  }
  return JSON.stringify(ld).replace(/</g, '\\u003c')
}

async function fill(name, { dropIfNoUrl = false } = {}) {
  const p = join(DIST, name)
  try { await stat(p) } catch { return }
  if (dropIfNoUrl && !URL_) { await rm(p); console.log(`[finalize-dist] ${name}: no SITE_URL, left out`); return }
  let s = await readFile(p, 'utf8')
  s = s.replaceAll('__SITE_BASE__', BASE)
    .replaceAll('__SITE_ROBOTS__', INDEX ? 'index, follow' : 'noindex, nofollow')
    .replaceAll('__ROBOTS_RULE__', INDEX ? 'Allow: /' : 'Disallow: /')
    .replaceAll('__DATASET_JSONLD__', await jsonLd())
  // lines that need an absolute URL are dropped whole when there is none
  s = URL_ ? s.replaceAll('__SITE_URL__', URL_) : s.split('\n').filter((l) => !l.includes('__SITE_URL__')).join('\n')
  await writeFile(p, s)
}

// the served manifest says what the release is and nothing about how the lab builds it: the
// generator's internal labels (project aim numbers, script paths, generator notes) stay out
for (const d of ['data', 'data-real']) {
  const p = join(DIST, d, 'manifest.json')
  let m
  try { m = JSON.parse(await readFile(p, 'utf8')) } catch { continue }
  const out = { name: m.synthetic ? 'Intracranial Stimulation Atlas: synthetic demonstration data' : 'Intracranial Stimulation Atlas data release', version: m.version, synthetic: m.synthetic === true, counts: m.counts }
  if (m.synthetic) out.note = 'All data are synthetic. Coordinates are illustrative, not measured.'
  await writeFile(p, JSON.stringify(out, null, 2) + '\n')
}

// a Content-Security-Policy for the page: everything from the site itself, nothing from anywhere
// else (the inline schema.org block is data, not script, so script-src needs no exception)
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
{
  const p = join(DIST, 'index.html')
  const html = await readFile(p, 'utf8')
  if (!html.includes('Content-Security-Policy')) await writeFile(p, html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`))
}

// a deployed site's repository gets a README saying what it is
if (URL_) {
  let synthetic = false
  try { synthetic = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8')).synthetic === true } catch { /* no synthetic tables */ }
  await writeFile(join(DIST, 'README.md'), [
    '# Intracranial Stimulation Atlas (deployed build)', '',
    `The built site served at ${URL_}. This repository holds the static build only; the source is`,
    'developed by the LBCN, Parvizi Lab, Stanford University.', '',
    ...(synthetic ? ['All data in this build are synthetic demonstration data. It contains no patient data.', ''] : []),
    'See NOTICE.txt for third-party notices, LICENSE.txt for the code and LICENSE-DATA.txt for the data.', '',
  ].join('\n'))
}

await fill('index.html')
await fill('404.html')
await fill('robots.txt')
await fill('sitemap.xml', { dropIfNoUrl: true })
// gzip copies of the brain files that compress well; src/atlas/brain/assets.ts reads them (GZ)
const BRAIN = join(DIST, 'atlas/brain')
const GZ = /^(tris\.u32|subcortical\.bin|parc\/.+\.u16)$/
async function gzipBrain(dir, rel = '') {
  let n = 0
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) n += await gzipBrain(join(dir, e.name), r)
    else if (GZ.test(r)) { await writeFile(join(dir, e.name) + '.gz', gzipSync(await readFile(join(dir, e.name)), { level: 9 })); n++ }
  }
  return n
}
console.log(`[finalize-dist] gzip copies of ${await gzipBrain(BRAIN)} brain file(s)`)
console.log(`[finalize-dist] base ${BASE}${URL_ ? `, canonical ${URL_}` : ', no canonical URL'}`)
