/* The one download: what is on screen, as a table, with a README that says how it was made.

   Everything the reader of the CSV needs to not misread it travels inside the same file: which
   rows are sham, how a stimulation was placed in an area, that a stimulation can lie in two areas,
   and, on the controlled build, that the text is controlled data. The column list is a
   constant that a test compares against the rows, because an export whose columns drift from its
   declaration silently dropped four columns from every v1 export (AGENTS.md, expandCols). */

import { bedsideNote, eventGroup, type SelectedRow } from './selection'
import type { AtlasId, SiteParcelRecord } from './parcels'
import { sitePointMni305 } from './space'

const GROUP_WORDS = { stimulation: 'stimulation', sham: 'sham', zero_current: 'recorded_0_mA', excluded: 'release_qc_excluded', held: 'held_localisation' } as const
const NOTE_WORDS = { effect: 'effect_noted', none: 'none_noted', blank: 'blank' } as const

export const DOWNLOAD_COLUMNS = [
  'event_id',
  'patient_id',
  'session_id',
  'site_id',
  'electrode_pair',
  'electrode_type',
  'hemisphere',
  'stimulation_protocol',
  'event_group',
  'qc_exclude_reason',
  'seizure_related',
  'protocol_source',
  'current_mA',
  'frequency_hz',
  'train_duration_s',
  'pulse_width_us',
  'polarity',
  'selected_areas',
  'both_contacts_inside',
  'site_areas_in_atlas',
  'area_assignment',
  'deep_structures',
  'pair_midpoint_mni305_x',
  'pair_midpoint_mni305_y',
  'pair_midpoint_mni305_z',
  'clinician_entry',
  'report_recorded',
  'report_verbatim',
] as const

export type DownloadColumn = (typeof DOWNLOAD_COLUMNS)[number]

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadRows(
  rows: readonly SelectedRow[],
  atlas: AtlasId,
  parcelsBySite: ReadonlyMap<string, SiteParcelRecord>,
  areaName: (id: string) => string,
  synthetic: boolean,
  /** is this site's person held (an open question about their electrode positions)? */
  held: (siteId: string) => boolean = () => false,
): Record<DownloadColumn, unknown>[] {
  return rows.map(({ row, areas, text, both }) => {
    const rec = parcelsBySite.get(row.site.site_id)
    const p = sitePointMni305(row.site)
    return {
      event_id: row.event.event_id,
      patient_id: row.event.patient_id,
      session_id: row.event.session_id,
      site_id: row.site.site_id,
      electrode_pair: row.site.electrode_pair,
      electrode_type: row.site.electrode_type,
      hemisphere: row.site.hemisphere,
      stimulation_protocol: row.event.stimulation_protocol,
      event_group: GROUP_WORDS[eventGroup(row) === 'stimulation' && held(row.site.site_id) ? 'held' : eventGroup(row)],
      // a sham trial the release's QC excludes keeps its reason too (it was written for stimulations only)
      qc_exclude_reason: row.qc?.exclude_flag ? row.qc?.exclude_reason ?? '' : '',
      seizure_related: row.qc?.seizure_related_flag ? 'yes' : 'no',
      protocol_source: row.event.protocol_source ?? '',
      current_mA: row.event.current_mA,
      frequency_hz: row.event.frequency_hz,
      train_duration_s: row.event.train_duration_s,
      pulse_width_us: row.event.pulse_width_us ?? '',
      polarity: row.event.polarity ?? '',
      selected_areas: areas.map(areaName).join('; '),
      both_contacts_inside: both === undefined ? '' : both ? 'yes' : 'no',
      site_areas_in_atlas: (rec?.[atlas]?.p ?? []).join('; ') || rec?.[atlas]?.s || '',
      // a row picked through a deep structure was placed by the deep-structure assignment
      area_assignment: (areas.length && areas.every((a) => a.startsWith('deep:')) ? rec?.deep?.m : rec?.[atlas]?.m) ?? '',
      deep_structures: (rec?.deep?.p ?? []).join('; '),
      pair_midpoint_mni305_x: p ? +p[0].toFixed(2) : '',
      pair_midpoint_mni305_y: p ? +p[1].toFixed(2) : '',
      pair_midpoint_mni305_z: p ? +p[2].toFixed(2) : '',
      clinician_entry: NOTE_WORDS[bedsideNote(row, synthetic)],
      report_recorded: text ? 'yes' : 'no',
      report_verbatim: text ?? '',
    }
  })
}

export function toCsv(rows: readonly Record<DownloadColumn, unknown>[]): string {
  const lines = [DOWNLOAD_COLUMNS.join(',')]
  for (const r of rows) lines.push(DOWNLOAD_COLUMNS.map((c) => csvCell(r[c])).join(','))
  return lines.join('\n') + '\n'
}

export interface ReadmeInput {
  release: string
  synthetic: boolean
  atlasTitle: string
  atlasCitation: string
  areas: string[]
  /** what the selection is narrowed to on screen (a part of the area, one person), if anything */
  narrowed?: string | null
  /** how many of the rows record a pulse width */
  pulseWidthRecorded?: number
  /** the pair rule the selection was counted with */
  pairs?: 'either' | 'both'
  stimulations: number
  sham: number
  zeroCurrent: number
  excluded: number
  /** QC-excluded events at the selected sites, left out of an area download (T3) */
  excludedElsewhere?: number
  /** stimulations from people held for an open question about their electrode positions */
  held?: number
  patients: number
  generated: Date
  /** the citation for this release, as text */
  cite?: string
}

export function readme(r: ReadmeInput): string {
  const lines = [
    'Intracranial Stimulation Atlas: download',
    '================================',
    '',
    `Release: ${r.release}${r.synthetic ? '  (SYNTHETIC DEMONSTRATION DATA: not real patients, not quotable)' : ''}`,
    `Generated: ${r.generated.toISOString()}`,
    `Parcellation: ${r.atlasTitle} (${r.atlasCitation})`,
    `Areas: ${r.areas.length ? r.areas.join('; ') : 'none selected, so every stimulation in the release'}`,
    ...(r.narrowed ? [`Narrowed to: ${r.narrowed}. These rows are what the screen showed, not the whole area.`] : []),
    ...(r.areas.length ? [`Pair rule: ${r.pairs === 'both' ? 'only stimulations whose stimulating contacts ALL lie inside the selected areas (both of a pair; the one contact of a monopolar site)' : 'pairs with EITHER contact inside the selected areas (both_contacts_inside says which also meet the strict rule)'}`] : []),
    `Rows: ${r.stimulations} stimulation events from ${r.patients} patients, plus ${r.sham} sham trials, ${r.zeroCurrent} events recorded at 0 mA, ${r.excluded} events the release's QC excludes${r.held ? ` and ${r.held} stimulations from people held for an open question about their electrode positions` : ''}`,
    ...(r.excludedElsewhere ? [`${r.excludedElsewhere} events at these sites that the release's QC excludes are not in this file; they are in the download of everything.`] : []),
    '',
    'WHAT EACH ROW IS',
    '  One bedside stimulation event. event_group says how to count it:',
    '    stimulation          current delivered: the only rows any count or rate should use',
    '    sham                 no current; the negative control. Never pool with stimulation rows.',
    '    recorded_0_mA        labelled iES but recorded at 0 mA: whether current was delivered is',
    '                         unknown, so it is not counted as a stimulation',
    '    release_qc_excluded  excluded by the release\'s own quality check; qc_exclude_reason says',
    '                         why. Never counted in an area',
    '    held_localisation    a stimulation from a person whose electrode positions have an open',
    '                         question on record (the lab\'s own note, conflicting localisation',
    '                         sheets, unverified contact identity, or no native coordinates);',
    '                         placed in no area until it is resolved',
    '  seizure_related = yes means the release marks the event as seizure-related.',
    '',
    'HOW A STIMULATION WAS PLACED IN AN AREA',
    '  A site is a pair of electrode contacts (one contact, for a monopolar site). It is listed in every area one of its contacts',
    '  lies in, so a pair that straddles a boundary appears in both areas (site_areas_in_atlas',
    '  lists them; selected_areas lists the ones you chose). Each stimulation appears once here.',
    ...(r.synthetic ? ['  area_assignment says how:', '    synthetic           placed on the template brain for this demonstration; no one\'s own scan'] : ['  Only MEASURED labels are used. area_assignment says how:']),
    '    native              the lab\'s iELVis readout of the patient\'s own FreeSurfer reconstruction',
    '                        (Desikan-Killiany, Destrieux, Yeo-7, deep structures)',
    '    none                in no area; site_areas_in_atlas then says why (white_matter, deep,',
    '                        ventricle_csf, other_structure, unlabelled, side_conflict, held,',
    '                        contacts_unidentified)',
    '  A contact with no label in the patient\'s own records is in no area: nothing is estimated.',
    '',
    'STIMULATION PARAMETERS',
    '  current_mA, frequency_hz, train_duration_s, pulse_width_us and polarity are as recorded at the',
    '  bedside. An empty cell means the value was not recorded.',
    ...(r.pulseWidthRecorded == null ? [] : r.pulseWidthRecorded === 0
      ? ['  Pulse width is not recorded for these rows, so no dose or charge-density claim can be made from them.']
      : [`  Pulse width is recorded for ${r.pulseWidthRecorded.toLocaleString('en-US')} of these rows.`]),
    '',
    'COORDINATES',
    '  pair_midpoint_mni305_* is the stored site midpoint in MNI305 (= FreeSurfer fsaverage space). It is',
    '  NOT used to place anything. For depth electrodes it comes from a straight-line (affine) fit of',
    '  the patient\'s brain to the template and can be several millimetres off; a pair midpoint can',
    '  also fall between the two contacts in fluid. Use it for orientation only.',
    '',
    'REPORTS',
    '  report_verbatim is the bedside transcription as recorded, whitespace collapsed, with no',
    '  coding, labelling or summarising. report_recorded = no means no verbal report was',
    '  transcribed for that stimulation. It does not mean the patient felt nothing.',
    '',
    'CLINICIAN ENTRY',
    '  clinician_entry is what the clinician wrote in the stimulation sheet at the time:',
    '    effect_noted   a response category was entered (the category itself is not included)',
    '    none_noted     "none" was entered',
    '    blank          nothing was entered',
    '  It is the bedside record, not a reading of the report. The release\'s effect_presence column',
    '  fills many blank cells with an automated reading of the text; those are reported here as',
    '  blank. Writing "none" was routine through 2022 and had stopped by 2024, so a blank is not a',
    '  "none", and effect_noted / (effect_noted + none_noted) is not a response rate.',
    '',
    'READING THIS FILE',
    '  Read with pandas.read_csv(..., keep_default_na=False) so that no text cell is turned into',
    '  a missing value.',
    '',
    'FILES',
    '  reports.csv               the rows described above',
    '  CITATION.bib              how to cite this release (BibTeX)',
    `  dataset_description.json  name, release, licence, ${r.synthetic ? '' : 'ethics '}and how to acknowledge (BIDS style)`,
    '  SHA256SUMS                checksums: sha256sum -c SHA256SUMS',
    '',
    ...(r.cite ? ['HOW TO CITE', `  ${r.cite}`, '  Cite the parcellation as well (above).', ''] : []),
  ]
  if (!r.synthetic) {
    lines.push(
      'CONTROLLED DATA',
      '  This file contains verbatim bedside reports from research participants. It is controlled',
      '  data under the LBCN IRB protocol: do not share it outside the protocol, upload it to an',
      '  external service, or quote from it in public material without approval.',
      '',
    )
  }
  return lines.join('\n')
}

export interface DescriptionInput {
  name: string
  release: string
  synthetic: boolean
  authors: string
  institution: string
  url: string
  doi: string | null
  irb: string
  funding: readonly string[]
  references: readonly string[]
}

/** dataset_description.json, after the BIDS field names, so a download carries its provenance */
export function datasetDescription(d: DescriptionInput): string {
  return JSON.stringify({
    Name: `${d.name}: export${d.synthetic ? ' (synthetic demonstration data)' : ''}`,
    DatasetVersion: d.release,
    DatasetType: 'derivative',
    License: d.synthetic ? 'CC-BY-4.0' : 'Controlled data: not licensed for redistribution. Access is governed by the IRB protocol and data use agreement.',
    Authors: [d.authors],
    HowToAcknowledge: `Cite the atlas and data release: ${d.url}${d.doi ? ` (doi:${d.doi})` : ''}, and the parcellation used.`,
    Funding: [...d.funding],
    // invented data were approved by no one: the protocol is named only for the real release (L12)
    EthicsApprovals: d.synthetic ? undefined : [d.irb],
    ReferencesAndLinks: [d.url, ...d.references],
    DatasetDOI: d.doi ?? undefined,
    GeneratedBy: [{ Name: d.name, CodeURL: 'https://github.com/LBCN-Stanford/brain-atlas', Description: `Exported from the web atlas at ${d.institution}` }],
  }, null, 2) + '\n'
}

/** SHA256SUMS in the coreutils format, so `sha256sum -c SHA256SUMS` verifies the files */
export async function sha256sums(files: readonly { name: string; data: Uint8Array }[]): Promise<string> {
  const lines: string[] = []
  for (const f of files) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', f.data as BufferSource))
    lines.push(`${[...h].map((b) => b.toString(16).padStart(2, '0')).join('')}  ${f.name}`)
  }
  return lines.join('\n') + '\n'
}
