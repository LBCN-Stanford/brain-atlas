/* ============================================================================
   Brain Atlas (Aim 1) — relational schema.

   Single source of truth for the 10 canonical tables (see docs/explanation/PROJECT_CONTEXT.md
   "TARGET DATA MODEL"). Zod schemas double as runtime validators (used by the
   synthetic generator + Data Quality checks) and as the origin of the TypeScript
   types used throughout the app. Field names match the spec 1:1; a small number
   of clearly-marked extension fields support multi-label effects and Aim-3 hooks.
   ========================================================================== */

import { z } from 'zod'

// --- shared enums -----------------------------------------------------------

export const DataAccessLevel = z.enum(['public_derived', 'controlled', 'protected'])
export const Sex = z.enum(['F', 'M', 'other', 'unknown'])
export const Handedness = z.enum(['right', 'left', 'ambidextrous', 'unknown'])
export const Lateralization = z.enum(['left', 'right', 'bilateral', 'none', 'unknown'])

export const SessionType = z.enum(['iES', 'SPES', 'CCEP', 'task', 'rest', 'sham', 'other'])
export const ElectrodeType = z.enum(['ECoG_grid', 'strip', 'sEEG_depth', 'other'])
export const MontageType = z.enum(['bipolar', 'monopolar', 'other'])
// Effect-eliciting protocols only. SPES/CCEP are single-pulse connectivity
// RECORDINGS (see SessionType + ccep_availability), not percept protocols.
export const StimProtocol = z.enum(['iES', 'sham', 'other'])
export const ProtocolSource = z.enum([
  'declared_stim', 'assumed_stim', 'declared_sham', 'assumed_sham',
  'unmatched', 'unrecognised_flag',
])
export const Waveform = z.enum(['biphasic', 'monophasic', 'other'])
export const Polarity = z.enum(['cathodic_first', 'anodic_first', 'alternating', 'na'])

export const EffectPresence = z.enum([
  'positive',
  'null',
  'uncertain',
  'not_assessable',
  'excluded',
])
export const EffectFamily = z.enum([
  'somatosensory',
  'visual',
  'language',
  'interoceptive',
  'affective',
  'memory',
  'self',
  'motor',
  'auditory',
  'olfactory_gustatory',
  'vestibular',
  'sensory_unspecified',
  'epileptic',
  'null',
  'other',
])
export const ReportType = z.enum([
  'verbal_report',
  'observed_behavior',
  'clinician_note',
  'video_reference',
  'protected_reference',
])
export const LabelSource = z.enum([
  'Desikan',
  'Destrieux',
  'HCP-MMP',
  'Schaefer',
  'Yeo7',
  'Yeo17',
  'Brainnetome',
  'lab_custom',
  'principal_gradient',
])
export const Space = z.enum(['native', 'common'])
export const CcepQc = z.enum(['pass', 'review', 'fail', 'na'])

export const CommonCoordinateSpace = z.enum(['mni152', 'mni305', 'unknown'])
export const MidpointMethod = z.enum(['two_contact_mean', 'single_contact', 'event_coordinate', 'missing'])
export const LocalizationStatus = z.enum(['verified', 'uncertain', 'unavailable'])
/* How the DECLARED SPACE was established for the subject this site belongs to. Distinct from
   localization_status, which describes the midpoint rather than the frame it is expressed in.
   The two were conflated: a row could read localization_status 'uncertain' while its space and
   transform were asserted flatly, and only the midpoint caveat reached the reader.
     subject_reproduced — this subject's own talairach.xfm reproduced the stored MNI columns
     cohort_assumed    — the space is inferred from a cohort-level result, not from this subject
     subject_failed    — this subject was checked and admits no affine; the MNI columns are not
                         recoverable, so they must not be queried against an MNI atlas
     not_assessed      — no per-subject check exists for this subject */
export const SpaceEvidence = z.enum(['subject_reproduced', 'cohort_assumed', 'subject_failed', 'not_assessed'])
export type SpaceEvidence = z.infer<typeof SpaceEvidence>
/* 'aseg_subcortical': thalamus / basal_ganglia / ventral_diencephalon are assigned from the
   per-patient FreeSurfer aseg label, NOT from a centroid — there is no centroid for them in the
   37-region table, so they carry no margin. Keeping them under a "nearest_coarse_centroid" name
   would misdescribe how those 191 sites were placed. */
export const RegionAssignmentMethod = z.enum(['nearest_coarse_centroid', 'nearest_coarse_centroid_unverified', 'aseg_subcortical', 'unassigned', 'unknown'])
export const CoordinateProvenanceSchema = z.object({
  common_coordinate_space: CommonCoordinateSpace,
  common_coordinate_source: z.string(),
  transform_id: z.string().nullable(),
  midpoint_method: MidpointMethod,
  contacts_used: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  localization_status: LocalizationStatus,
  space_evidence: SpaceEvidence.default('not_assessed'),
})
export type CoordinateProvenance = z.infer<typeof CoordinateProvenanceSchema>

// --- 1. patients ------------------------------------------------------------

export const PatientSchema = z.object({
  patient_id: z.string(),
  age_bin: z.string(),
  sex: Sex,
  handedness: Handedness,
  implant_type_summary: z.string(),
  epilepsy_lateralization: Lateralization,
  seizure_onset_zone_summary: z.string(),
  data_access_level: DataAccessLevel,
  // Aim-3 availability hooks (per-patient)
  tractography_available: z.boolean(),
  rsfmri_available: z.boolean(),
  cohort: z.string(),
})
export type Patient = z.infer<typeof PatientSchema>

// --- 2. sessions ------------------------------------------------------------

export const SessionSchema = z.object({
  session_id: z.string(),
  patient_id: z.string(),
  session_type: SessionType,
  relative_day: z.number().int(),
  time_of_day_bin: z.enum(['morning', 'midday', 'afternoon', 'evening', 'unknown']),
  medication_state: z.enum(['normal', 'reduced', 'tapered', 'unknown']),
  sleep_arousal_state: z.enum(['alert', 'drowsy', 'fatigued', 'unknown']),
  task_context: z.string(),
  notes_available_flag: z.boolean(),
})
export type Session = z.infer<typeof SessionSchema>

// --- 3. electrodes (contacts) ----------------------------------------------

export const ElectrodeSchema = z.object({
  electrode_contact_id: z.string(),
  patient_id: z.string(),
  clinical_name: z.string(),
  contact_number: z.number().int(),
  electrode_type: ElectrodeType,
  manufacturer: z.string(),
  native_x: z.number(),
  native_y: z.number(),
  native_z: z.number(),
  mni_x: z.number(),
  mni_y: z.number(),
  mni_z: z.number(),
  /* Same contact in MNI152 (ICBM152_NLin6Asym). See mni152_midpoint_* on Site. */
  mni152_x: z.number().nullable().default(null),
  mni152_y: z.number().nullable().default(null),
  mni152_z: z.number().nullable().default(null),
  coordinate_source_space: z.string().nullable().default(null),
  coordinate_target_space: z.string().nullable().default(null),
  transform_id: z.string().nullable().default(null),
  transform_method: z.string().nullable().default(null),
  surface_vertex: z.number().int().nullable(),
  localization_method: z.string(),
  localization_confidence: z.enum(['high', 'medium', 'low']),
  coordinate_uncertainty_mm: z.number(),
})
export type Electrode = z.infer<typeof ElectrodeSchema>

// --- 4. sites (electrode pairs) --------------------------------------------

export const SiteSchema = z.object({
  site_id: z.string(),
  patient_id: z.string(),
  contact_1_id: z.string(),
  contact_2_id: z.string(),
  electrode_pair: z.string(),
  montage_type: MontageType,
  pair_distance_mm: z.number(),
  native_midpoint_x: z.number().nullable(),
  native_midpoint_y: z.number().nullable(),
  native_midpoint_z: z.number().nullable(),
  // Coordinate-space provenance for the native midpoint. A null value is retained when no
  // native contact resolved; legacy MNI-derived values remain marked by their source enum.
  native_midpoint_source: z.enum(['contact_mean', 'contact_mean_mni', 'mni_fallback', 'unavailable']),
  mni_midpoint_x: z.number().nullable(),
  mni_midpoint_y: z.number().nullable(),
  mni_midpoint_z: z.number().nullable(),
  /* The midpoint in MNI152 (ICBM152_NLin6Asym), precomputed by the pipeline as the mean of the
     two CONVERTED contacts. Prefer it over converting mni_midpoint_* at read time. The two agree
     to 0.002 mm under the current affine — an affine commutes with averaging — but they stop
     agreeing the moment the transform becomes nonlinear (Wu et al. 2018, the documented upgrade),
     where convert-then-average is right and average-then-convert is wrong. Defaults to null so a
     legacy release still parses; sitePoint falls back to converting when it is absent. */
  /* Millimetres the midpoint lies OUTSIDE the brain's outer envelope; 0 means inside, null means
     no coordinate. Written by scripts/flag_outside_brain.py. Stored as a DISTANCE, not a boolean,
     so the renderer picks the threshold and this column does not bake one in. */
  outside_brain_mm: z.number().nullable().default(null),
  mni152_midpoint_x: z.number().nullable().default(null),
  mni152_midpoint_y: z.number().nullable().default(null),
  mni152_midpoint_z: z.number().nullable().default(null),
  /* ---- ANTs SyN into ICBM152 2009a, adopted 18 August 2026 --------------------------------
     A THIRD template position per site, added beside the other two rather than replacing either.
     MNI305 (mni_midpoint_*) is what the lab sheets recorded; NLin6Asym (mni152_midpoint_*) is the
     linear FreeSurfer affine applied to it; these are a nonlinear registration of each patient's
     own T1 into the 2009a template, run with antsRegistrationSyN.sh (ANTs 2.6.0).

     Nullable because coverage is real and not universal: 4,288 of 4,761 sites have one. The
     remainder either have no usable native coordinate at all, or belong to a subject whose
     implant could not be attributed to one FreeSurfer recon and was refused rather than guessed.

     The midpoint is the mean of the two CONVERTED contacts. That distinction is decorative for an
     affine, which commutes with averaging, and load-bearing here, which does not. */
  mni2009a_midpoint_x: z.number().nullable().default(null),
  mni2009a_midpoint_y: z.number().nullable().default(null),
  mni2009a_midpoint_z: z.number().nullable().default(null),
  /* The tier ladder's answer AT that midpoint: Brainnetome 246 -> white-matter mask -> JuBrain ->
     unlabelled. `unlabelled` is a real terminal state, never a nearest guess. */
  label_2009a: z.string().nullable().default(null),
  /* The 24-group gross level Brainnetome publishes behind its 246 parcels (`label_overall`),
     plus 'White matter' and 'JuBrain' for the lower rungs. Same lookup, readable legend: 246
     colours is not a legend, it is a texture. */
  label_2009a_macro: z.string().nullable().default(null),
  label_2009a_tier: z.enum(['brainnetome', 'white_matter', 'jubrain', 'unlabelled'])
    .nullable().default(null),
  /* IN-BOUNDS IS NOT IN-BRAIN, and this field exists because of that. An atlas's labelled extent
     is more generous than the pial surface it was built from, so a midpoint outside the brain can
     still land on a confident parcel. Tested against the brain-extracted template that was the
     fixed image for every warp; false means the ladder terminated at unlabelled regardless of what
     any atlas would have returned. */
  label_2009a_in_brain: z.boolean().nullable().default(null),
  /* The DISTANCE behind that boolean, in mm outside the template brain, 0 when inside. Shipped
     because "outside" is a threshold on a continuum and a reader should be able to move it
     without re-running the pipeline -- the same shape `outside_brain_mm` already has. The
     labelling gate is 2 mm: above the 1.34 mm instrument floor (voxel quantisation 0.5,
     registration residual 0.76, skull-strip boundary ~1.0, in quadrature) and stricter than the
     6 mm the renderer applies, so the two out-of-brain verdicts this build ships are nested. */
  label_2009a_outside_mm: z.number().nullable().default(null),
  contact_1_label_2009a: z.string().nullable().default(null),
  contact_2_label_2009a: z.string().nullable().default(null),
  /* Set on the 433 sites (12.3% of those with two labelled contacts) where the midpoint's parcel
     matches NEITHER contact's. The midpoint label still defines the site and its colour -- that
     was the decision -- and this makes the cost of it visible instead of argued about. */
  label_2009a_matches_neither: z.boolean().nullable().default(null),
  /* THE FOUR PARALLEL ATLASES, sampled at the SAME 2009a midpoint as `label_2009a` above.
     Independent lookups, not a ladder: none falls back to another, and none is backfilled from
     Brainnetome. Each is the direct replacement for the identically-named REGION-TABLE attribute
     (`Region.dk` etc. in space/anatomy.ts), which a site inherits from whichever of 37 hand-placed
     centroids is nearest at a median 13.5 mm. These are read at the electrode.

     FOUR STATES, and they are not interchangeable:
       <parcel name>     the atlas named a parcel here
       'not_applicable'  a CORTICAL-ONLY atlas asked at a subcortical point. Measured: desikan
                         labels 0.2% of thalamus, 8.9% of hippocampus and 21.6% of amygdala
                         voxels -- and those hits are cortical names that bled inward when the
                         atlas was projected from a surface into voxels, so they are worse than
                         no answer. Brainnetome and JuBrain are the authorities in subcortex.
       'unlabelled'      the in-brain gate refused the point, so no atlas was sampled at all
       null              asked, and the atlas returned background (white matter, or a gap in its
                         projected ribbon) -- OR the site has no 2009a coordinate. Distinguish
                         those two by `mni2009a_midpoint_x`, exactly as the Brainnetome column does.

     `glasser_2009a` carries an _L / _R suffix this repo adds. The atlas's own label strings are
     hemisphere-blind -- indices 1-180 and 181-360 hold IDENTICAL names -- so the side comes from
     the index range (verified: 1-180 is 99.8% x<0). Without it left and right V1 merge into one
     category, which would be a fabricated anatomical equivalence rather than a display choice. */
  dk_2009a: z.string().nullable().default(null),
  destrieux_2009a: z.string().nullable().default(null),
  glasser_2009a: z.string().nullable().default(null),
  schaefer_2009a: z.string().nullable().default(null),
  coordinate_2009a_provenance: z.object({
    method: z.string().nullish(),
    template: z.string().nullish(),
    ants_version: z.string().nullish(),
    target_space: z.string().nullish(),
    variant: z.string().nullish(),
    n_contacts: z.number().nullish(),
    electrode_class: z.string().nullish(),
    midpoint_rule: z.string().nullish(),
  }).nullable().default(null),
  anatomical_label_primary: z.string(),
  anatomical_label_secondary: z.string(),
  network_label_primary: z.string(),
  /* BOTH contacts' parcels, and whether they agree. A site is a pair, and the effect comes from
     the pair rather than from a point, but `anatomical_label_primary` above is contact 1's label
     chosen silently — so a pair straddling two parcels asserted one of them and the straddle was
     invisible. These make it visible without changing what the field above means.

     `contact_label_agreement` has FIVE states, and the distinctions are the point. `single_contact`
     is NOT `agree`: a monopolar site, or a bipolar one whose second contact never resolved, has no
     second opinion rather than a matching one, and collapsing those would overstate agreement.
     `indeterminate` covers a contact that resolved but carries no DK parcel to compare.
     `unavailable` means nothing was measured at all.

     CAUTION on the defaults. `SiteSchema` is NOT used to parse the served tables — the app loads
     them through `fetchJson` in `lib/core/data.ts` without `.parse`, and `TABLE_SCHEMAS`' only
     consumers are in `app/scripts/generate.ts`. So on the current 3.1-real release these fields
     are `undefined` at runtime, not `'unavailable'`, even though the type says otherwise. Read
     them as `site.contact_label_agreement ?? 'unavailable'` until an ETL run emits them; the
     default below documents the intended value and protects the synthetic path, nothing more. */
  contact_1_label_dk: z.string().nullable().default(null),
  contact_1_label_destrieux: z.string().nullable().default(null),
  contact_2_label_dk: z.string().nullable().default(null),
  contact_2_label_destrieux: z.string().nullable().default(null),
  contact_label_agreement: z.enum(['agree', 'disagree', 'single_contact', 'indeterminate', 'unavailable'])
    .default('unavailable'),
  localization_uncertainty_mm: z.number().nullable(),
  region_assignment_distance_mm: z.number().nullable().default(null),
  region_assignment_method: RegionAssignmentMethod.default('unknown'),
  region_assignment_source: z.string().default('unknown'),
  region_assignment_version: z.string().nullable().default(null),
  coordinate_provenance: CoordinateProvenanceSchema.default({
    common_coordinate_space: 'unknown', common_coordinate_source: 'legacy_release', transform_id: null,
    midpoint_method: 'missing', contacts_used: 0, localization_status: 'unavailable',
    space_evidence: 'not_assessed',
  }),
  // derived links (clearly synthetic-twin extensions)
  region_id: z.string(),
  hemisphere: z.enum(['L', 'R']),
  lobe: z.string(),
  gradient: z.number(),
  electrode_type: ElectrodeType,
})
export type Site = z.infer<typeof SiteSchema>

// --- 5. stimulation_events --------------------------------------------------

export const StimEventSchema = z.object({
  event_id: z.string(),
  patient_id: z.string(),
  session_id: z.string(),
  site_id: z.string(),
  stimulation_protocol: StimProtocol,
  // nullish for synthetic/older builds; a missing field is not a declaration.
  protocol_source: ProtocolSource.nullish(),
  frequency_hz: z.number().nullable(),
  current_mA: z.number().nullable(),
  pulse_width_us: z.number().nullable(),
  train_duration_s: z.number().nullable(),
  number_of_pulses: z.number().int().nullable(),
  waveform: Waveform,
  polarity: Polarity,
  charge_density: z.number().nullable(),
  task_context: z.string(),
  brain_state_context: z.string(),
})
export type StimEvent = z.infer<typeof StimEventSchema>

// --- 6. reports -------------------------------------------------------------

export const ReportSchema = z.object({
  report_id: z.string(),
  event_id: z.string(),
  report_type: ReportType,
  raw_report_redacted: z.string().nullable(),
  protected_transcript_reference: z.string(),
  observer_notes_redacted: z.string().nullable(),
  time_to_report_sec: z.number().nullable(),
})
export type Report = z.infer<typeof ReportSchema>

// --- 7. effect_labels (hierarchical, multi-label) ---------------------------

export const EffectLabelSchema = z.object({
  event_id: z.string(),
  effect_presence: EffectPresence,
  primary_effect_family: EffectFamily,
  effect_subtype: z.string().nullable(),
  body_location: z.string().nullable(),
  laterality: z.enum(['left', 'right', 'bilateral', 'midline', 'na']),
  valence: z.enum(['positive', 'negative', 'neutral', 'mixed', 'na']),
  intensity: z.number().nullable(), // 0..1
  complexity_score: z.number().nullable(), // 0..1
  rater_1_label: EffectFamily.nullable(),
  rater_2_label: EffectFamily.nullable(), // null in real data: single coder, no second rater
  adjudicated_label: EffectFamily.nullable(),
  inter_rater_agreement: z.number().nullable(), // null in real data (not measured); synthetic only
  // multi-label extension
  additional_families: z.array(EffectFamily),
  additional_subtypes: z.array(z.string()),
  // Recorded provenance. On build 3.1-real the human stamp is not reliable for pending rows;
  // the display helper keeps that release defect visible rather than translating it to clinician.
  // nullish so the synthetic build (no field) and the human-only file (null) both parse.
  /* Who produced this label. `null` means NO source was recorded and must never be read as
     'human': defaulting an absent source to a clinician is how a model output, or a row nobody
     ever coded, acquires clinical authority it was never given. 'autocode_v1_abstained' records
     that the model saw the row and declined, which is a different fact from never having been
     processed and must survive to anyone computing coverage. */
  label_source: z.enum(['human', 'autocode_v1', 'autocode_v1_abstained']).nullish(),
  // AUDIT PROV-05: the auto-coder emits this on every row it produced and sets it true on
  // the ones it wants a human to re-check. It is served on 4,560 rows (true on 628) after
  // being declared in no schema and surfaced in no view, so those labels were displayed and
  // counted as if fully adjudicated. Declared here so it validates, is documented, and can
  // be shown. nullish because clinician rows and the synthetic build do not carry it.
  needs_human_review: z.boolean().nullish(),
})
export type EffectLabel = z.infer<typeof EffectLabelSchema>

// --- 8. qc_flags ------------------------------------------------------------

export const QcFlagSchema = z.object({
  event_id: z.string(),
  afterdischarge_flag: z.boolean(),
  seizure_related_flag: z.boolean(),
  pathological_tissue_flag: z.boolean(),
  near_seizure_onset_zone_flag: z.boolean(),
  resected_tissue_flag: z.boolean(),
  ambiguous_report_flag: z.boolean(),
  missing_parameter_flag: z.boolean(),
  stimulation_artifact_flag: z.boolean(),
  localization_uncertain_flag: z.boolean(),
  exclude_flag: z.boolean(),
  exclude_reason: z.string().nullable(),
})
export type QcFlag = z.infer<typeof QcFlagSchema>

// --- 9. atlas_labels --------------------------------------------------------

export const AtlasLabelSchema = z.object({
  site_id: z.string(),
  label_source: LabelSource,
  label_name: z.string(),
  native_or_common_space: Space,
  /* Nullable because it is now emitted as null: neither label source has a probability model,
     so the previous values (a hand-typed 0.9, and a linear ramp over an underived 50 mm scale fed
     a folded-|x| margin) were numbers that looked like confidence and measured nothing. */
  label_confidence: z.number().nullable(),
  // Optional probability supplied by the atlas itself. This is distinct from the
  // generic confidence used for a coarse assignment or a native label record.
  label_probability: z.number().nullable().default(null),
  distance_to_boundary_mm: z.number().nullable(),
})
export type AtlasLabel = z.infer<typeof AtlasLabelSchema>

// --- 10. ccep_availability --------------------------------------------------

export const CcepAvailabilitySchema = z.object({
  site_id: z.string(),
  has_ccep: z.boolean(),
  ccep_session_id: z.string().nullable(),
  exact_pair_match: z.boolean(),
  nearby_pair_match: z.boolean(),
  distance_to_nearest_ccep_site_mm: z.number().nullable(),
  processed_ccep_available: z.boolean(),
  raw_ccep_available: z.boolean(),
  ccep_qc_status: CcepQc,
  ccep_feature_reference: z.string().nullable(),
})
export type CcepAvailability = z.infer<typeof CcepAvailabilitySchema>

// --- CCEP connectivity graph (real 3.0-real only; optional — absent in the synthetic build) --
// Per-site participation + degree in the directed CCEP effective-connectivity graph.
export const CcepSiteSummarySchema = z.object({
  site_id: z.string(),
  is_ccep_stim: z.boolean(),
  is_ccep_record: z.boolean(),
  out_tested: z.number(),
  out_degree: z.number(),
  in_tested: z.number(),
  in_degree: z.number(),
})
export type CcepSiteSummary = z.infer<typeof CcepSiteSummarySchema>

// Pooled directed region×hemisphere connectivity edges (out region → in region).
export const CcepRegionConnSchema = z.object({
  out_region_id: z.string(),
  out_hemisphere: z.string(),
  in_region_id: z.string(),
  in_hemisphere: z.string(),
  n_connections_tested: z.number(),
  n_connected: z.number(),
  activation_rate: z.number().nullable(),
  n_patients: z.number(),
  median_latency_ms: z.number().nullable(),
  median_dist_mm: z.number().nullable(),
})
export type CcepRegionConn = z.infer<typeof CcepRegionConnSchema>

// --- manifest + bundle ------------------------------------------------------

export interface DatasetManifest {
  name: string
  version: string
  generated_label: string
  seed: number
  synthetic: boolean
  generator: string
  counts: Record<string, number>
  params: Record<string, unknown>
}

/** Table registry — drives the Schema Explorer + the data loader. */
export const TABLES = [
  'patients',
  'sessions',
  'electrodes',
  'sites',
  'stimulation_events',
  'reports',
  'effect_labels',
  'qc_flags',
  'atlas_labels',
  'ccep_availability',
] as const
export type TableName = (typeof TABLES)[number]

export interface AtlasBundle {
  manifest: DatasetManifest
  patients: Patient[]
  sessions: Session[]
  electrodes: Electrode[]
  sites: Site[]
  stimulation_events: StimEvent[]
  reports: Report[]
  effect_labels: EffectLabel[]
  qc_flags: QcFlag[]
  atlas_labels: AtlasLabel[]
  ccep_availability: CcepAvailability[]
  // Optional CCEP connectivity graph — present only in the real build (loaded best-effort).
  ccep_site_summary?: CcepSiteSummary[]
  ccep_region_connectivity?: CcepRegionConn[]
}

export const TABLE_SCHEMAS: Record<TableName, z.ZodTypeAny> = {
  patients: PatientSchema,
  sessions: SessionSchema,
  electrodes: ElectrodeSchema,
  sites: SiteSchema,
  stimulation_events: StimEventSchema,
  reports: ReportSchema,
  effect_labels: EffectLabelSchema,
  qc_flags: QcFlagSchema,
  atlas_labels: AtlasLabelSchema,
  ccep_availability: CcepAvailabilitySchema,
}
