/* The map downloads: one row per area, the same numbers on fsaverage vertices, and a README.

   A map is a summary of the selection logic, never a second implementation of it: every number
   here comes from selectRows() for that one area, so the panel, the hover card, the figure and
   the files cannot disagree. Counts only. The atlas shows no rates (see selection.ts, bedsideNote),
   so no file here carries one.

   Surface files are GIFTI on fsaverage (163,842 vertices per hemisphere, the mesh the app draws),
   because that is what nibabel, nilearn, neuromaps and Connectome Workbench read without
   conversion; the table is keyed the way ggseg and FreeSurfer name Desikan-Killiany areas
   ("lh_superiortemporal"), so it joins to their atlases directly. */

import type { EventRow } from '../../lib/core/data'
import { countNotes, selectRows, type SelectOptions } from './selection'
import { crc32 } from './zip'
import type { AtlasId, Selectable } from './parcels'

export interface AreaSummary {
  id: string
  atlas: AtlasId | 'aseg'
  hemi: 'left' | 'right'
  /** FreeSurfer's own name: the annotation name ("superiortemporal") or the aseg name ("Left-Hippocampus") */
  annot: string
  region: string
  people: number
  stimulations: number
  sites: number
  bothInside: number
  effect: number
  none: number
  blank: number
  /** the area's number in the current selection, if it is selected */
  selected: number | null
}

export function summariseAreas(
  areas: readonly Selectable[],
  atlas: AtlasId,
  sitesByArea: ReadonlyMap<string, readonly string[]>,
  eventsBySite: ReadonlyMap<string, readonly EventRow[]>,
  opts: { bothInside: (siteId: string, ids: ReadonlySet<string>) => boolean; strict: boolean; synthetic: boolean },
  selectedNumber: (id: string) => number | null,
): AreaSummary[] {
  return areas.map((a) => {
    const one = new Set([a.id])
    const so: SelectOptions = { bothInside: (s) => opts.bothInside(s, one), strict: opts.strict }
    const r = selectRows([a.id], sitesByArea, eventsBySite, () => null, so)
    const notes = countNotes(r.stimulations, opts.synthetic)
    return {
      id: a.id,
      atlas: a.kind === 'deep' ? 'aseg' : atlas,
      hemi: a.hemisphere === 'lh' ? 'left' : 'right',
      annot: a.kind === 'deep' ? a.key : a.key.split('.').slice(1).join('.'),
      region: a.name,
      people: r.counts.patients,
      stimulations: r.counts.stimulations,
      sites: r.counts.sites,
      bothInside: r.counts.bothInside,
      effect: notes.effect,
      none: notes.none,
      blank: notes.blank,
      selected: selectedNumber(a.id),
    }
  })
}

// ENIGMA Toolbox's subcortical order (accumbens, amygdala, caudate, hippocampus, pallidum, putamen,
// thalamus; left then right) with its names and FreeSurfer's aseg indices
const ASEG: Record<string, { enigma: string; index: number; order: number }> = {
  'Accumbens-area': { enigma: 'accumb', index: 26, order: 0 }, Amygdala: { enigma: 'amyg', index: 18, order: 1 },
  Caudate: { enigma: 'caud', index: 11, order: 2 }, Hippocampus: { enigma: 'hippo', index: 17, order: 3 },
  Pallidum: { enigma: 'pal', index: 13, order: 4 }, Putamen: { enigma: 'put', index: 12, order: 5 },
  Thalamus: { enigma: 'thal', index: 10, order: 6 },
}
const ASEG_RIGHT_OFFSET: Record<number, number> = { 26: 58, 18: 54, 11: 50, 17: 53, 13: 52, 12: 51, 10: 49 }

/* Columns follow what the plotting toolboxes join on: ggseg's `label` (lh_bankssts,
   Left-Hippocampus), ENIGMA Toolbox's names and order (cortex in FreeSurfer colour-table order,
   then the subcortical seven per side), FreeSurfer's own names and aseg indices. */
export const MAP_COLUMNS = [
  'atlas', 'structure_type', 'hemi', 'fs_hemi', 'fs_name', 'label', 'enigma_name', 'aseg_index', 'display_name',
  'people_stimulated', 'stimulations', 'sites', 'stimulations_both_contacts_inside',
  'entries_effect_noted', 'entries_none_noted', 'entries_blank', 'selected', 'map_value', 'map_colour_hex',
] as const

export function mapCsv(rows: readonly AreaSummary[], value: (r: AreaSummary) => number | string, colour: (r: AreaSummary) => string): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const deepPart = (r: AreaSummary) => ASEG[r.annot.replace(/^(Left|Right)-/, '')]
  const ordered = [
    ...rows.filter((r) => r.atlas !== 'aseg' && r.hemi === 'left'),
    ...rows.filter((r) => r.atlas !== 'aseg' && r.hemi === 'right'),
    ...['left', 'right'].flatMap((h) => rows.filter((r) => r.atlas === 'aseg' && r.hemi === h)
      .sort((a, b) => (deepPart(a)?.order ?? 9) - (deepPart(b)?.order ?? 9))),
  ]
  const lines = [MAP_COLUMNS.join(',')]
  for (const r of ordered) {
    const fsHemi = r.hemi === 'left' ? 'lh' : 'rh'
    const deep = r.atlas === 'aseg' ? deepPart(r) : undefined
    const enigma = r.atlas === 'dk' ? `${r.hemi === 'left' ? 'L' : 'R'}_${r.annot}` : deep ? `${r.hemi === 'left' ? 'L' : 'R'}${deep.enigma}` : ''
    const asegIndex = deep ? (r.hemi === 'left' ? deep.index : ASEG_RIGHT_OFFSET[deep.index]) : ''
    lines.push([
      r.atlas, r.atlas === 'aseg' ? 'subcortical' : 'cortex', r.hemi, fsHemi, r.annot,
      r.atlas === 'aseg' ? r.annot : `${fsHemi}_${r.annot}`, enigma, asegIndex, r.region,
      r.people, r.stimulations, r.sites, r.bothInside, r.effect, r.none, r.blank, r.selected ?? '', value(r), colour(r),
    ].map(cell).join(','))
  }
  return lines.join('\n') + '\n'
}

/** One value per fsaverage vertex from one value per parcel label index; `fill` where no parcel. */
export function vertexValues(labels: Uint16Array, byIndex: ReadonlyMap<number, number>, fill: number): Float32Array {
  const out = new Float32Array(labels.length)
  for (let v = 0; v < labels.length; v++) out[v] = labels[v] ? byIndex.get(labels[v]) ?? fill : fill
  return out
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** little-endian bytes of a typed array, whatever the platform's own byte order */
function leBytes(a: Float32Array | Int32Array): Uint8Array {
  const out = new Uint8Array(a.length * 4)
  const dv = new DataView(out.buffer)
  if (a instanceof Float32Array) a.forEach((x, i) => dv.setFloat32(i * 4, x, true))
  else a.forEach((x, i) => dv.setInt32(i * 4, x, true))
  return out
}

const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
const md = (pairs: Record<string, string>) =>
  `<MetaData>${Object.entries(pairs).map(([k, v]) => `<MD><Name>${cdata(k)}</Name><Value>${cdata(v)}</Value></MD>`).join('')}</MetaData>`
const structure = (h: 'lh' | 'rh') => (h === 'lh' ? 'CortexLeft' : 'CortexRight')

function giftiDoc(h: 'lh' | 'rh', meta: Record<string, string>, labelTable: string, array: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE GIFTI SYSTEM "http://www.nitrc.org/frs/download.php/115/gifti.dtd">
<GIFTI Version="1.0" NumberOfDataArrays="1">
${md({ AnatomicalStructurePrimary: structure(h), ...meta })}
${labelTable}
${array}
</GIFTI>
`
}

/** GIFTI's GZipBase64Binary is zlib (RFC 1950), which is what CompressionStream('deflate') writes;
    without CompressionStream the data stays uncompressed Base64Binary, which every reader also takes. */
async function encodeData(bytes: Uint8Array): Promise<{ encoding: string; data: string }> {
  if (typeof CompressionStream === 'undefined') return { encoding: 'Base64Binary', data: base64(bytes) }
  const z = new Uint8Array(await new Response(new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  return { encoding: 'GZipBase64Binary', data: base64(z) }
}

/** A GIFTI functional (scalar) file: one float per vertex. */
export async function giftiFunc(values: Float32Array, h: 'lh' | 'rh', name: string, meta: Record<string, string>): Promise<string> {
  const { encoding, data } = await encodeData(leBytes(values))
  const array = `<DataArray Intent="NIFTI_INTENT_NONE" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1" Dim0="${values.length}" Encoding="${encoding}" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="">
${md({ Name: name })}
<Data>${data}</Data>
</DataArray>`
  return giftiDoc(h, meta, '<LabelTable/>', array)
}

/** A GIFTI label file: one integer key per vertex, with a named, coloured label table. */
export async function giftiLabel(keys: Int32Array, table: { key: number; name: string; color: string }[], h: 'lh' | 'rh', meta: Record<string, string>): Promise<string> {
  const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4))
  const rows = [{ key: 0, name: '???', color: '#ffffff' }, ...table].map((t) => {
    const [r, g, b] = rgb(t.color)
    return `<Label Key="${t.key}" Red="${r}" Green="${g}" Blue="${b}" Alpha="${t.key === 0 ? '0.0000' : '1.0000'}">${cdata(t.name)}</Label>`
  })
  const { encoding, data } = await encodeData(leBytes(keys))
  const array = `<DataArray Intent="NIFTI_INTENT_LABEL" DataType="NIFTI_TYPE_INT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1" Dim0="${keys.length}" Encoding="${encoding}" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="">
${md({ Name: 'selected_areas' })}
<Data>${data}</Data>
</DataArray>`
  return giftiDoc(h, meta, `<LabelTable>${rows.join('')}</LabelTable>`, array)
}

/** Write the resolution into a PNG (pHYs chunk), so a journal's checker reads it as `dpi`. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // 'pHYs'
  dv.setUint32(8, ppm)
  dv.setUint32(12, ppm)
  chunk[16] = 1 // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)))
  // insert right after IHDR (8-byte signature + 25-byte IHDR chunk), dropping any pHYs already there
  const head = png.subarray(0, 33)
  const rest: Uint8Array[] = []
  for (let i = 33; i < png.length;) {
    const len = new DataView(png.buffer, png.byteOffset + i, 4).getUint32(0)
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8))
    if (type !== 'pHYs') rest.push(png.subarray(i, i + 12 + len))
    i += 12 + len
  }
  const out = new Uint8Array(head.length + chunk.length + rest.reduce((n, r) => n + r.length, 0))
  out.set(head, 0)
  out.set(chunk, head.length)
  let o = head.length + chunk.length
  for (const r of rest) { out.set(r, o); o += r.length }
  return out
}

export interface MapReadmeInput {
  kind: 'coverage' | 'selection'
  release: string
  synthetic: boolean
  generated: Date
  atlasTitle: string
  citation: string
  /** "either contact of the pair lies in it" */
  rule: string
  people: number
  stimulations: number
  areas: number
  gifti: string[]
  electrodes: number | null
  selected: string[]
}

export function mapReadme(r: MapReadmeInput): string {
  const lines = [
    'Intracranial Stimulation Atlas: map',
    '========================',
    '',
    `Release: ${r.release}${r.synthetic ? '  (SYNTHETIC DEMONSTRATION DATA: describes no real person, not for any analysis)' : ''}`,
    `Generated: ${r.generated.toISOString()}`,
    `Map: ${r.kind === 'coverage' ? 'people stimulated per area (coverage)' : `selected areas: ${r.selected.join('; ')}`}`,
    `Atlas: ${r.atlasTitle} (${r.citation}), on FreeSurfer fsaverage (MNI305 space)`,
    '',
    'FILES',
    '  figure.png    2400 px wide at 300 dpi (203 mm). Lateral and medial views of each hemisphere',
    '                and the ventral surface, on fsaverage\'s inflated surface, with the legend.',
    '  figure.svg    The same figure with editable text and the brain views embedded as images,',
    '                for journals that ask for vector artwork (open in Illustrator or Inkscape).',
    `  areas.csv     One row per area, zeros included (${r.areas} rows: the atlas's cortical areas, then`,
    '                the 14 deep structures), with every measure, not only the one mapped.',
    ...r.gifti.map((g) => `  ${g}`),
    r.kind === 'coverage'
      ? '                The map on fsaverage, 163,842 vertices per hemisphere: each vertex carries its area\'s value;\n                0 means no stimulation in that area; NaN means no area (the medial wall).'
      : '                The selected areas on fsaverage, 163,842 vertices per hemisphere, as a label file:\n                key = the area\'s number in the selection, 0 elsewhere. Deep structures are in areas.csv only.',
    '',
    'WHAT IS COUNTED',
    `  Stimulations with current delivered: ${r.stimulations.toLocaleString('en-US')} stimulations in ${r.people} people in all.`,
    '  Not counted: sham trials (the control), events recorded at 0 mA, events the release\'s own',
    '  quality check excludes, and people whose electrode positions have an open question on record.',
    `  A stimulation counts in an area when ${r.rule}. Each contact\'s area is its label in the`,
    '  person\'s own MRI (FreeSurfer, read by iELVis); a contact with no label is in no area, and nothing',
    r.rule.startsWith('both')
      ? '  is estimated. Each area is judged on its own: a pair whose two contacts lie in two areas counts in neither.'
      : '  is estimated. A pair whose two contacts lie in two areas counts once in each.',
    ...(r.electrodes ? [`  Dots on the figure: ${r.electrodes.toLocaleString('en-US')} stimulated surface contacts at the fsaverage vertex each was`, '  registered to (spherical registration). Depth contacts are not drawn.'] : []),
    '',
    'COLUMNS (areas.csv)',
    '  atlas, structure_type        dk / destrieux / yeo7 / aseg; cortex or subcortical',
    '  hemi, fs_hemi                left / right; lh / rh',
    '  fs_name                      FreeSurfer\'s name (annotation name, or aseg name)',
    '  label                        ggseg\'s join key: lh_superiortemporal, Left-Hippocampus',
    '  enigma_name                  ENIGMA Toolbox name (Desikan-Killiany and deep structures only)',
    '  aseg_index                   FreeSurfer aseg index of a deep structure',
    '  display_name                 the name the atlas app shows',
    '  people_stimulated            people with at least one counted stimulation in the area',
    '  stimulations, sites          counted stimulations; stimulated contact pairs',
    '  stimulations_both_contacts_inside   of those, pairs with both contacts inside the area',
    '  entries_effect_noted, entries_none_noted, entries_blank',
    '                               the clinician\'s own bedside entry for each counted stimulation: an',
    '                               effect, "none", or nothing written. Writing "none" was routine through',
    '                               2022 and had stopped by 2024, so a blank is not a "none" and these',
    '                               are not a response rate.',
    '  selected                     the area\'s number in the selection, if selected',
    '  map_value, map_colour_hex    the value and colour the figure shows',
    '  Rows are in ENIGMA Toolbox order (cortex in FreeSurfer colour-table order, left then right; then',
    '  accumbens, amygdala, caudate, hippocampus, pallidum, putamen, thalamus, left then right).',
    '',
    'LOADING',
    '  pandas      pd.read_csv("areas.csv", keep_default_na=False)',
    '  ggseg (R)   join on `label`:  dplyr::left_join(ggseg::dk, read.csv("areas.csv"), by = "label")',
    '  ENIGMA      the first 68 rows of a Desikan-Killiany map are in parcel_to_surface order',
    '  nibabel     nib.load("<file>.func.gii").darrays[0].data',
    '  nilearn     fs = datasets.fetch_surf_fsaverage("fsaverage")   # full resolution, 163,842 vertices',
    '              plotting.plot_surf_stat_map(fs.infl_left, data, hemi="left")',
    '  surfplot    hides zeros by default; pass zero_transparent=False to show unstimulated areas',
    '',
    'SUGGESTED LEGEND',
    r.kind === 'coverage'
      ? `  Number of people with at least one stimulation in each ${r.atlasTitle} area, counting a stimulation in an area when ${r.rule} (by the contact's label in the person's own MRI). ${r.stimulations.toLocaleString('en-US')} stimulations in ${r.people} people; sham, 0 mA and quality-excluded events not counted. fsaverage inflated surface.`
      : `  Selected ${r.atlasTitle} areas on the fsaverage inflated surface, numbered as in the legend.`,
    '',
  ]
  if (!r.synthetic) {
    lines.push(
      'CONTROLLED DATA',
      '  Counts derived from research participants\' data under the LBCN IRB protocol. Small counts can',
      '  identify people: check with the lab before using these files outside it.',
      '',
    )
  }
  return lines.join('\n')
}
