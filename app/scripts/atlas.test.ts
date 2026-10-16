/* Atlas v2: the rules its reading panel, download and AI overview must keep.

   Runs on the SYNTHETIC build on purpose -- data/ and v2/data/site_parcels.json are tracked, so
   every assertion here runs on CI and on every machine; nothing falls back or skips. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDb, type EventRow } from '../src/lib/core/data.ts'
import { isShamRow } from '../src/lib/core/query.ts'
import { FREESURFER_MNI305_TO_MNI152, applyTransform } from '../src/lib/space/coordinateSpace.ts'
import { indexSites, selectablesFor, type ParcelTable, type SiteParcelsFile } from '../src/atlas/model/parcels.ts'
import { bedsideNote, countNotes, eventGroup, matchesQuery, patientLabel, selectRows } from '../src/atlas/model/selection.ts'
import { sitePointMni305 } from '../src/atlas/model/space.ts'
import { DOWNLOAD_COLUMNS, csvCell, downloadRows, readme, toCsv } from '../src/atlas/model/download.ts'
import { crc32, zipStore } from '../src/atlas/model/zip.ts'
import { MAX_AREAS, assignSlots, linkRelease, normaliseSelection, parseHash, parseLocation, toHash, toSearch } from '../src/atlas/model/urlState.ts'
import { searchSelectables } from '../src/atlas/ui/SearchBox.tsx'
import { inflateSync } from 'node:zlib'
import { binsFor, colorFor } from '../src/atlas/model/colormap.ts'
import { giftiFunc, mapCsv, pngWithDpi, summariseAreas, vertexValues } from '../src/atlas/model/mapData.ts'

const SYNTH = new URL('../public/data/', import.meta.url)
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`${name}.json`, SYNTH), 'utf8')) as T
const db = buildDb({
  manifest: read('manifest'), patients: read('patients'), sessions: read('sessions'),
  electrodes: read('electrodes'), sites: read('sites'), stimulation_events: read('stimulation_events'),
  reports: read('reports'), effect_labels: read('effect_labels'), qc_flags: read('qc_flags'),
  atlas_labels: read('atlas_labels'), ccep_availability: read('ccep_availability'),
} as never, {}, [])
const parcels = JSON.parse(readFileSync(new URL('../public/atlas/data/site_parcels.json', import.meta.url), 'utf8')) as SiteParcelsFile
const table = (id: string) => JSON.parse(readFileSync(new URL(`../public/atlas/brain/parc/${id}.json`, import.meta.url), 'utf8')) as ParcelTable
const text = (eid: string) => db.reportByEvent.get(eid)?.raw_report_redacted ?? null
const eventsBySite = db.eventsBySite as ReadonlyMap<string, readonly EventRow[]>

test('every synthetic site has an assignment for every atlas, and every key it names exists', () => {
  assert.equal(Object.keys(parcels.sites).length, db.sites.length)
  const deep = JSON.parse(readFileSync(new URL('../public/atlas/brain/subcortical.json', import.meta.url), 'utf8')) as { structures: { key: string }[] }
  const deepKeys = new Set(deep.structures.map((s) => s.key))
  for (const atlas of ['dk', 'destrieux', 'yeo7'] as const) {
    const keys = new Set(table(atlas).labels.map((l) => l.key).filter(Boolean))
    for (const [sid, rec] of Object.entries(parcels.sites)) {
      assert.ok(rec[atlas], `${sid} has no ${atlas} entry`)
      for (const k of rec[atlas].p) assert.ok(keys.has(k), `${sid}: ${k} is not a ${atlas} parcel`)
      // a site in no parcel must say why; a site in a parcel must not claim an off-cortex state
      assert.equal(rec[atlas].p.length > 0, rec[atlas].s === 'parcel', `${sid} ${atlas}: parcels ${rec[atlas].p} vs state ${rec[atlas].s}`)
      assert.ok(rec[atlas].p.length <= 2, `${sid}: a pair has at most two contacts`)
    }
  }
  for (const [sid, rec] of Object.entries(parcels.sites)) for (const k of rec.deep.p) assert.ok(deepKeys.has(k), `${sid}: deep ${k} unknown`)
})

test('a selection never counts sham, and never counts a straddling stimulation twice', () => {
  const byArea = indexSites(parcels, 'dk')
  // pick the two areas sharing the most sites, so the overlap path is exercised for real
  const ids = [...byArea.keys()].filter((k) => k.startsWith('ctx:'))
  let best: [string, string] | null = null
  let bestShared = 0
  for (let i = 0; i < ids.length; i++) {
    const a = new Set(byArea.get(ids[i]))
    for (let j = i + 1; j < ids.length; j++) {
      const shared = byArea.get(ids[j])!.filter((s) => a.has(s)).length
      if (shared > bestShared) { bestShared = shared; best = [ids[i], ids[j]] }
    }
  }
  assert.ok(best && bestShared > 0, 'the synthetic build must contain at least one straddling pair')
  const r = selectRows(best!, byArea, eventsBySite, text)
  assert.ok(r.stimulations.every((x) => !isShamRow(x.row)), 'sham leaked into the stimulation list')
  assert.ok(r.sham.every((x) => isShamRow(x.row)))
  const ids2 = r.stimulations.map((x) => x.row.event.event_id)
  assert.equal(new Set(ids2).size, ids2.length, 'a stimulation was listed twice')
  assert.equal(r.counts.stimulations, ids2.length)
  assert.equal(r.counts.patients, new Set(r.stimulations.map((x) => x.row.event.patient_id)).size)
  assert.equal(r.counts.withReport, r.stimulations.filter((x) => x.text).length)
  // per-area counts overlap exactly by the straddling stimulations
  const both = r.stimulations.filter((x) => x.areas.length === 2).length
  assert.ok(both > 0)
  assert.equal(r.perArea[0].stimulations + r.perArea[1].stimulations - both, r.counts.stimulations)
  // the population is exactly the counted stimulations at the union of the two areas' sites:
  // never sham, never 0 mA, never an event the release's own QC excludes
  const sites = new Set([...byArea.get(best![0])!, ...byArea.get(best![1])!])
  const atSites = db.rows.filter((x) => sites.has(x.site.site_id))
  assert.equal(r.counts.stimulations, atSites.filter((x) => eventGroup(x) === 'stimulation').length)
  assert.equal(r.counts.excluded, atSites.filter((x) => eventGroup(x) === 'excluded').length)
  assert.ok(r.stimulations.every((x) => !x.row.qc.exclude_flag && x.row.event.current_mA !== 0))

  // the strict pair rule: both contacts identified and inside the selection. It keeps exactly the
  // stimulations the lenient count reports as "both inside", and a straddling pair across the two
  // selected areas is inside the selection
  const chosen = new Set(best!)
  const inside = (sid: string) => {
    const rec = parcels.sites[sid]
    return rec.c.length === 2 && rec.c.every((cid) => { const k = parcels.contacts[cid].dk; return !!k && chosen.has(`ctx:${k}`) })
  }
  const lenient = selectRows(best!, byArea, eventsBySite, text, { bothInside: inside })
  const strict = selectRows(best!, byArea, eventsBySite, text, { bothInside: inside, strict: true })
  assert.equal(lenient.counts.stimulations, r.counts.stimulations)
  assert.equal(strict.counts.stimulations, lenient.counts.bothInside)
  assert.ok(strict.counts.stimulations < lenient.counts.stimulations, 'the synthetic build must exercise a pair that fails the strict rule')
  assert.ok(strict.stimulations.every((x) => x.both && inside(x.row.site.site_id)))
  assert.ok(strict.stimulations.some((x) => x.areas.length === 2), 'a pair straddling the two selected areas is inside the selection')
})

test('an event recorded at 0 mA is listed apart and never counted; QC-excluded events are in no list', () => {
  const byArea = indexSites(parcels, 'dk')
  const [area, siteIds] = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  const rows = db.rows.filter((x) => siteIds.includes(x.site.site_id) && eventGroup(x) === 'stimulation')
  assert.ok(rows.length >= 3)
  // the synthetic release has no 0 mA events, so make one, and one QC exclusion, from real rows
  const zero = { ...rows[0], event: { ...rows[0].event, current_mA: 0 } }
  const excl = { ...rows[1], qc: { ...rows[1].qc, exclude_flag: true } }
  const shamZero = { ...rows[2], event: { ...rows[2].event, current_mA: 0, stimulation_protocol: 'sham' } }
  assert.equal(eventGroup(zero), 'zero_current')
  assert.equal(eventGroup(excl), 'excluded')
  assert.equal(eventGroup(shamZero), 'sham', 'sham is sham whatever its current')
  const patched = new Map(eventsBySite)
  for (const sid of siteIds) {
    patched.set(sid, (eventsBySite.get(sid) ?? []).map((x) =>
      x.event.event_id === zero.event.event_id ? zero : x.event.event_id === excl.event.event_id ? excl : x.event.event_id === shamZero.event.event_id ? shamZero : x))
  }
  const base = selectRows([area], byArea, eventsBySite, text)
  const r = selectRows([area], byArea, patched, text)
  assert.deepEqual(r.zeroCurrent.map((x) => x.row.event.event_id), [zero.event.event_id])
  assert.equal(r.counts.zeroCurrent, 1)
  assert.equal(r.counts.excluded, base.counts.excluded + 1)
  assert.equal(r.counts.stimulations, base.counts.stimulations - 3)
  assert.equal(r.counts.sham, base.counts.sham + 1)
  const listed = [...r.stimulations, ...r.zeroCurrent, ...r.sham].map((x) => x.row.event.event_id)
  assert.ok(!listed.includes(excl.event.event_id), 'a QC-excluded event was listed')
})

test('electrode dots: only registered surface contacts carry a vertex, and a held contact is in no area', () => {
  const deepKeys = new Set((JSON.parse(readFileSync(new URL('../public/atlas/brain/subcortical.json', import.meta.url), 'utf8')) as { structures: { key: string }[] }).structures.map((s) => s.key))
  let surfaceWithVertex = 0
  for (const [sid, rec] of Object.entries(parcels.sites)) {
    for (const cid of rec.c) assert.ok(parcels.contacts[cid], `${sid}: contact ${cid} missing from the contact table`)
  }
  for (const c of Object.values(parcels.contacts)) {
    if (c.k === 'd') assert.equal(c.v, null, 'a depth contact must not be drawn: its template position is an affine estimate')
    if (c.v != null) {
      surfaceWithVertex++
      assert.ok(Number.isInteger(c.v) && c.v >= 0 && c.v < 163842)
      assert.ok(c.h === 'lh' || c.h === 'rh')
    }
    assert.ok(!('glasser' in c), 'Glasser was removed: no contact may still carry it')
    if (c.held) for (const a of ['dk', 'destrieux', 'yeo7', 'deep'] as const) assert.equal(c[a], null)
    if (c.deep) assert.ok(deepKeys.has(c.deep))
  }
  assert.ok(surfaceWithVertex > 0)
  // a site's parcels are exactly the union of its contacts' parcels
  for (const rec of Object.values(parcels.sites)) {
    for (const a of ['dk', 'destrieux', 'yeo7'] as const) {
      const union = [...new Set(rec.c.map((cid) => parcels.contacts[cid][a]).filter(Boolean))]
      assert.deepEqual([...rec[a].p].sort(), union.sort())
    }
  }
})

test('the MNI305 point refuses what it cannot place, and the synthetic inverse round-trips', () => {
  const base = { mni_midpoint_x: 10, mni_midpoint_y: -20, mni_midpoint_z: 30 }
  assert.deepEqual(sitePointMni305({ ...base, coordinate_provenance: { common_coordinate_space: 'mni305' } }), [10, -20, 30])
  assert.equal(sitePointMni305({ ...base, coordinate_provenance: { common_coordinate_space: 'unknown' } }), null)
  assert.equal(sitePointMni305({ ...base, coordinate_provenance: { common_coordinate_space: 'mni305', space_evidence: 'subject_failed' } }), null)
  assert.equal(sitePointMni305({ ...base, coordinate_provenance: null }), null)
  const p305 = sitePointMni305({ ...base, coordinate_provenance: { common_coordinate_space: 'mni152' } })!
  const back = applyTransform(p305, FREESURFER_MNI305_TO_MNI152)
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - [10, -20, 30][i]) < 1e-9)
  // and every synthetic site normalised by buildDb is placeable
  assert.ok(db.sites.every((s) => sitePointMni305(s) !== null || s.mni_midpoint_x === null))
})

test('the download carries exactly its declared columns, marks sham, and says what it contains', () => {
  const byArea = indexSites(parcels, 'dk')
  const area = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
  const r = selectRows([area], byArea, eventsBySite, text)
  const rows = downloadRows([...r.stimulations, ...r.zeroCurrent, ...r.sham], 'dk', new Map(Object.entries(parcels.sites)), (id) => id, true)
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...DOWNLOAD_COLUMNS].sort())
  const csv = toCsv(rows)
  assert.equal(csv.split('\n')[0], DOWNLOAD_COLUMNS.join(','))
  assert.equal(rows.filter((x) => x.stimulation_protocol === 'sham').length, r.sham.length)
  assert.equal(rows.filter((x) => x.event_group === 'sham').length, r.sham.length)
  assert.equal(rows.filter((x) => x.event_group === 'stimulation').length, r.stimulations.length)
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"')
  const synth = readme({ release: 'x', synthetic: true, atlasTitle: 'G', atlasCitation: 'c', areas: [], stimulations: 1, sham: 1, zeroCurrent: 0, excluded: 0, patients: 1, generated: new Date(0) })
  assert.match(synth, /SYNTHETIC/)
  assert.match(synth, /sham/i)
  assert.match(synth, /keep_default_na=False/)
  const real = readme({ release: 'x', synthetic: false, atlasTitle: 'G', atlasCitation: 'c', areas: [], stimulations: 1, sham: 1, zeroCurrent: 0, excluded: 0, patients: 1, generated: new Date(0) })
  assert.match(real, /recorded_0_mA/)
  assert.match(real, /CONTROLLED DATA/)
  assert.match(real, /CLINICIAN ENTRY/)
  assert.match(real, /not a response rate/)
})

test('the clinician entry is the bedside record only: an autocoded label never reaches it', () => {
  const row = db.rows.find((x) => eventGroup(x) === 'stimulation')!
  const as = (label_source: unknown, effect_presence: string) => ({ ...row, effect: { ...row.effect, label_source, effect_presence } }) as EventRow
  // a real release: only the clinician's own rows count, whatever the autocoder said
  assert.equal(bedsideNote(as('human', 'positive'), false), 'effect')
  assert.equal(bedsideNote(as('human', 'null'), false), 'none')
  assert.equal(bedsideNote(as('human', 'not_assessable'), false), 'blank')
  assert.equal(bedsideNote(as('autocode_v1', 'positive'), false), 'blank')
  assert.equal(bedsideNote(as('autocode_v1', 'null'), false), 'blank')
  assert.equal(bedsideNote(as('autocode_v1_abstained', 'not_assessable'), false), 'blank')
  // a real row that declares no source is not taken on trust; the synthetic build declares none
  assert.equal(bedsideNote(as(undefined, 'positive'), false), 'blank')
  assert.equal(bedsideNote(as(undefined, 'positive'), true), 'effect')
  assert.equal(bedsideNote(as('autocode_v1', 'positive'), true), 'blank')
  // the three states partition a selection, and the download says the same thing per row
  const byArea = indexSites(parcels, 'dk')
  const area = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
  const r = selectRows([area], byArea, eventsBySite, text)
  const c = countNotes(r.stimulations, true)
  assert.equal(c.effect + c.none + c.blank, r.stimulations.length)
  assert.ok(c.effect > 0 && c.none > 0, 'the synthetic selection should exercise both entries')
  const rows = downloadRows(r.stimulations, 'dk', new Map(Object.entries(parcels.sites)), (id) => id, true)
  assert.equal(rows.filter((x) => x.clinician_entry === 'effect_noted').length, c.effect)
  assert.equal(rows.filter((x) => x.clinician_entry === 'none_noted').length, c.none)
  assert.equal(rows.filter((x) => x.clinician_entry === 'blank').length, c.blank)
})

test('map downloads: every count has a colour, the table follows ENIGMA order, and the files are well formed', async () => {
  // the binned scale covers every count from 1 to the maximum, in at most seven contiguous steps,
  // and its first step always ends at 4 (the five-person reporting threshold starts the second)
  for (let max = 1; max <= 400; max++) {
    const bins = binsFor(max)
    assert.ok(bins.length >= 1 && bins.length <= 7, `max ${max}: ${bins.length} bins`)
    assert.equal(bins[0].lo, 1)
    assert.equal(bins[0].hi, Math.min(4, max))
    for (let i = 1; i < bins.length; i++) assert.equal(bins[i].lo, bins[i - 1].hi + 1, `max ${max}: gap before bin ${i}`)
    assert.equal(bins[bins.length - 1].hi, max)
    for (const v of [1, Math.ceil(max / 2), max]) assert.ok(colorFor(v, bins), `max ${max}: no colour for ${v}`)
    assert.equal(colorFor(0, bins), null, 'zero is never on the colour ramp')
  }

  // the per-area summary is the selection logic run per area, and the table is in ENIGMA order
  const dk = table('dk')
  const deep = (JSON.parse(readFileSync(new URL('../public/atlas/brain/subcortical.json', import.meta.url), 'utf8')) as { structures: Parameters<typeof selectablesFor>[1] }).structures
  const areas = selectablesFor(dk, deep)
  const byArea = indexSites(parcels, 'dk')
  const both = () => false
  const rows = summariseAreas(areas, 'dk', byArea, eventsBySite, { bothInside: both, strict: false, synthetic: true }, () => null)
  assert.equal(rows.length, 68 + 14)
  for (const r of rows.slice(0, 12)) {
    const sel = selectRows([r.id], byArea, eventsBySite, text)
    assert.equal(r.stimulations, sel.counts.stimulations, r.id)
    assert.equal(r.people, sel.counts.patients, r.id)
    assert.equal(r.effect + r.none + r.blank, r.stimulations, r.id)
  }
  const csv = mapCsv(rows, (r) => r.people, () => '#000000').trim().split('\n')
  const head = csv[0].split(',')
  const col = (line: string, name: string) => line.split(',')[head.indexOf(name)]
  assert.equal(csv.length, 1 + 82)
  assert.equal(col(csv[1], 'enigma_name'), 'L_bankssts')
  assert.equal(col(csv[34], 'enigma_name'), 'L_insula')
  assert.equal(col(csv[35], 'enigma_name'), 'R_bankssts')
  assert.equal(col(csv[69], 'label'), 'Left-Accumbens-area')
  assert.equal(col(csv[69], 'aseg_index'), '26')
  assert.equal(col(csv[82], 'enigma_name'), 'Rthal')
  assert.equal(col(csv[82], 'aseg_index'), '49')

  // GIFTI: the vertex values decode back exactly, NaN where there is no area
  const labels = new Uint16Array([0, 1, 1, 2, 3, 0])
  const values = vertexValues(labels, new Map([[1, 7], [2, 0], [3, 12]]), NaN)
  const xml = await giftiFunc(values, 'lh', 'people_stimulated', { Description: 'test' })
  assert.match(xml, /AnatomicalStructurePrimary[\s\S]*CortexLeft/)
  assert.match(xml, /Intent="NIFTI_INTENT_NONE" DataType="NIFTI_TYPE_FLOAT32"/)
  const enc = /Encoding="(\w+)"/.exec(xml)![1]
  const raw = Buffer.from(/<Data>([^<]*)<\/Data>/.exec(xml)![1], 'base64')
  const bytes = enc === 'GZipBase64Binary' ? inflateSync(raw) : raw
  const back = new Float32Array(Uint8Array.from(bytes).buffer)
  assert.deepEqual([...back].map((x) => (Number.isNaN(x) ? 'NaN' : x)), ['NaN', 7, 7, 0, 12, 'NaN'])

  // PNG: a 300 dpi pHYs chunk goes right after IHDR, with a valid CRC
  const onePixel = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))
  const png = pngWithDpi(onePixel, 300)
  const dv = new DataView(png.buffer, png.byteOffset)
  assert.equal(String.fromCharCode(...png.subarray(37, 41)), 'pHYs')
  assert.equal(dv.getUint32(41), 11811)
  assert.equal(dv.getUint32(50), crc32(png.subarray(37, 50)))
  assert.equal(png.length, onePixel.length + 21)
  assert.equal(pngWithDpi(png, 300).length, png.length, 'an existing pHYs is replaced, not duplicated')
})

test('the reports download marks a held person\'s stimulations, which are in no count', () => {
  const r = db.rows.find((x) => eventGroup(x) === 'stimulation')!
  const rows = downloadRows([{ row: r, areas: [], text: null }], 'dk', new Map(Object.entries(parcels.sites)), (id) => id, true, () => true)
  assert.equal(rows[0].event_group, 'held_localisation')
  const sham = db.rows.find((x) => eventGroup(x) === 'sham')!
  const s = downloadRows([{ row: sham, areas: [], text: null }], 'dk', new Map(Object.entries(parcels.sites)), (id) => id, true, () => true)
  assert.equal(s[0].event_group, 'sham', 'sham stays sham whoever the person is')
  const text = readme({ release: 'x', synthetic: false, atlasTitle: 'G', atlasCitation: 'c', areas: [], stimulations: 1, sham: 0, zeroCurrent: 0, excluded: 0, held: 5, patients: 1, generated: new Date(0) })
  assert.match(text, /held_localisation/)
  assert.match(text, /5 stimulations from people held/)
})

test('the zip is a valid stored archive', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686)
  const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b.txt', data: new Uint8Array([1, 2, 3]) }])
  const dv = new DataView(z.buffer)
  assert.equal(dv.getUint32(0, true), 0x04034b50)
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50)
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 2)
  const dir = mkdtempSync(join(tmpdir(), 'v2zip-'))
  writeFileSync(join(dir, 't.zip'), z)
  // Python's zipfile is an independent reader: it checks every CRC
  const out = execFileSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read('a.txt').decode())`, join(dir, 't.zip')]).toString().trim()
  assert.equal(out, 'hello')
})

test('view state round-trips through the URL, rejects junk, and colour slots stay put', () => {
  const s = { atlas: 'dk' as const, sel: ['ctx:lh.insula', 'deep:Left-Hippocampus'], view: 'insideL' as const, smooth: true, dots: false, see: 0.5, pairs: 'both' as const, cov: true, multi: true, sub: 'lh.G_insular_short' }
  assert.deepEqual(parseHash(toHash(s)), s)
  assert.equal(parseHash('#atlas=dk').cov, false, 'coverage is off unless the link asks for it')
  assert.equal(parseHash('#atlas=dk').multi, false, 'one area at a time unless the link asks to compare')
  assert.equal(parseHash('#atlas=evil&sel=<script>,ctx:lh.insula').atlas, 'dk')
  assert.equal(parseHash('#atlas=glasser').atlas, 'dk', 'a link from before Glasser was removed opens on the default')
  assert.deepEqual(parseHash('#sel=<script>,ctx:lh.insula').sel, ['ctx:lh.insula'])
  // the query is the canonical form; it names the release first, and old hash links still open
  assert.match(toSearch(s, '3.1-real'), /^\?release=3\.1-real&atlas=dk&sel=ctx:lh\.insula,deep:Left-Hippocampus/)
  assert.deepEqual(parseLocation(toSearch(s, '3.1-real'), ''), s)
  assert.deepEqual(parseLocation('', toHash(s)), s, 'a link from before the query opens the view it names')
  assert.deepEqual(parseLocation('?release=1', '#/brain3d'), parseHash(''), "a route of the earlier app opens the default view")
  assert.equal(linkRelease('?release=0.1.0-synthetic&atlas=dk', ''), '0.1.0-synthetic')
  assert.equal(linkRelease('', '#atlas=dk'), null)
  // unknown ids never take a slot, duplicates collapse, and the cap applies to known ids only
  const junk = Array.from({ length: MAX_AREAS }, (_, i) => `ctx:lh.nothing${i}`)
  const parsed = parseHash(`#sel=${[...junk, 'ctx:lh.insula', 'ctx:lh.insula', 'deep:Left-Hippocampus'].join(',')}`).sel
  const known = (id: string) => !id.includes('nothing')
  assert.deepEqual(normaliseSelection(parsed, known), ['ctx:lh.insula', 'deep:Left-Hippocampus'])
  const many = Array.from({ length: MAX_AREAS + 3 }, (_, i) => `ctx:lh.a${i}`)
  assert.equal(normaliseSelection(many, () => true).length, MAX_AREAS)
  const a = assignSlots(['x', 'y', 'z'], new Map())
  const b = assignSlots(['x', 'z', 'w'], a)
  assert.equal(b.get('x'), 0)
  assert.equal(b.get('z'), 2)
  assert.equal(b.get('w'), 1, 'a freed colour goes to the next pick')
})

test('plain words: people, search synonyms, lexical filter', () => {
  assert.equal(patientLabel('sub-007'), 'Person 7')
  assert.equal(patientLabel('SYNTH_PATIENT_002'), 'Person 2')
  assert.ok(matchesQuery('I felt Tingling', 'tingling'))
  assert.ok(!matchesQuery(null, 'x'))
  const sel = selectablesFor(table('dk'), [])
  const broca = searchSelectables(sel, 'broca').map((x) => x.key)
  assert.ok(broca.includes('lh.parsopercularis') && broca.includes('lh.parstriangularis'))
})

test('strip-controlled removes every controlled tree at any depth and keeps the synthetic ones', () => {
  const dist = mkdtempSync(join(tmpdir(), 'v2dist-'))
  for (const d of ['data-real', 'data-real.pre-provenance', 'v2/data-real', 'v2/data', 'v2/brain', 'data']) {
    mkdirSync(join(dist, d), { recursive: true })
    writeFileSync(join(dist, d, 'x.json'), '{}')
  }
  execFileSync('node', [new URL('./strip-controlled.mjs', import.meta.url).pathname], { env: { ...process.env, STRIP_DIST: dist, BUILD_INCLUDE_CONTROLLED: '' } })
  for (const gone of ['data-real', 'data-real.pre-provenance', 'v2/data-real']) assert.ok(!existsSync(join(dist, gone)), `${gone} survived`)
  for (const kept of ['data', 'v2/data', 'v2/brain']) assert.ok(existsSync(join(dist, kept)), `${kept} was removed`)
  // a controlled internal build keeps the live tier but never a snapshot of it
  const dist2 = mkdtempSync(join(tmpdir(), 'v2dist-'))
  for (const d of ['data-real', 'data-real.pre-provenance', 'v2/data-real']) mkdirSync(join(dist2, d), { recursive: true })
  execFileSync('node', [new URL('./strip-controlled.mjs', import.meta.url).pathname], { env: { ...process.env, STRIP_DIST: dist2, BUILD_INCLUDE_CONTROLLED: '1' } })
  assert.ok(existsSync(join(dist2, 'data-real')) && existsSync(join(dist2, 'v2/data-real')))
  assert.ok(!existsSync(join(dist2, 'data-real.pre-provenance')))
})
