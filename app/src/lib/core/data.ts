/* ============================================================================
   Data loader + in-memory relational model.

   Fetches the 10 canonical JSON tables once, builds id-indexed lookups and a
   denormalized event index (event ⋈ site ⋈ effect ⋈ qc ⋈ patient ⋈ session) so
   the query engine and pages can work without repeated joins. Regions + ontology
   are imported directly from source modules (identical to the exported snapshots).
   ========================================================================== */

import type {
  AtlasBundle, Patient, Session, Electrode, Site, StimEvent, Report,
  EffectLabel, QcFlag, AtlasLabel, CcepAvailability, DatasetManifest,
  CcepSiteSummary, CcepRegionConn,
} from './schema'
import { commonPointInMni152, FREESURFER_MNI305_TO_MNI152, MNI152_FRAME } from '../space/coordinateSpace'
import { REGIONS, REGION_BY_ID, UNASSIGNED_REGION } from '../space/anatomy'
import type { Region, Yeo7 } from '../space/anatomy'
import type { CoordinateProvenance, SpaceEvidence } from './schema'
import { CCEP_MIN_TESTED } from '../ccep/constants'

/** Compact per-site CCEP summary (real build only) — keyed `patient|PAIR` so the
 *  main 3D atlas can show a one-line CCEP readout without loading a patient graph. */
export interface CcepSiteBrief {
  out: number
  in: number
  med_lat: number | null
  med_str: number | null
  region: string
  hemi: string
}

/** Fully-joined event row — the unit the explorer + query engine operate on. */
export interface EventRow {
  event: StimEvent
  site: Site
  effect: EffectLabel
  qc: QcFlag
  patient: Patient
  session: Session
  region: Region
}

export interface DataIntegrityIssue {
  table: string
  id: string
  message: string
}

export interface DataIntegrityReport {
  valid: boolean
  issues: DataIntegrityIssue[]
  /** Canonical tables that were unavailable in a trimmed/controlled export. */
  unavailableTables: string[]
  sourceRows: number
  joinedEvents: number
}

export interface Db {
  manifest: DatasetManifest
  // raw tables (Schema Explorer, exports, counts)
  patients: Patient[]
  sessions: Session[]
  electrodes: Electrode[]
  sites: Site[]
  events: StimEvent[]
  reports: Report[]
  effectLabels: EffectLabel[]
  qcFlags: QcFlag[]
  atlasLabels: AtlasLabel[]
  ccep: CcepAvailability[]
  // indexes
  patientById: Map<string, Patient>
  sessionById: Map<string, Session>
  electrodeById: Map<string, Electrode>
  siteById: Map<string, Site>
  eventById: Map<string, StimEvent>
  effectByEvent: Map<string, EffectLabel>
  qcByEvent: Map<string, QcFlag>
  reportByEvent: Map<string, Report>
  atlasBySite: Map<string, AtlasLabel[]>
  ccepBySite: Map<string, CcepAvailability>
  // CCEP connectivity graph (empty in the synthetic build)
  ccepSiteSummary: CcepSiteSummary[]
  ccepRegionConn: CcepRegionConn[]
  ccepSummaryBySite: Map<string, CcepSiteSummary>
  /** per-site CCEP brief keyed `${patient_id}|${electrode_pair.toUpperCase()}` (real build only) */
  ccepBriefByKey: Map<string, CcepSiteBrief>
  /** efferent edges keyed by `${out_region_id}|${out_hemisphere}`, sorted by activation_rate desc */
  ccepEfferentByRegion: Map<string, CcepRegionConn[]>
  electrodesByPatient: Map<string, Electrode[]>
  sitesByPatient: Map<string, Site[]>
  eventsBySite: Map<string, EventRow[]>
  rowByEvent: Map<string, EventRow>
  // denormalized
  rows: EventRow[]
  regions: Region[]
  integrity: DataIntegrityReport
}

/** Additive boundary migration for releases produced before localization provenance existed. */
export function normalizeSite(raw: Site | Record<string, unknown>, resolvedContactIds?: ReadonlySet<string>, legacyCommonSpace: 'mni152' | 'mni305' | 'unknown' = 'unknown', spaceEvidenceBySubject?: Readonly<Record<string, SpaceEvidence>>): Site {
  const row = raw as Record<string, any>
  const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
  const mni = [finite(row.mni_midpoint_x), finite(row.mni_midpoint_y), finite(row.mni_midpoint_z)]
  const native = [finite(row.native_midpoint_x), finite(row.native_midpoint_y), finite(row.native_midpoint_z)]
  const contactIds = [row.contact_1_id, row.contact_2_id].filter((id): id is string => typeof id === 'string' && id.length > 0)
  const contactsUsed = resolvedContactIds
    ? contactIds.filter((id) => resolvedContactIds.has(id)).length
    : 0
  const nativeSource = row.native_midpoint_source === 'contact_mean' || row.native_midpoint_source === 'contact_mean_mni' || row.native_midpoint_source === 'mni_fallback' || row.native_midpoint_source === 'unavailable'
    ? row.native_midpoint_source
    : native.every((v) => v != null) && legacyCommonSpace === 'mni152' && contactsUsed > 0 ? 'contact_mean'
      : native.every((v) => v != null) ? 'mni_fallback' : 'unavailable'
  const hasCommonCoordinate = mni.every((v) => v != null)
  const regionAssignmentMethod = row.region_assignment_method === 'nearest_coarse_centroid' || row.region_assignment_method === 'nearest_coarse_centroid_unverified' || row.region_assignment_method === 'unassigned' || row.region_assignment_method === 'unknown'
    ? row.region_assignment_method
    : legacyCommonSpace === 'mni152' && (row.region_id === 'unassigned' || !hasCommonCoordinate) ? 'unassigned'
      : legacyCommonSpace === 'mni152' && hasCommonCoordinate ? 'nearest_coarse_centroid' : 'unknown'
  const regionAssignmentSource = typeof row.region_assignment_source === 'string' && row.region_assignment_source.length > 0
    ? row.region_assignment_source
    : legacyCommonSpace === 'mni152' ? 'synthetic_generator' : 'legacy_release'
  const regionAssignmentVersion = typeof row.region_assignment_version === 'string' && row.region_assignment_version.length > 0
    ? row.region_assignment_version : legacyCommonSpace === 'mni152' ? 'coarse_regions_v1' : null
  const legacyProvenance = row.coordinate_provenance?.common_coordinate_source === 'legacy_release'
  /* A backfilled MNI305 row needs BOTH its space and the reviewed transform to be usable:
     commonPointInMni152 converts only when declaredSpace === 'mni305' AND transformId is
     FREESURFER_MNI305_TO_MNI152.id. Stamping the space alone leaves transform_id null, the
     conversion returns null, and every site is silently withheld from the render — which is
     precisely the state the real build was in (0 of 4,785 placeable). The transform is the one
     this module already ships and the writeup already declares for these coordinates, so
     recording it here is the same claim, made where the reader can act on it. */
  const legacyTransformId = legacyCommonSpace === 'mni305' ? FREESURFER_MNI305_TO_MNI152.id : null
  /* The space claim is per-SUBJECT evidence, and stamping it per-row without saying whose
     evidence it is overstates it. verify_coordinate_provenance.py reproduced the MNI columns
     for 155 of 222 assessable subjects; 67 admit no affine at all, and at least one carries an
     explicit instruction in its own folder not to use its MNI coordinates. Absent a per-subject
     table this is 'cohort_assumed' — the frame is inferred from a cohort result, not from this
     patient — never 'subject_reproduced'. localization_status does NOT cover this: it describes
     the midpoint, not the frame the midpoint is expressed in. */
  const spaceEvidence: SpaceEvidence = spaceEvidenceBySubject?.[row.patient_id as string]
    ?? (legacyCommonSpace === 'mni305' ? 'cohort_assumed' : 'not_assessed')
  const provenance: CoordinateProvenance = row.coordinate_provenance && !legacyProvenance
    ? { ...row.coordinate_provenance, space_evidence: row.coordinate_provenance.space_evidence ?? spaceEvidence }
    : {
      common_coordinate_space: mni.every((v) => v != null) ? legacyCommonSpace : 'unknown',
      common_coordinate_source: 'legacy_release',
      transform_id: mni.every((v) => v != null) ? legacyTransformId : null,
      midpoint_method: contactsUsed === 2 ? 'two_contact_mean' : contactsUsed === 1 ? 'single_contact' : 'missing',
      contacts_used: contactsUsed as 0 | 1 | 2,
      localization_status: mni.every((v) => v != null) ? 'uncertain' : 'unavailable',
      space_evidence: spaceEvidence,
    }
  return {
    ...row,
    native_midpoint_x: native[0], native_midpoint_y: native[1], native_midpoint_z: native[2],
    native_midpoint_source: nativeSource,
    mni_midpoint_x: mni[0], mni_midpoint_y: mni[1], mni_midpoint_z: mni[2],
    localization_uncertainty_mm: finite(row.localization_uncertainty_mm),
    region_assignment_distance_mm: finite(row.region_assignment_distance_mm),
    region_assignment_method: regionAssignmentMethod,
    region_assignment_source: regionAssignmentSource,
    region_assignment_version: regionAssignmentVersion,
    coordinate_provenance: provenance,
  } as Site
}

/* 'measured' is the BEST AVAILABLE common-space position: the nonlinear ANTs SyN 2009a midpoint
   where one exists, falling back to 'common' where none does. It is a separate space rather than a
   redefinition of 'common' because the two answer different questions and different callers need
   different ones. Harvard-Oxford is defined in NLin6Asym and must keep being queried there; the
   471 pinned claims measure 'common'; the site page's "Atlas coordinate (MNI152)" row is a
   statement ABOUT NLin6Asym. Silently changing what 'common' returns would move all of those at
   once, which is how a frame error becomes uncorrectable. */
export type CoordinateSpace = 'native' | 'common' | 'measured'

/** Which frame a `measured` point actually came from, so a caller can disclose it. */
export type MeasuredFrame = 'mni2009a' | 'mni152' | null

/** The coordinate-bearing subset needed to resolve a site. Kept structural so geometry gates and
 * fixture rows can call the same authority without reimplementing it. */
export interface SitePointInput {
  native_midpoint_x?: number | null
  native_midpoint_y?: number | null
  native_midpoint_z?: number | null
  native_midpoint_source?: string | null
  mni_midpoint_x: number | null
  mni_midpoint_y: number | null
  mni_midpoint_z: number | null
  mni152_midpoint_x?: number | null
  mni152_midpoint_y?: number | null
  mni152_midpoint_z?: number | null
  mni2009a_midpoint_x?: number | null
  mni2009a_midpoint_y?: number | null
  mni2009a_midpoint_z?: number | null
  coordinate_provenance?: Pick<CoordinateProvenance,
    'common_coordinate_space' | 'transform_id' | 'space_evidence'> | null
}

/**
 * Which frame `sitePoint(site, 'measured')` will answer in — 'mni2009a', or 'mni152' when it has
 * to fall back, or null when the site has no defensible position at all.
 *
 * Exported so the renderer can SAY which frame each mark is in rather than implying one frame for
 * a scene that holds two.
 */
export function measuredFrame(site: SitePointInput): MeasuredFrame {
  const p = [site.mni2009a_midpoint_x, site.mni2009a_midpoint_y, site.mni2009a_midpoint_z]
  if (p.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return 'mni2009a'
  return sitePoint(site, 'common') ? 'mni152' : null
}

/**
 * Return a finite stored midpoint only when all three axes are present.
 *
 * For `common`, the returned point is in MNI152 (ICBM152_NLin6Asym) — the frame the template,
 * the Harvard-Oxford volumes, and every bounding box in the renderer are defined in. When the
 * stored coordinate is MNI305 it is CONVERTED here, once, so that no caller downstream has to
 * remember to do it and none of them can forget. When its space was never established the
 * answer is null and the caller shows nothing; see commonPointInMni152 for why guessing is
 * not an option.
 */
export function sitePoint(site: SitePointInput, space: CoordinateSpace): [number, number, number] | null {
  /* MEASURED: prefer the nonlinear 2009a midpoint, fall back to 'common'.
     ------------------------------------------------------------------------------------------
     WHY PREFER IT. Where the two columns disagree, the 2009a coordinate is the one that is right,
     and the effect is monotone in the size of the disagreement. Scored against each template's own
     brain mask over the 4,007 sites that carry both:

         disagreement    n      NLin6Asym outside brain     2009a outside brain
         < 5 mm       2,300      7.2%  (max 6.96 mm)        0.5%  (max 3.16 mm)
         5-10 mm      1,278     10.3%  (max 7.56 mm)        3.8%  (max 3.00 mm)
         10-20 mm       329     11.9%  (max 6.04 mm)        5.2%  (max 2.00 mm)
         > 20 mm        100     11.0%  (max 7.23 mm)        0.0%  (max 0.00 mm)

     On the hundred sites that disagree by more than 20 mm, EVERY 2009a coordinate is comfortably
     inside the brain while the affine throws one in nine outside it. The disagreement measures the
     affine failing, not the 2009a coordinate being unreliable. Independently, arm D of
     race_normalisations.py scores 2009a +7.14 / +4.14 / +7.71 points above the affine on each
     patient's own native FreeSurfer label — an arbiter invisible to both normalisations.

     WHY MIXING THE TWO IN ONE SCENE IS ACCEPTABLE, WITH THE NUMBER. The worry that blocked this
     was "two marker frames in one picture". Measured, the SYSTEMATIC difference between the two
     columns is |mean displacement| = 0.327 mm, against a 4.42 mm median displacement — i.e. 93% of
     the gap is per-site registration disagreement and only 0.33 mm of it is frame. That is below
     the 1.34 mm instrument floor this build already accepts elsewhere. The fallback costs a third
     of a millimetre of systematic bias to avoid a median 4.42 mm of registration error.

     WHAT THIS DOES NOT BUY, stated because it was nearly claimed. It does NOT reduce the mismatch
     with the display surface. That surface is ICBM152 NLin2009cAsym, and measured centre-of-mass
     offsets are 1.344 mm for 2009a against 1.277 mm for NLin6Asym — a wash, marginally worse. The
     ~1.3 mm cross-template display offset is unchanged by this choice and remains disclosed. */
  if (space === 'measured') {
    const p = [site.mni2009a_midpoint_x, site.mni2009a_midpoint_y, site.mni2009a_midpoint_z]
    if (p.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
      return p as [number, number, number]
    }
    return sitePoint(site, 'common')
  }
  if (space === 'native' && site.native_midpoint_source !== 'contact_mean') return null
  const point = space === 'native'
    ? [site.native_midpoint_x, site.native_midpoint_y, site.native_midpoint_z]
    : [site.mni_midpoint_x, site.mni_midpoint_y, site.mni_midpoint_z]
  if (!point.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) return null
  if (space === 'native') return point as [number, number, number]
  /* A row that never passed through normalizeSite has no provenance object at all. Reading
     through it threw a TypeError on the shipped controlled build, which turns "this coordinate's
     frame is unknown" into a crash. Unknown frame is a legitimate answer and its answer is null. */
  if (!site.coordinate_provenance) return null
  /* A subject whose own transform was CHECKED and does not reproduce has no recoverable common
     coordinate: its MNI columns are not in the frame the declaration names, so converting them
     lands somewhere with no anatomical meaning. Refusing here — rather than at the render site —
     keeps every downstream consumer (labels, maps, exports, statistics) on the same rule, since
     they all reach the coordinate through this function. Native coordinates are unaffected and
     are still returned above; it is only the common-space claim that fails. */
  if (site.coordinate_provenance.space_evidence === 'subject_failed') return null
  /* Prefer the pipeline's precomputed MNI152 midpoint: it is the mean of the two CONVERTED
     contacts, whereas converting the stored midpoint here is only equivalent because the
     transform is affine (it commutes with averaging). Reading the precomputed column keeps this
     correct when the transform stops being affine. For MNI305 rows, the stored transform must
     match the reviewed registry; an already-MNI152 row does not need a second conversion record. */
  const pre = [site.mni152_midpoint_x, site.mni152_midpoint_y, site.mni152_midpoint_z]
  const provenance = site.coordinate_provenance
  const precomputedTransformIsReviewed = provenance?.common_coordinate_space === 'mni152'
    || provenance?.transform_id === FREESURFER_MNI305_TO_MNI152.id
  if (precomputedTransformIsReviewed
      && pre.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    return pre as [number, number, number]
  }
  return commonPointInMni152(
    point as [number, number, number],
    provenance?.common_coordinate_space ?? 'unknown',
    provenance?.transform_id,
  )
}

export interface ContactPointInput {
  mni_x: number
  mni_y: number
  mni_z: number
  mni152_x?: number | null
  mni152_y?: number | null
  mni152_z?: number | null
  coordinate_source_space?: string | null
  coordinate_target_space?: string | null
  transform_id?: string | null
}

/** Resolve a contact in the same MNI152 frame as its site's midpoint.
 *
 * Controlled rows must name the reviewed MNI305→MNI152 transform and its exact target template.
 * Synthetic rows are the documented exception: their legacy mni_* columns already are MNI152.
 * An unreviewed precomputed triple is refused rather than trusted because a column name is not
 * provenance. */
export function contactPointInMni152(contact: ContactPointInput, synthetic: boolean): [number, number, number] | null {
  const raw = [contact.mni_x, contact.mni_y, contact.mni_z]
  if (!raw.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return null
  if (synthetic) return raw as [number, number, number]
  if (contact.coordinate_source_space !== 'MNI305'
      || contact.coordinate_target_space !== MNI152_FRAME.templateId
      || contact.transform_id !== FREESURFER_MNI305_TO_MNI152.id) return null
  const pre = [contact.mni152_x, contact.mni152_y, contact.mni152_z]
  if (pre.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    return pre as [number, number, number]
  }
  return commonPointInMni152(raw as [number, number, number], 'mni305', contact.transform_id)
}

function indexBy<T>(arr: T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>()
  for (const x of arr) m.set(key(x), x)
  return m
}
function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of arr) {
    const k = key(x)
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return m
}

function duplicateIssues<T>(table: string, rows: T[], key: (row: T) => string, issues: DataIntegrityIssue[]): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const id = key(row)
    if (seen.has(id)) issues.push({ table, id, message: 'duplicate identifier' })
    seen.add(id)
  }
}

/**
 * Flag DANGLING references only.
 *
 * An ABSENT optional link is not a broken one. `sites.contact_1_id` / `contact_2_id` are
 * empty strings on sites whose electrode pair could not be resolved to stored contacts:
 * 469 and 833 sites respectively, which is a documented and expected state (monopolar
 * stimulation, partially-resolved pairs, sites carried by their own in-sheet coordinate).
 * Treating "" as a reference to a nonexistent electrode produced exactly 1,302 phantom
 * issues and put "1302 relationship issues detected" on the front page of the atlas, next
 * to a claim that the affected rows are excluded from joined analyses. Neither was true:
 * nothing dangles, and those sites are not excluded from anything.
 *
 * The contact links therefore skip empty ids. A non-empty id that points at nothing is
 * still a real defect and is still reported. Separately, a controlled or core export may
 * omit the electrodes table entirely; validateBundle skips the check in that case rather
 * than reporting every site as an orphan.
 */
function referenceIssues<T>(
  table: string, rows: T[], key: (row: T) => string, target: Set<string>,
  label: string, issues: DataIntegrityIssue[],
): void {
  for (const row of rows) {
    const id = key(row)
    // Empty contact slots are valid for retained zero-/one-contact sites. A non-empty
    // contact id still has to resolve, so this does not weaken referential integrity.
    if (!id && (label === 'contact_1' || label === 'contact_2')) continue
    if (!target.has(id)) issues.push({ table, id, message: `missing ${label} reference` })
  }
}

/** Check relational links before the denormalized event join is consumed by views. */
export function validateBundle(b: AtlasBundle, unavailableTables: readonly string[] = []): DataIntegrityReport {
  const issues: DataIntegrityIssue[] = []
  const ids = <T>(rows: T[], key: (row: T) => string) => new Set(rows.map(key))
  const patientIds = ids(b.patients, (row) => row.patient_id)
  const sessionIds = ids(b.sessions, (row) => row.session_id)
  const electrodeIds = ids(b.electrodes, (row) => row.electrode_contact_id)
  const siteIds = ids(b.sites, (row) => row.site_id)
  const eventIds = ids(b.stimulation_events, (row) => row.event_id)
  const effectIds = ids(b.effect_labels, (row) => row.event_id)
  const qcIds = ids(b.qc_flags, (row) => row.event_id)
  const regionIds = new Set([...REGIONS, UNASSIGNED_REGION].map((row) => row.id))
  const patientsBySession = new Map(b.sessions.map((row) => [row.session_id, row.patient_id]))
  const patientsBySite = new Map(b.sites.map((row) => [row.site_id, row.patient_id]))
  const patientsByElectrode = new Map(b.electrodes.map((row) => [row.electrode_contact_id, row.patient_id]))

  duplicateIssues('patients', b.patients, (row) => row.patient_id, issues)
  duplicateIssues('sessions', b.sessions, (row) => row.session_id, issues)
  duplicateIssues('electrodes', b.electrodes, (row) => row.electrode_contact_id, issues)
  duplicateIssues('sites', b.sites, (row) => row.site_id, issues)
  duplicateIssues('stimulation_events', b.stimulation_events, (row) => row.event_id, issues)
  duplicateIssues('effect_labels', b.effect_labels, (row) => row.event_id, issues)
  duplicateIssues('qc_flags', b.qc_flags, (row) => row.event_id, issues)
  duplicateIssues('reports', b.reports, (row) => row.event_id, issues)
  duplicateIssues('ccep_availability', b.ccep_availability, (row) => row.site_id, issues)

  referenceIssues('sessions', b.sessions, (row) => row.patient_id, patientIds, 'patient', issues)
  referenceIssues('electrodes', b.electrodes, (row) => row.patient_id, patientIds, 'patient', issues)
  referenceIssues('sites', b.sites, (row) => row.patient_id, patientIds, 'patient', issues)
  // A controlled/core export may omit the electrodes table while retaining the
  // site contact ids. In that case the relationship cannot be validated yet, but
  // it must not be reported as thousands of confirmed orphan references. An
  // explicitly present, incomplete electrodes table still gets strict checks.
  if (!unavailableTables.includes('electrodes')) {
    referenceIssues('sites', b.sites, (row) => row.contact_1_id, electrodeIds, 'contact_1', issues)
    referenceIssues('sites', b.sites, (row) => row.contact_2_id, electrodeIds, 'contact_2', issues)
  }
  referenceIssues('sites', b.sites, (row) => row.region_id, regionIds, 'region', issues)
  for (const site of b.sites) {
    for (const contactId of [site.contact_1_id, site.contact_2_id]) {
      if (!contactId) continue
      const contactPatient = patientsByElectrode.get(contactId)
      if (contactPatient && contactPatient !== site.patient_id) issues.push({ table: 'sites', id: site.site_id, message: `contact ${contactId} belongs to a different patient` })
    }
  }
  for (const event of b.stimulation_events) {
    if (!patientIds.has(event.patient_id)) issues.push({ table: 'stimulation_events', id: event.event_id, message: 'missing patient reference' })
    if (!sessionIds.has(event.session_id)) issues.push({ table: 'stimulation_events', id: event.event_id, message: 'missing session reference' })
    if (!siteIds.has(event.site_id)) issues.push({ table: 'stimulation_events', id: event.event_id, message: 'missing site reference' })
    if (patientsBySession.get(event.session_id) && patientsBySession.get(event.session_id) !== event.patient_id) issues.push({ table: 'stimulation_events', id: event.event_id, message: 'session belongs to a different patient' })
    if (patientsBySite.get(event.site_id) && patientsBySite.get(event.site_id) !== event.patient_id) issues.push({ table: 'stimulation_events', id: event.event_id, message: 'site belongs to a different patient' })
  }
  referenceIssues('reports', b.reports, (row) => row.event_id, eventIds, 'event', issues)
  referenceIssues('effect_labels', b.effect_labels, (row) => row.event_id, eventIds, 'event', issues)
  referenceIssues('qc_flags', b.qc_flags, (row) => row.event_id, eventIds, 'event', issues)
  referenceIssues('atlas_labels', b.atlas_labels, (row) => row.site_id, siteIds, 'site', issues)
  referenceIssues('ccep_availability', b.ccep_availability, (row) => row.site_id, siteIds, 'site', issues)
  for (const summary of b.ccep_site_summary ?? []) {
    if (!siteIds.has(summary.site_id)) issues.push({ table: 'ccep_site_summary', id: summary.site_id, message: 'missing site reference' })
  }
  for (const edge of b.ccep_region_connectivity ?? []) {
    if (!regionIds.has(edge.out_region_id)) issues.push({ table: 'ccep_region_connectivity', id: edge.out_region_id, message: 'missing out_region reference' })
    if (!regionIds.has(edge.in_region_id)) issues.push({ table: 'ccep_region_connectivity', id: edge.in_region_id, message: 'missing in_region reference' })
  }

  const sourceRows = b.patients.length + b.sessions.length + b.electrodes.length + b.sites.length + b.stimulation_events.length + b.reports.length + b.effect_labels.length + b.qc_flags.length + b.atlas_labels.length + b.ccep_availability.length
  const joinedEvents = b.stimulation_events.filter((event) => (
    siteIds.has(event.site_id) && eventIds.has(event.event_id) && patientIds.has(event.patient_id) && sessionIds.has(event.session_id) && effectIds.has(event.event_id) && qcIds.has(event.event_id)
  )).length
  return { valid: issues.length === 0, issues, unavailableTables: [...unavailableTables], sourceRows, joinedEvents }
}

async function fetchJson<T>(name: string): Promise<T> {
  const base = import.meta.env.BASE_URL || '/'
  // Data source dir is `data` (committed synthetic) by default; set
  // VITE_DATA_DIR=data-real to load the locally-built, git-ignored real
  // de-identified tables. The real dir is never committed (see .gitignore).
  const dir = import.meta.env.VITE_DATA_DIR || 'data'
  const res = await fetch(`${base}${dir}/${name}.json`)
  if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`)
  return res.json() as Promise<T>
}

/** Best-effort optional table → rows plus availability, so a trimmed export is
 * distinguishable from an empty table without fabricating referential errors. */
async function fetchOptionalWithStatus<T>(name: string): Promise<{ name: string; rows: T[]; available: boolean }> {
  try {
    return { name, rows: await fetchJson<T[]>(name), available: true }
  } catch {
    return { name, rows: [], available: false }
  }
}

/** Best-effort optional keyed object (e.g. the CCEP site brief) → {} if absent. */
async function fetchOptionalObject<T>(name: string): Promise<Record<string, T>> {
  try {
    return await fetchJson<Record<string, T>>(name)
  } catch {
    return {}
  }
}

// Tables the 3D atlas genuinely needs to build its event rows (see buildDb: every
// event requires site + effect + qc + patient + session). A trimmed/core-only export
// must include these or the atlas comes up empty.
const REQUIRED = ['manifest', 'patients', 'sessions', 'sites', 'stimulation_events', 'effect_labels', 'qc_flags'] as const

/** The best-effort tables, by name. A page that never reads one passes `optional` without it, and
 *  it is not fetched: an unfetched table is reported as unavailable, exactly like an absent one. */
export const OPTIONAL_TABLES = ['electrodes', 'atlas_labels', 'reports', 'ccep_availability', 'ccep_site_summary', 'ccep_region_connectivity', 'ccep_site_brief'] as const
export type OptionalTable = (typeof OPTIONAL_TABLES)[number]

export async function loadDb(
  onProgress?: (done: number, total: number) => void,
  opts: { optional?: readonly OptionalTable[] } = {},
): Promise<Db> {
  // Detail + connectivity tables are best-effort: electrodes/atlas_labels/reports only
  // power detail pages (not the map), and CCEP is real-build-only. Loading them
  // optionally means a core-only export still boots — detail pages just degrade.
  const want = new Set<string>(opts.optional ?? OPTIONAL_TABLES)
  const skip = <T,>(name: string, f: () => Promise<T>, empty: T): Promise<T> => (want.has(name) ? f() : Promise.resolve(empty))
  const absent = <T,>(name: string) => ({ name, rows: [] as T[], available: false })
  // only the required tables report progress, so only they make up the total (it read "4/11" and stopped)
  const total = REQUIRED.length
  let done = 0
  const results = await Promise.all(
    REQUIRED.map(async (n) => {
      const data = await fetchJson<unknown>(n)
      done++
      onProgress?.(done, total)
      return [n, data] as const
    }),
  )
  const map = Object.fromEntries(results) as Record<string, unknown>
  const [electrodesResult, atlasLabelsResult, reportsResult, ccepAvailabilityResult, ccepSiteSummary, ccepRegionConn, ccepBrief] =
    await Promise.all([
      skip('electrodes', () => fetchOptionalWithStatus<Electrode>('electrodes'), absent<Electrode>('electrodes')),
      skip('atlas_labels', () => fetchOptionalWithStatus<AtlasLabel>('atlas_labels'), absent<AtlasLabel>('atlas_labels')),
      skip('reports', () => fetchOptionalWithStatus<Report>('reports'), absent<Report>('reports')),
      skip('ccep_availability', () => fetchOptionalWithStatus<CcepAvailability>('ccep_availability'), absent<CcepAvailability>('ccep_availability')),
      skip('ccep_site_summary', () => fetchOptionalWithStatus<CcepSiteSummary>('ccep_site_summary').then((result) => result.rows), [] as CcepSiteSummary[]),
      skip('ccep_region_connectivity', () => fetchOptionalWithStatus<CcepRegionConn>('ccep_region_connectivity').then((result) => result.rows), [] as CcepRegionConn[]),
      skip('ccep_site_brief', () => fetchOptionalObject<CcepSiteBrief>('ccep_site_brief'), {} as Record<string, CcepSiteBrief>),
    ])
  const unavailableTables = [electrodesResult, atlasLabelsResult, reportsResult, ccepAvailabilityResult]
    .filter((result) => !result.available)
    .map((result) => result.name)
  const bundle: AtlasBundle = {
    manifest: map.manifest as DatasetManifest,
    patients: map.patients as Patient[],
    sessions: map.sessions as Session[],
    electrodes: electrodesResult.rows,
    sites: map.sites as Site[],
    stimulation_events: map.stimulation_events as StimEvent[],
    reports: reportsResult.rows,
    effect_labels: map.effect_labels as EffectLabel[],
    qc_flags: map.qc_flags as QcFlag[],
    atlas_labels: atlasLabelsResult.rows,
    ccep_availability: ccepAvailabilityResult.rows,
    ccep_site_summary: ccepSiteSummary,
    ccep_region_connectivity: ccepRegionConn,
  }
  return buildDb(bundle, ccepBrief, unavailableTables)
}

/* ============================================================================
   Load-boundary normalisation (audit DATA-02 / DATA-04).

   Three defects in the served `sites` table were surfacing directly in the UI and
   in every aggregate that groups on these columns. They are fixed once here, at the
   boundary, so all views agree; the files on disk are untouched.

   1. `anatomical_label_primary` / `lobe` carry the LITERAL string "undefined" on 35
      and 37 sites — a JavaScript `undefined` that was stringified somewhere upstream.
      The UI rendered it verbatim, so a site row read "LPH1-LPH2  undefined  one subject"
      as though "undefined" were an anatomical structure. Mapped to null so the UI can
      show an explicit unlabelled state.

   2. `network_label_primary` splits two Yeo-7 networks across two spellings each
      ("Ventral Attention" 654 + "VentralAttention" 198; "Dorsal Attention" 172 +
      "DorsalAttention" 65), so any grouping on this column silently divided those
      networks in half. Canonicalised to the no-space form used by anatomy.ts.

   3. The same column carries values that are NOT networks at all: "Depth" (898 sites
      — that is an electrode type) and "FreeSurfer_Defined_Medial_Wall" (44). Together
      with (2) that made the field wrong or ambiguous for 2,031 of 4,889 sites (41.5%).
      Non-networks are mapped to null rather than silently re-labelled, because we do
      not know what network those contacts belong to — inventing one would be worse
      than admitting we don't know.
   ========================================================================== */
const YEO7_CANON = new Set<Yeo7>(['Visual', 'Somatomotor', 'DorsalAttention', 'VentralAttention', 'Limbic', 'Frontoparietal', 'Default'])
/** Values that are known NOT to be Yeo-7 networks, kept explicit so the list is auditable. */
const NON_NETWORK_VALUES = new Set(['Depth', 'FreeSurfer_Defined_Medial_Wall'])

function nullIfUndefinedString(v: unknown): string | null {
  if (typeof v !== 'string') return (v ?? null) as string | null
  const t = v.trim()
  return t === '' || t === 'undefined' || t === 'null' || t === 'NaN' ? null : v
}

export function canonicalNetwork(v: unknown): Yeo7 | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const collapsed = v.replace(/\s+/g, '') as Yeo7
  if (YEO7_CANON.has(collapsed)) return collapsed
  if (NON_NETWORK_VALUES.has(v) || NON_NETWORK_VALUES.has(collapsed)) return null
  return null
}

/** A site's OWN Yeo-7, from that patient's FreeSurfer surface — never the network attached to
 *  its navigation grouping. Null when the patient has no native label for it, which is a fact
 *  worth showing as blank rather than filling in from the grouping. */
export function siteNetwork(site: Pick<Site, 'network_label_primary'>): Yeo7 | null {
  return canonicalNetwork(site.network_label_primary)
}

function normalizeSites(sites: Site[]): Site[] {
  return sites.map((s) => {
    const anat = nullIfUndefinedString(s.anatomical_label_primary)
    const anat2 = nullIfUndefinedString(s.anatomical_label_secondary)
    const lobe = nullIfUndefinedString(s.lobe)
    const net = canonicalNetwork(s.network_label_primary)
    if (
      anat === s.anatomical_label_primary && anat2 === s.anatomical_label_secondary &&
      lobe === s.lobe && net === s.network_label_primary
    ) return s
    return {
      ...s,
      anatomical_label_primary: anat as Site['anatomical_label_primary'],
      anatomical_label_secondary: anat2 as Site['anatomical_label_secondary'],
      lobe: lobe as Site['lobe'],
      network_label_primary: net as Site['network_label_primary'],
    }
  })
}

export function buildDb(
  bRaw: AtlasBundle,
  ccepBrief: Record<string, CcepSiteBrief> = {},
  unavailableTables: readonly string[] = [],
  spaceEvidenceBySubject?: Readonly<Record<string, SpaceEvidence>>,
): Db {
  // Normalise FIRST, then check integrity on what the app actually consumes. Normalisation
  // only rewrites label strings (anatomy / lobe / network), never ids, so the referential
  // checks see the same graph either way — but the report should describe the served bundle.
  // TWO boundary normalisations, both required, and they do different jobs.
  //
  // normalizeSite (singular) attaches coordinate_provenance and region_assignment_* to
  // releases built before those fields existed. The then-served real build was one of those: 0
  // of its 4,785 site rows carried coordinate_provenance, while the committed synthetic build carried
  // it on all 2,294. Every reader of site.coordinate_provenance.* — sitePoint, flattenRow,
  // hasRenderableMni, the Explorer, Brain3D, SiteDetail, EffectQuery, RegionQuery — throws
  // without it. Dropping this call in the 9c73b7c merge broke that real build while leaving
  // the synthetic one healthy, which is exactly why it was not caught by a smoke check.
  //
  // normalizeSites (plural) is the DATA-02/04 label cleanup: the literal string "undefined",
  // the split Yeo-7 spellings, and non-network values in network_label_primary.
  const resolvedContactIds = new Set(bRaw.electrodes.map((e) => e.electrode_contact_id))
  /* The real build's coordinates are MNI305 for MOST subjects — proved, not assumed:
     scripts/verify_coordinate_provenance.py composed each subject's own talairach.xfm and
     reproduced the elec_loc MNI columns for 155 of 222 assessable subjects at a median residual
     of 7.5e-06 mm. Passing 'unknown' here was the conservative default for a release built
     before the provenance fields existed, but its effect was not conservative: it withheld all
     4,785 then-served sites from every view.
     The denominator is the point. 155/222 is not 222/222: 67 subjects admit no affine at all,
     and the declaration is made per ROW while the evidence is per SUBJECT. So the space is
     declared — the render fix is right — but each row also records WHOSE evidence supports it
     via space_evidence, which is 'cohort_assumed' until a per-subject table says otherwise.
     spaceEvidenceBySubject is that table's drop-in point: absent it nothing is claimed to be
     individually verified, and no row is silently promoted to 'subject_reproduced'. */
  const provenanced = bRaw.sites.map((site) =>
    normalizeSite(site, resolvedContactIds, bRaw.manifest.synthetic ? 'mni152' : 'mni305', spaceEvidenceBySubject))
  const b: AtlasBundle = { ...bRaw, sites: normalizeSites(provenanced) }
  const integrity = validateBundle(b, unavailableTables)
  const patientById = indexBy(b.patients, (p) => p.patient_id)
  const sessionById = indexBy(b.sessions, (s) => s.session_id)
  const electrodeById = indexBy(b.electrodes, (e) => e.electrode_contact_id)
  const siteById = indexBy(b.sites, (s) => s.site_id)
  const eventById = indexBy(b.stimulation_events, (e) => e.event_id)
  const effectByEvent = indexBy(b.effect_labels, (e) => e.event_id)
  const qcByEvent = indexBy(b.qc_flags, (q) => q.event_id)
  const reportByEvent = indexBy(b.reports, (r) => r.event_id)
  const atlasBySite = groupBy(b.atlas_labels, (a) => a.site_id)
  const ccepBySite = indexBy(b.ccep_availability, (c) => c.site_id)
  const ccepSiteSummary = b.ccep_site_summary ?? []
  const ccepRegionConn = b.ccep_region_connectivity ?? []
  const ccepSummaryBySite = indexBy(ccepSiteSummary, (c) => c.site_id)
  const ccepBriefByKey = new Map<string, CcepSiteBrief>(Object.entries(ccepBrief))
  const ccepEfferentByRegion = groupBy(
    ccepRegionConn.filter((e) => e.n_connected > 0 && e.n_connections_tested >= CCEP_MIN_TESTED),
    (e) => `${e.out_region_id}|${e.out_hemisphere}`,
  )
  for (const edges of ccepEfferentByRegion.values()) {
    edges.sort((a, b2) => (b2.activation_rate ?? 0) - (a.activation_rate ?? 0))
  }
  const electrodesByPatient = groupBy(b.electrodes, (e) => e.patient_id)
  const sitesByPatient = groupBy(b.sites, (s) => s.patient_id)

  const rows: EventRow[] = []
  const rowByEvent = new Map<string, EventRow>()
  /* Two rules this loop used to break silently.

     1. A row was dropped whenever any side of the join was missing, with no issue raised. The
        integrity report then read `valid: true, issues: 0` over a bundle that had lost events —
        absence of an error being taken for presence of data. Drops are now COUNTED by cause.
        Counted, not enumerated: a missing optional table produces one drop per event, and the
        historical 8,575-issue report over a single absent table overstated corruption so badly
        that it obscured the real defects. One issue per cause, carrying the exact count.

     2. An event was joined to a site, patient and session without checking they describe the
        SAME patient. That join is structurally valid and scientifically impossible: it attributes
        one patient's stimulation to another's anatomy. It is rejected here rather than filtered
        downstream, because every consumer reaches the data through these rows. */
  const dropped = new Map<string, number>()
  const note = (cause: string) => dropped.set(cause, (dropped.get(cause) ?? 0) + 1)
  for (const event of b.stimulation_events) {
    const site = siteById.get(event.site_id)
    const effect = effectByEvent.get(event.event_id)
    const qc = qcByEvent.get(event.event_id)
    const patient = patientById.get(event.patient_id)
    const session = sessionById.get(event.session_id)
    if (!site) { note('no matching site'); continue }
    if (!effect) { note('no matching effect label'); continue }
    if (!qc) { note('no matching qc flag'); continue }
    if (!patient) { note('no matching patient'); continue }
    if (!session) { note('no matching session'); continue }
    if (site.patient_id !== event.patient_id || session.patient_id !== event.patient_id) {
      note('cross-patient join rejected'); continue
    }
    const region = REGION_BY_ID[site.region_id] ?? UNASSIGNED_REGION
    const row: EventRow = { event, site, effect, qc, patient, session, region }
    rows.push(row)
    rowByEvent.set(event.event_id, row)
  }
  for (const [cause, count] of dropped) {
    // A drop caused by a table the export never shipped is already reported as an unavailable
    // table; repeating it per event would restate one known gap thousands of times.
    const table = cause.includes('effect') ? 'effect_labels' : cause.includes('qc') ? 'qc_flags'
      : cause.includes('site') ? 'sites' : cause.includes('patient') ? 'patients' : 'sessions'
    if (unavailableTables.includes(table)) continue
    integrity.issues.push({ table: 'stimulation_events', id: `${count} events`, message: cause })
    if (cause === 'cross-patient join rejected') integrity.valid = false
  }
  const eventsBySite = groupBy(rows, (r) => r.site.site_id)

  return {
    manifest: b.manifest,
    patients: b.patients,
    sessions: b.sessions,
    electrodes: b.electrodes,
    sites: b.sites,
    events: b.stimulation_events,
    reports: b.reports,
    effectLabels: b.effect_labels,
    qcFlags: b.qc_flags,
    atlasLabels: b.atlas_labels,
    ccep: b.ccep_availability,
    patientById, sessionById, electrodeById, siteById, eventById,
    effectByEvent, qcByEvent, reportByEvent, atlasBySite, ccepBySite,
    ccepSiteSummary, ccepRegionConn, ccepSummaryBySite, ccepBriefByKey, ccepEfferentByRegion,
    electrodesByPatient, sitesByPatient, eventsBySite, rowByEvent,
    rows,
    regions: REGIONS,
    integrity,
  }
}
