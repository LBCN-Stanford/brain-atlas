/* Parcel tables and the site -> parcel index produced by scripts/v2/build_site_parcels.py. */

// Glasser (HCP-MMP1.0) was removed on 10 Oct, for now: surface electrodes only, and too thin per area
export type AtlasId = 'dk' | 'destrieux' | 'yeo7'
export const ATLAS_IDS: readonly AtlasId[] = ['dk', 'destrieux', 'yeo7']

export interface ParcelLabel {
  index: number
  key: string | null
  /** the display name (scripts/v2/area_names.py) */
  name: string
  /** the atlas's own full label (Destrieux's long name, Desikan's region name) */
  long?: string
  short?: string
  hemisphere: 'lh' | 'rh' | null
  color: string | null
  group: string | null
  /** share of the area's vertices an outside view can see on the folded brain (build_brain_assets.py, BURIED) */
  exposed?: number
  /** the folded brain hides this area, on both sides: it is shown on the smoothed surface when picked */
  buried?: boolean
}

export interface ParcelTable {
  id: AtlasId
  title: string
  citation: string
  labels: ParcelLabel[]
}

export interface DeepStructure {
  key: string
  name: string
  hemisphere: 'lh' | 'rh'
  color: string
  positions: { byteOffset: number; count: number }
  indices: { byteOffset: number; count: number }
}

/** Why a site is in no parcel of an atlas. 'parcel' means it is in at least one. */
export type SiteState =
  | 'parcel'
  | 'white_matter'
  | 'deep'
  | 'ventricle_csf'
  | 'other_structure'
  /** the patient's own record gives this contact no label */
  | 'unlabelled'
  /** the contact's label names one hemisphere and its recorded side is the other */
  | 'side_conflict'
  /** the person is held: something on record questions where their electrodes are */
  | 'held'
  /** the pair's contacts could not be identified in the localisation records */
  | 'contacts_unidentified'
  | 'none'

export const STATE_WORDS: Record<SiteState, string> = {
  parcel: 'in an area',
  white_matter: 'white matter',
  deep: 'a deep structure',
  ventricle_csf: 'fluid space (ventricle)',
  other_structure: 'another structure',
  unlabelled: 'no label in the patient’s records',
  side_conflict: 'label and recorded side disagree',
  held: 'held back (an open question about this person’s electrode positions)',
  contacts_unidentified: 'contacts not identified in the localisation records',
  none: 'none',
}

export interface SiteAtlasEntry {
  /** parcel keys ("lh.superiortemporal"); two when the pair's contacts lie in different parcels */
  p: string[]
  s: SiteState
  /** how the parcels were assigned: native | synthetic; 'none' when in no parcel */
  m: string
}

export type SiteParcelRecord = Record<AtlasId | 'deep', SiteAtlasEntry> & {
  /** the pair's contact ids (0-2), keys into SiteParcelsFile.contacts */
  c: string[]
}

/** One contact: where it is drawn (surface contacts only) and the parcel it lies in per atlas. */
export interface ContactParcels {
  /** s = surface (subdural grid/strip), d = depth */
  k: 's' | 'd'
  h: 'lh' | 'rh' | null
  /** fsaverage vertex the surface contact was registered to (null: not drawn) */
  v: number | null
  held: boolean
  dk: string | null
  destrieux: string | null
  yeo7: string | null
  deep: string | null
}

export interface SiteParcelsFile {
  builder: string
  build: string
  frame: string
  rule: string
  methods: Record<string, string>
  sites: Record<string, SiteParcelRecord>
  contacts: Record<string, ContactParcels>
}

/** A selectable thing: a cortical parcel of the active atlas, or a deep structure. */
export interface Selectable {
  id: string // 'ctx:<key>' or 'deep:<key>'
  kind: 'cortex' | 'deep'
  key: string
  name: string
  short: string
  /** the atlas's full label, when it differs from the name */
  long: string | null
  hemisphere: 'lh' | 'rh' | null
  group: string | null
}

export const cortexId = (key: string) => `ctx:${key}`
export const deepId = (key: string) => `deep:${key}`

export function hemiWord(h: 'lh' | 'rh' | null): string {
  return h === 'lh' ? 'Left' : h === 'rh' ? 'Right' : ''
}

/**
 * Index sites by parcel for one atlas, and by deep structure. A site appears under every parcel
 * one of its contacts lies in (the builder's rule), so the per-parcel lists overlap where a pair
 * straddles a boundary -- callers that combine parcels must de-duplicate by event.
 */
export function indexSites(file: SiteParcelsFile, atlas: AtlasId): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (id: string, site: string) => {
    const a = out.get(id)
    if (a) a.push(site)
    else out.set(id, [site])
  }
  for (const [site, rec] of Object.entries(file.sites)) {
    for (const k of rec[atlas]?.p ?? []) add(cortexId(k), site)
    for (const k of rec.deep?.p ?? []) add(deepId(k), site)
  }
  return out
}

export function selectablesFor(table: ParcelTable, deep: DeepStructure[]): Selectable[] {
  const out: Selectable[] = []
  for (const l of table.labels) {
    if (!l.key) continue
    out.push({ id: cortexId(l.key), kind: 'cortex', key: l.key, name: l.name, short: l.short ?? l.name, long: l.long && l.long !== l.name ? l.long : null, hemisphere: l.hemisphere, group: l.group })
  }
  for (const d of deep) {
    out.push({ id: deepId(d.key), kind: 'deep', key: d.key, name: d.name, short: d.name, long: null, hemisphere: d.hemisphere, group: 'Deep structures' })
  }
  return out
}

/** The parts of one area: the finer atlas's areas that share its vertices (Destrieux inside
    Desikan-Killiany, Desikan-Killiany inside a Yeo network), largest first. A finer area covering
    under `minShare` of the area is a sliver: not listed, and counted in `sliverShare`, so the panel
    can say the listed parts do not cover the whole area (M1). */
export function areaParts(
  coarse: Uint16Array, fine: Uint16Array, areaIndex: number, fineLabels: readonly ParcelLabel[], minShare = 0.03,
): { parts: { index: number; key: string; name: string; share: number }[]; sliverShare: number } {
  const count = new Map<number, number>()
  let total = 0
  for (let v = 0; v < coarse.length; v++) if (coarse[v] === areaIndex) { total++; count.set(fine[v], (count.get(fine[v]) ?? 0) + 1) }
  const parts: { index: number; key: string; name: string; share: number }[] = []
  let listed = 0
  for (const [i, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const l = fineLabels[i]
    if (i > 0 && l?.key && n / total >= minShare) { parts.push({ index: i, key: l.key, name: l.name, share: n / total }); listed += n }
  }
  return { parts, sliverShare: total ? 1 - listed / total : 0 }
}

/** Electrode dots: every stimulated SURFACE contact at the fsaverage vertex it was registered to
    (spherical registration), coloured by the selected area that contact itself lies in. Depth
    contacts are not drawn: their only template position is an affine estimate, which put 21% of
    them outside the brain and 61% of the coloured ones outside the area they were coloured for
    (validation of 16 Oct, M3; the 10 Oct measured-positions rule, restored by the user 17 Oct). */
export function surfaceDots(
  file: SiteParcelsFile, stimulated: (siteId: string) => boolean, atlas: AtlasId, colorOf: (id: string) => string | null,
): { hemi: 'lh' | 'rh'; v: number; areaColor: string | null }[] {
  const out: { hemi: 'lh' | 'rh'; v: number; areaColor: string | null }[] = []
  const seen = new Set<string>()
  for (const [sid, rec] of Object.entries(file.sites)) {
    if (!stimulated(sid)) continue
    for (const cid of rec.c ?? []) {
      const c = file.contacts[cid]
      if (!c || c.k !== 's' || c.v == null || c.h == null || c.held || seen.has(cid)) continue
      seen.add(cid)
      const k = c[atlas]
      out.push({ hemi: c.h, v: c.v, areaColor: (k && colorOf(cortexId(k))) || (c.deep && colorOf(deepId(c.deep))) || null })
    }
  }
  return out
}
