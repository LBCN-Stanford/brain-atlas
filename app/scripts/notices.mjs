// Writes the site's licence files into dist/:
//   LICENSE.txt       the code's licence (the repository's BSD-3-Clause LICENSE)
//   LICENSE-DATA.txt  the derived and synthetic data's licence (CC BY 4.0)
//   NOTICE.txt        every third-party notice the deployed files require, gathered from the
//                     licence files that ship with each dependency, so it cannot drift from what
//                     is bundled: FreeSurfer's Part B (with its required preface), the MIT/ISC
//                     notices of the JavaScript libraries, and the OFL text of the fonts.
// A missing licence file fails the build: shipping without a notice is not an option.
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const APP = new URL('..', import.meta.url).pathname
const DIST = process.env.NOTICES_DIST || join(APP, 'dist')

// the packages whose code or files the atlas bundle contains (src/atlas imports, plus react-dom's scheduler)
const PACKAGES = ['react', 'react-dom', 'scheduler', 'three', 'three-mesh-bvh', 'lucide-react', '@fontsource/ibm-plex-sans', '@fontsource/source-serif-4']

// the fonts' own copyright lines, as their upstream OFL files give them: @fontsource's packaging
// names only "Google Inc." / "IBM Corp.", and OFL condition 2 asks for the notice in each copy
// (checked against adobe-fonts/source-serif and IBM/plex, 19 Oct 2026)
const UPSTREAM_COPYRIGHT = {
  '@fontsource/source-serif-4': 'Copyright 2014 - 2023 Adobe (http://www.adobe.com/), with Reserved Font Name \u2018Source\u2019. All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries.',
  '@fontsource/ibm-plex-sans': 'Copyright \u00a9 2017 IBM Corp. with Reserved Font Name "Plex"',
}

async function pkgNotice(name) {
  const dir = join(APP, 'node_modules', name)
  const meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE']) {
    let text
    try { text = (await readFile(join(dir, f), 'utf8')).trim() } catch { continue }
    return { name, version: meta.version, license: meta.license, text: UPSTREAM_COPYRIGHT[name] ? `${UPSTREAM_COPYRIGHT[name]}\n\n${text}` : text }
  }
  throw new Error(`no licence file found for ${name}`)
}

async function main() {
  try { await stat(DIST) } catch { console.log('[notices] no dist/ — nothing to do'); return }
  const fs = await readFile(join(APP, 'licenses/freesurfer-LICENSE.txt'), 'utf8')
  const a = fs.indexOf('PART B.'), b = fs.indexOf('PART C.')
  if (a < 0 || b < a) throw new Error('FreeSurfer licence: Part B not found')
  const partB = fs.slice(a, b).trim()
  const deps = await Promise.all(PACKAGES.map(pkgNotice))
  const rule = '='.repeat(78)
  const out = [
    'THIRD-PARTY NOTICES',
    rule,
    '',
    'This site redistributes the third-party material listed below. Each notice is reproduced as',
    'its licence requires. The site\'s own code is under LICENSE.txt and its synthetic demonstration',
    'data under LICENSE-DATA.txt. Patient-derived data are not licensed by any of these files.',
    '',
    rule,
    'FreeSurfer: the fsaverage surfaces, the deep-structure surfaces built from fsaverage\'s',
    'segmentation, and the Desikan-Killiany, Destrieux and Yeo 7-network labels (files under',
    'atlas/brain/). These were converted from FreeSurfer\'s files into binary arrays and are',
    'therefore MODIFIED VERSIONS of the Software.',
    rule,
    '',
    'All or portions of this licensed product (such portions are the "Software") have been obtained',
    'under license from The General Hospital Corporation "MGH" and are subject to the following',
    'terms and conditions:',
    '',
    partB,
    '',
    ...deps.flatMap((d) => [rule, `${d.name} ${d.version} (${d.license})`, rule, '', d.text, '']),
  ].join('\n')
  await writeFile(join(DIST, 'NOTICE.txt'), out + '\n')
  await writeFile(join(DIST, 'LICENSE.txt'), await readFile(join(APP, '../LICENSE'), 'utf8'))
  // the site's own data licence: the repository's LICENSE-DATA names repository folders and
  // templates this site does not serve (text audit T8)
  await writeFile(join(DIST, 'LICENSE-DATA.txt'), [
    'Data licence for this site',
    '',
    'The synthetic demonstration data this site serves, under data/ and atlas/data/, are licensed under',
    'Creative Commons Attribution 4.0 International (CC BY 4.0):',
    'https://creativecommons.org/licenses/by/4.0/legalcode',
    'They describe no real person. To cite them, use "How to cite" on the site.',
    '',
    'Patient-derived data are not licensed by this file or by any other file on this site. Real data',
    'were collected under Stanford IRB Protocol 11354; access is governed by that protocol and the',
    'data-use agreement.',
    '',
    'The code is under LICENSE.txt. Third-party components, including the FreeSurfer fsaverage',
    'surfaces and labels, are under NOTICE.txt.',
    '',
  ].join('\n'))
  console.log(`[notices] NOTICE.txt (FreeSurfer Part B + ${deps.length} packages), LICENSE.txt, LICENSE-DATA.txt`)
}
main().catch((e) => { console.error('[notices] FAILED', e.message); process.exit(1) })
