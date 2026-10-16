import { MNI152_FRAME } from './coordinateSpace'

/* ============================================================================
   Anatomical reference table — literature-validated 2026-07-07 (0 residual errors).

   A curated table of 40 brain regions with approximate MNI centroids and
   multi-atlas labels (Desikan-Killiany, Destrieux, HCP-MMP, Schaefer, Yeo 7/17,
   Brainnetome, principal gradient, lab custom "JP"). Each region carries an
   effect-propensity profile and a base response rate so that the synthetic data
   are biologically *plausible* (e.g. calcarine → visual phosphenes, precentral →
   motor, posterior insula → interoceptive/somatosensory). This is what makes the
   biological-sanity checks in the Data Quality dashboard meaningful.

   COORDINATES are approximate region CENTROIDS. They are LEFT-hemisphere canonical
   (x < 0 for every row) and a right-hemisphere instance of the region is the mirror
   image: use `regionCentroid(region, hemisphere)`, never `region.mni` directly, for
   anything that positions or displays a region.

   The 2026-07-07 note that these sit "within ~10 mm of the empirical centroid of the
   real contacts assigned to each region" was measured on LEFT-hemisphere sites only
   and was false as a general claim. Taking `region.mni` verbatim for both sides put
   every right-hemisphere region at its left-hemisphere twin's coordinate: right
   superior temporal gyrus displayed at (-58, -22, 6), 122.1 mm from the mean position
   of its own 62 sites, and the median offset over the 80 region x hemisphere cells in
   the controlled build was 15.5 mm. Mirroring x by hemisphere takes that median to
   5.6 mm; after measuring in the correct MNI152 frame, the worst cell with at least five
   sites is middle temporal gyrus / right at 16.5 mm (n=30). See
   REGION_CENTROID_MAX_RESIDUAL_MM and
   app/scripts/anatomyCorrectness.test.ts, which re-measures this against the served
   site table on every run.

   A centroid is a LABEL FOR A GROUP, not an observed position. It is never an
   electrode, never a contact, and must never be presented as a measured coordinate
   for any site or aggregate. The Yeo-7 network assignments and the
   cross-atlas labels (DK / Destrieux / HCP-MMP / Schaefer / Brainnetome) were
   adversarially LITERATURE-VALIDATED (Yeo 2011, Glasser 2016, Fan/Brainnetome 2016,
   Destrieux 2010, Desikan-Killiany 2006) — see scripts + the technical report.
   ~80 corrections were applied over 8 adversarial passes until a full sweep returned
   0 confirmed errors. The Schaefer column is assigned DETERMINISTICALLY (nearest
   parcel centroid from the official CBIG Schaefer2018 400x17 FSLMNI152 LUT), not by
   hand. Note: a region's `schaefer`/`hcp`/etc. is the parcel AT its coordinate, which
   can differ from its canonical `yeo7` network (e.g. MT+ sits in a VisCent Schaefer
   parcel but is a DorsalAttention region) — these fields answer different questions.
   ========================================================================== */

import type { EffectFamilyId } from './ontology'

export type Yeo7 =
  | 'Visual'
  | 'Somatomotor'
  | 'DorsalAttention'
  | 'VentralAttention'
  | 'Limbic'
  | 'Frontoparietal'
  | 'Default'
  | 'Subcortical' // not a cortical Yeo network — deep gray matter (thalamus/BG/VDC)

export interface Region {
  id: string
  name: string
  jp: string // lab custom abbreviation (synthetic, "JP_label" analogue)
  lobe: string
  /**
   * LEFT-hemisphere canonical MNI centroid (x < 0). This is only half the answer: a
   * right-hemisphere instance of the region lives at the mirrored x. Read it through
   * `regionCentroid(region, hemisphere)` — using this field directly is what put every
   * right-hemisphere region on the left side of the brain.
   */
  mni: [number, number, number]
  dk: string
  destrieux: string
  hcp: string
  schaefer: string
  brainnetome: string
  yeo7: Yeo7
  yeo17: string
  /** APPROXIMATE ORDINAL rank on a unimodal(0)->transmodal(1) axis. HAND-ASSIGNED, not sampled.
   *  Unlike every other column on this type -- dk, destrieux, yeo7, yeo17, hcp, schaefer,
   *  brainnetome, all of which are published label sets this file's header validates against
   *  their sources -- these 40 values were typed in. They are NOT sampled from Margulies et al.
   *  2016 (PNAS 113:12574), which publishes the principal gradient as a VERTEX-WISE map; a
   *  region-level value derived from it would be the mean over that region's vertices, reported
   *  with its spread. Nothing here was derived that way.
   *  Treat as an ordering, never as a measurement, and do not report it to two decimals as a
   *  quantity. It is also exported as a per-site column in sites.json, so it leaves the app as
   *  data. To make it real: sample the published map onto the surface and store mean + SD. */
  gradient: number
  /** P(positive | valid stim) baseline for this region. */
  responseRate: number
  /** Bias toward depth (sEEG) vs surface (grid/strip) sampling, 0..1 = P(depth). */
  depthBias: number
  /** Weighted effect-family propensity for positive events (need not sum to 1). */
  profile: Partial<Record<EffectFamilyId, number>>
}

export const REGIONS: Region[] = [
  // ---- Visual ----
  {
    id: 'calcarine_v1', name: 'Calcarine cortex (V1)', jp: 'pV1', lobe: 'occipital',
    mni: [-10, -88, 2], dk: 'pericalcarine', destrieux: 'S_calcarine', hcp: 'V1',
    schaefer: '17Networks_LH_VisPeri_StriCal_1', brainnetome: 'MVOcC_cCunG', yeo7: 'Visual',
    yeo17: 'VisualPeripheral', gradient: 0.05, responseRate: 0.62, depthBias: 0.45,
    profile: { visual: 0.9, somatosensory: 0.03, other: 0.07 },
  },
  {
    id: 'lateral_occipital', name: 'Lateral occipital cortex', jp: 'LOC', lobe: 'occipital',
    mni: [-40, -82, 2], dk: 'lateraloccipital', destrieux: 'G_occipital_middle', hcp: 'LO1',
    schaefer: '17Networks_LH_VisCent_ExStr_6', brainnetome: 'LOcC_iOccG', yeo7: 'Visual',
    yeo17: 'VisualCentral', gradient: 0.14, responseRate: 0.5, depthBias: 0.2,
    profile: { visual: 0.85, other: 0.15 },
  },
  {
    id: 'fusiform_vtc', name: 'Fusiform / ventral temporal cortex', jp: 'FFA', lobe: 'temporal',
    mni: [-38, -50, -20], dk: 'fusiform', destrieux: 'G_oc-temp_lat-fusifor', hcp: 'FFC',
    schaefer: '17Networks_LH_DorsAttnA_TempOcc_2', brainnetome: 'FuG_A37lv', yeo7: 'Visual',
    yeo17: 'VisualPeripheral', gradient: 0.2, responseRate: 0.48, depthBias: 0.5,
    profile: { visual: 0.78, memory: 0.1, other: 0.12 },
  },
  {
    id: 'mt_v5', name: 'Area MT+/V5', jp: 'MT', lobe: 'temporal',
    mni: [-46, -68, 4], dk: 'middletemporal', destrieux: 'S_temporal_sup', hcp: 'MT',
    schaefer: '17Networks_LH_VisCent_ExStr_7', brainnetome: 'LOcC_V5/MT+', yeo7: 'DorsalAttention',
    yeo17: 'DorsAttnA', gradient: 0.22, responseRate: 0.46, depthBias: 0.25,
    profile: { visual: 0.82, vestibular: 0.06, other: 0.12 },
  },
  // ---- Somatomotor ----
  {
    id: 'precentral_m1', name: 'Precentral gyrus (M1)', jp: 'M1', lobe: 'frontal',
    mni: [-38, -22, 56], dk: 'precentral', destrieux: 'G_precentral', hcp: '4',
    schaefer: '17Networks_LH_SomMotA_5', brainnetome: 'PrG_A4ul', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorA', gradient: 0.04, responseRate: 0.74, depthBias: 0.15,
    profile: { motor: 0.78, somatosensory: 0.16, other: 0.06 },
  },
  {
    id: 'postcentral_s1', name: 'Postcentral gyrus (S1)', jp: 'S1', lobe: 'parietal',
    mni: [-42, -28, 54], dk: 'postcentral', destrieux: 'G_postcentral', hcp: '3b',
    schaefer: '17Networks_LH_SomMotA_5', brainnetome: 'PoG_A1_2_3ulhf', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorA', gradient: 0.06, responseRate: 0.72, depthBias: 0.15,
    profile: { somatosensory: 0.82, motor: 0.12, other: 0.06 },
  },
  {
    id: 'sma', name: 'Supplementary motor area', jp: 'SMA', lobe: 'frontal',
    mni: [-6, -8, 60], dk: 'superiorfrontal', destrieux: 'G_front_sup', hcp: '6mp',
    schaefer: '17Networks_LH_SomMotA_8', brainnetome: 'SFG_A6m', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorA', gradient: 0.18, responseRate: 0.58, depthBias: 0.2,
    profile: { motor: 0.55, affective: 0.12, self: 0.1, somatosensory: 0.13, other: 0.1 },
  },
  {
    id: 'paracentral', name: 'Paracentral lobule (leg M/S)', jp: 'PCL', lobe: 'frontal',
    mni: [-8, -34, 64], dk: 'paracentral', destrieux: 'G_and_S_paracentral', hcp: '4',
    schaefer: '17Networks_LH_SomMotA_15', brainnetome: 'PCL_A4ll', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorA', gradient: 0.07, responseRate: 0.62, depthBias: 0.2,
    profile: { motor: 0.5, somatosensory: 0.42, other: 0.08 },
  },
  {
    id: 'heschl_a1', name: 'Heschl gyrus (A1)', jp: 'A1', lobe: 'temporal',
    mni: [-46, -20, 6], dk: 'transversetemporal', destrieux: 'G_temp_sup-G_T_transv', hcp: 'A1',
    schaefer: '17Networks_LH_SomMotB_Aud_2', brainnetome: 'STG_A41_42', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorB', gradient: 0.12, responseRate: 0.55, depthBias: 0.35,
    profile: { auditory: 0.85, other: 0.15 },
  },
  {
    id: 'stg_mid', name: 'Superior temporal gyrus (mid)', jp: 'STG', lobe: 'temporal',
    mni: [-58, -22, 6], dk: 'superiortemporal', destrieux: 'G_temp_sup-Lateral', hcp: 'A5',
    schaefer: '17Networks_LH_SomMotB_Aud_2', brainnetome: 'STG_A22r', yeo7: 'VentralAttention',
    yeo17: 'SalVentAttnA', gradient: 0.3, responseRate: 0.5, depthBias: 0.25,
    profile: { auditory: 0.55, language: 0.3, other: 0.15 },
  },
  // ---- Language / inferior frontal & parietal ----
  {
    id: 'ifg_broca', name: 'IFG pars opercularis (Broca)', jp: 'Broca', lobe: 'frontal',
    mni: [-50, 14, 18], dk: 'parsopercularis', destrieux: 'G_front_inf-Opercular', hcp: '44',
    schaefer: '17Networks_LH_SalVentAttnA_FrOper_2', brainnetome: 'IFG_A44op', yeo7: 'VentralAttention',
    yeo17: 'SalVentAttnB', gradient: 0.55, responseRate: 0.52, depthBias: 0.2,
    profile: { language: 0.78, motor: 0.1, other: 0.12 },
  },
  {
    id: 'post_sts', name: 'Posterior STS / Wernicke', jp: 'Wern', lobe: 'temporal',
    mni: [-54, -44, 12], dk: 'bankssts', destrieux: 'S_temporal_sup', hcp: 'STSvp',
    schaefer: '17Networks_LH_TempPar_6', brainnetome: 'STG_A22c', yeo7: 'Default',
    yeo17: 'DefaultB', gradient: 0.62, responseRate: 0.48, depthBias: 0.2,
    profile: { language: 0.65, auditory: 0.15, memory: 0.1, other: 0.1 },
  },
  {
    id: 'supramarginal', name: 'Supramarginal gyrus', jp: 'SMG', lobe: 'parietal',
    mni: [-56, -40, 30], dk: 'supramarginal', destrieux: 'G_pariet_inf-Supramar', hcp: 'PF',
    schaefer: '17Networks_LH_SalVentAttnA_ParOper_2', brainnetome: 'IPL_A40rd', yeo7: 'VentralAttention',
    yeo17: 'SalVentAttnB', gradient: 0.5, responseRate: 0.46, depthBias: 0.15,
    profile: { language: 0.4, somatosensory: 0.22, self: 0.18, other: 0.2 },
  },
  {
    id: 'angular', name: 'Angular gyrus', jp: 'AG', lobe: 'parietal',
    mni: [-44, -64, 34], dk: 'inferiorparietal', destrieux: 'G_pariet_inf-Angular', hcp: 'PGi',
    schaefer: '17Networks_LH_DefaultA_IPL_1', brainnetome: 'IPL_A39rd', yeo7: 'Default',
    yeo17: 'DefaultA', gradient: 0.82, responseRate: 0.4, depthBias: 0.12,
    profile: { self: 0.32, memory: 0.26, language: 0.18, vestibular: 0.1, other: 0.14 },
  },
  // ---- Insula ----
  {
    id: 'anterior_insula', name: 'Anterior insula', jp: 'aINS', lobe: 'insula',
    mni: [-34, 18, 2], dk: 'insula', destrieux: 'G_insular_short', hcp: 'AVI',
    schaefer: '17Networks_LH_SalVentAttnA_Ins_3', brainnetome: 'INS_G', yeo7: 'VentralAttention',
    yeo17: 'SalVentAttnA', gradient: 0.48, responseRate: 0.56, depthBias: 0.85,
    profile: { interoceptive: 0.42, affective: 0.26, somatosensory: 0.12, olfactory_gustatory: 0.08, other: 0.12 },
  },
  {
    id: 'posterior_insula', name: 'Posterior insula', jp: 'pINS', lobe: 'insula',
    mni: [-38, -18, 8], dk: 'insula', destrieux: 'G_Ins_lg_and_S_cent_ins', hcp: 'PoI2',
    schaefer: '17Networks_LH_SomMotB_Ins_1', brainnetome: 'INS_dIg', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorB', gradient: 0.28, responseRate: 0.6, depthBias: 0.9,
    profile: { interoceptive: 0.4, somatosensory: 0.3, vestibular: 0.1, affective: 0.08, other: 0.12 },
  },
  // ---- Medial temporal / limbic ----
  // Yeo7 RULE (deliberate, not an oversight): allo-/archicortical limbic-system
  // structures on the medial temporal surface — hippocampus, amygdala, entorhinal,
  // parahippocampal, piriform — keep yeo7 'Limbic' (they ARE the limbic system the
  // network is named for). Only NON-limbic DEEP GRAY NUCLEI (thalamus, basal ganglia,
  // ventral diencephalon) use 'Subcortical'. Their schaefer='subcortical_*' tag just
  // reflects that the cortical Schaefer surface parcellation doesn't cover allocortex.
  {
    id: 'hippocampus', name: 'Hippocampus (anterior)', jp: 'HC', lobe: 'limbic',
    mni: [-26, -16, -20], dk: 'hippocampus', destrieux: 'subcortical', hcp: 'H',
    schaefer: 'subcortical_Hipp', brainnetome: 'Hipp_rHipp', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.7, responseRate: 0.38, depthBias: 0.98,
    profile: { memory: 0.55, affective: 0.14, self: 0.12, other: 0.19 },
  },
  {
    id: 'amygdala', name: 'Amygdala', jp: 'AMY', lobe: 'limbic',
    mni: [-24, -4, -18], dk: 'amygdala', destrieux: 'subcortical', hcp: 'subcortical',
    schaefer: 'subcortical_Amyg', brainnetome: 'Amyg_lAmyg', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.58, responseRate: 0.5, depthBias: 0.98,
    profile: { affective: 0.55, interoceptive: 0.18, memory: 0.1, olfactory_gustatory: 0.05, other: 0.12 },
  },
  // --- subcortical (aseg) structures: real depth contacts localized here were
  //     previously misassigned to the nearest CORTICAL region (piriform/insula/…),
  //     contaminating those regions. Made first-class so they are filterable and
  //     counted as a first-class structure. Granularity = whole-structure (aseg gives no nuclei).
  {
    id: 'thalamus', name: 'Thalamus', jp: 'THAL', lobe: 'subcortical',
    mni: [-10, -19, 8], dk: 'thalamus', destrieux: 'subcortical', hcp: 'Thal',
    schaefer: 'subcortical_Thal', brainnetome: 'Tha', yeo7: 'Subcortical',
    yeo17: 'Subcortical', gradient: 0.4, responseRate: 0.32, depthBias: 0.99,
    profile: { somatosensory: 0.22, motor: 0.14, affective: 0.1, memory: 0.08, other: 0.46 },
  },
  {
    id: 'basal_ganglia', name: 'Basal ganglia (striatum / pallidum)', jp: 'BG', lobe: 'subcortical',
    mni: [-22, 4, 2], dk: 'putamen', destrieux: 'subcortical', hcp: 'Put',
    schaefer: 'subcortical_Put', brainnetome: 'BG', yeo7: 'Subcortical',
    yeo17: 'Subcortical', gradient: 0.35, responseRate: 0.28, depthBias: 0.99,
    profile: { motor: 0.3, affective: 0.12, other: 0.58 },
  },
  {
    id: 'ventral_diencephalon', name: 'Ventral diencephalon', jp: 'VDC', lobe: 'subcortical',
    mni: [-10, -16, -8], dk: 'ventraldc', destrieux: 'subcortical', hcp: 'VDC',
    schaefer: 'subcortical', brainnetome: 'subcortical', yeo7: 'Subcortical',
    yeo17: 'Subcortical', gradient: 0.3, responseRate: 0.3, depthBias: 0.99,
    profile: { interoceptive: 0.3, affective: 0.12, other: 0.58 },
  },
  {
    id: 'parahippocampal', name: 'Parahippocampal gyrus', jp: 'PHG', lobe: 'limbic',
    mni: [-26, -36, -14], dk: 'parahippocampal', destrieux: 'G_oc-temp_med-Parahip', hcp: 'PHA1',
    schaefer: '17Networks_LH_DefaultC_PHC_2', brainnetome: 'PhG_A35_36c', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.66, responseRate: 0.4, depthBias: 0.92,
    profile: { memory: 0.48, visual: 0.16, self: 0.1, other: 0.26 },
  },
  {
    id: 'entorhinal', name: 'Entorhinal cortex', jp: 'EC', lobe: 'limbic',
    mni: [-22, -6, -32], dk: 'entorhinal', destrieux: 'G_oc-temp_med-Parahip', hcp: 'EC',
    schaefer: '17Networks_LH_LimbicA_TempPole_3', brainnetome: 'PhG_A28_34', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.6, responseRate: 0.36, depthBias: 0.96,
    profile: { memory: 0.4, olfactory_gustatory: 0.2, affective: 0.12, other: 0.28 },
  },
  // ---- Cingulate / medial ----
  {
    id: 'racc', name: 'Rostral anterior cingulate', jp: 'rACC', lobe: 'cingulate',
    mni: [-6, 38, 6], dk: 'rostralanteriorcingulate', destrieux: 'G_and_S_cingul-Ant', hcp: 'p24',
    schaefer: '17Networks_LH_DefaultA_PFCm_4', brainnetome: 'CG_A32p', yeo7: 'Default',
    yeo17: 'DefaultC', gradient: 0.78, responseRate: 0.42, depthBias: 0.6,
    profile: { affective: 0.4, interoceptive: 0.2, self: 0.14, other: 0.26 },
  },
  {
    id: 'dacc_mcc', name: 'Dorsal anterior / mid cingulate', jp: 'dACC', lobe: 'cingulate',
    mni: [-6, 18, 34], dk: 'caudalanteriorcingulate', destrieux: 'G_and_S_cingul-Mid-Ant', hcp: 'a24pr',
    schaefer: '17Networks_LH_SalVentAttnB_PFCmp_1', brainnetome: 'CG_A24cd', yeo7: 'VentralAttention',
    yeo17: 'SalVentAttnA', gradient: 0.45, responseRate: 0.5, depthBias: 0.6,
    profile: { affective: 0.3, motor: 0.18, interoceptive: 0.16, self: 0.16, other: 0.2 },
  },
  {
    id: 'pcc', name: 'Posterior cingulate cortex', jp: 'PCC', lobe: 'cingulate',
    mni: [-6, -50, 26], dk: 'posteriorcingulate', destrieux: 'G_cingul-Post-dorsal', hcp: '23d',
    schaefer: '17Networks_LH_DefaultA_pCunPCC_1', brainnetome: 'CG_A23d', yeo7: 'Default',
    yeo17: 'DefaultA', gradient: 0.95, responseRate: 0.34, depthBias: 0.55,
    profile: { self: 0.34, memory: 0.26, affective: 0.12, other: 0.28 },
  },
  {
    id: 'precuneus', name: 'Precuneus', jp: 'PCun', lobe: 'parietal',
    mni: [-8, -60, 40], dk: 'precuneus', destrieux: 'G_precuneus', hcp: '7m',
    schaefer: '17Networks_LH_DefaultA_pCunPCC_2', brainnetome: 'Pcun_A7m', yeo7: 'Default',
    yeo17: 'DefaultA', gradient: 0.9, responseRate: 0.36, depthBias: 0.4,
    profile: { self: 0.36, memory: 0.2, visual: 0.14, vestibular: 0.08, other: 0.22 },
  },
  // ---- Prefrontal ----
  {
    id: 'dlpfc', name: 'Dorsolateral prefrontal (MFG)', jp: 'dlPFC', lobe: 'frontal',
    mni: [-42, 30, 30], dk: 'rostralmiddlefrontal', destrieux: 'G_front_middle', hcp: '46',
    schaefer: '17Networks_LH_SalVentAttnB_PFCl_3', brainnetome: 'MFG_A46', yeo7: 'Frontoparietal',
    yeo17: 'ControlA', gradient: 0.68, responseRate: 0.26, depthBias: 0.2,
    profile: { memory: 0.34, language: 0.16, affective: 0.14, self: 0.12, other: 0.24 },
  },
  {
    id: 'ofc', name: 'Orbitofrontal cortex', jp: 'OFC', lobe: 'frontal',
    mni: [-22, 34, -16], dk: 'lateralorbitofrontal', destrieux: 'G_orbital', hcp: '11l',
    schaefer: '17Networks_LH_LimbicB_OFC_2', brainnetome: 'OrG_A11l', yeo7: 'Limbic',
    yeo17: 'LimbicB', gradient: 0.64, responseRate: 0.4, depthBias: 0.7,
    profile: { affective: 0.34, olfactory_gustatory: 0.24, interoceptive: 0.14, other: 0.28 },
  },
  {
    id: 'frontal_pole', name: 'Frontal pole', jp: 'FP', lobe: 'frontal',
    mni: [-26, 56, 6], dk: 'frontalpole', destrieux: 'G_and_S_transv_frontopol', hcp: 'a10p',
    schaefer: '17Networks_LH_ContB_PFClv_3', brainnetome: 'MFG_A10l', yeo7: 'Frontoparietal',
    yeo17: 'ControlA', gradient: 0.72, responseRate: 0.18, depthBias: 0.3,
    profile: { memory: 0.26, affective: 0.2, self: 0.18, other: 0.36 },
  },
  {
    id: 'fef', name: 'Frontal eye field', jp: 'FEF', lobe: 'frontal',
    mni: [-28, -2, 50], dk: 'caudalmiddlefrontal', destrieux: 'S_precentral-sup-part', hcp: 'FEF',
    schaefer: '17Networks_LH_DorsAttnB_FEF_2', brainnetome: 'MFG_A6vl', yeo7: 'DorsalAttention',
    yeo17: 'DorsAttnA', gradient: 0.4, responseRate: 0.48, depthBias: 0.2,
    profile: { motor: 0.34, visual: 0.24, memory: 0.14, other: 0.28 },
  },
  // ---- Parietal attention ----
  {
    id: 'spl', name: 'Superior parietal lobule', jp: 'SPL', lobe: 'parietal',
    mni: [-22, -62, 56], dk: 'superiorparietal', destrieux: 'G_parietal_sup', hcp: '7PC',
    schaefer: '17Networks_LH_DorsAttnA_SPL_7', brainnetome: 'SPL_A7r', yeo7: 'DorsalAttention',
    yeo17: 'DorsAttnB', gradient: 0.38, responseRate: 0.44, depthBias: 0.15,
    profile: { somatosensory: 0.26, self: 0.24, visual: 0.16, vestibular: 0.1, other: 0.24 },
  },
  {
    id: 'ips', name: 'Intraparietal sulcus', jp: 'IPS', lobe: 'parietal',
    mni: [-30, -56, 46], dk: 'inferiorparietal', destrieux: 'S_intrapariet_and_P_trans', hcp: 'LIPd',
    schaefer: '17Networks_LH_DorsAttnA_SPL_4', brainnetome: 'SPL_A7ip', yeo7: 'DorsalAttention',
    yeo17: 'DorsAttnB', gradient: 0.42, responseRate: 0.4, depthBias: 0.15,
    profile: { memory: 0.26, visual: 0.2, self: 0.16, somatosensory: 0.12, other: 0.26 },
  },
  {
    id: 'tpj', name: 'Temporo-parietal junction', jp: 'TPJ', lobe: 'parietal',
    mni: [-54, -52, 22], dk: 'inferiorparietal', destrieux: 'G_pariet_inf-Angular', hcp: 'TPOJ1',
    schaefer: '17Networks_LH_TempPar_6', brainnetome: 'IPL_A39rv', yeo7: 'Default',
    yeo17: 'DefaultB', gradient: 0.8, responseRate: 0.44, depthBias: 0.15,
    profile: { self: 0.4, vestibular: 0.18, language: 0.12, memory: 0.1, other: 0.2 },
  },
  // ---- Temporal ----
  {
    id: 'temporal_pole', name: 'Temporal pole', jp: 'TP', lobe: 'temporal',
    mni: [-40, 12, -34], dk: 'temporalpole', destrieux: 'Pole_temporal', hcp: 'TGd',
    schaefer: '17Networks_LH_DefaultB_Temp_1', brainnetome: 'STG_A38m', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.6, responseRate: 0.42, depthBias: 0.55,
    profile: { memory: 0.3, affective: 0.24, self: 0.12, olfactory_gustatory: 0.08, other: 0.26 },
  },
  {
    id: 'itg', name: 'Inferior temporal gyrus', jp: 'ITG', lobe: 'temporal',
    mni: [-50, -50, -18], dk: 'inferiortemporal', destrieux: 'G_temporal_inf', hcp: 'TE2p',
    schaefer: '17Networks_LH_DorsAttnA_TempOcc_3', brainnetome: 'ITG_A37elv', yeo7: 'Visual',
    yeo17: 'VisualPeripheral', gradient: 0.4, responseRate: 0.42, depthBias: 0.35,
    profile: { visual: 0.5, memory: 0.2, other: 0.3 },
  },
  {
    id: 'mtg', name: 'Middle temporal gyrus', jp: 'MTG', lobe: 'temporal',
    mni: [-58, -42, -6], dk: 'middletemporal', destrieux: 'G_temporal_middle', hcp: 'TE1p',
    schaefer: '17Networks_LH_ContB_Temp_2', brainnetome: 'MTG_A21c', yeo7: 'Default',
    yeo17: 'DefaultB', gradient: 0.72, responseRate: 0.4, depthBias: 0.3,
    profile: { language: 0.34, memory: 0.24, auditory: 0.14, other: 0.28 },
  },
  // ---- Chemosensory / vestibular specials ----
  {
    id: 'piriform', name: 'Piriform / primary olfactory', jp: 'Pir', lobe: 'limbic',
    mni: [-22, 4, -16], dk: 'entorhinal', destrieux: 'subcortical', hcp: 'Pir',
    schaefer: 'subcortical_Pir', brainnetome: 'PhG_TI', yeo7: 'Limbic',
    yeo17: 'LimbicA', gradient: 0.5, responseRate: 0.4, depthBias: 0.95,
    profile: { olfactory_gustatory: 0.62, affective: 0.14, interoceptive: 0.08, other: 0.16 },
  },
  {
    id: 'frontal_operculum', name: 'Frontal operculum (gustatory)', jp: 'FOp', lobe: 'insula',
    mni: [-44, -2, 8], dk: 'insula', destrieux: 'G_and_S_subcentral', hcp: 'FOP1',
    schaefer: '17Networks_LH_SalVentAttnA_FrOper_1', brainnetome: 'INS_vIa', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorB', gradient: 0.32, responseRate: 0.5, depthBias: 0.75,
    profile: { olfactory_gustatory: 0.4, somatosensory: 0.22, interoceptive: 0.16, other: 0.22 },
  },
  {
    id: 'pivc', name: 'Parieto-insular vestibular cortex', jp: 'PIVC', lobe: 'insula',
    mni: [-42, -24, 18], dk: 'insula', destrieux: 'G_Ins_lg_and_S_cent_ins', hcp: 'OP2-3',
    schaefer: '17Networks_LH_SomMotB_S2_5', brainnetome: 'INS_dIg', yeo7: 'Somatomotor',
    yeo17: 'SomatomotorB', gradient: 0.3, responseRate: 0.52, depthBias: 0.85,
    profile: { vestibular: 0.46, somatosensory: 0.2, interoceptive: 0.16, other: 0.18 },
  },
]

/** Explicit state for a retained site that has no coordinate or atlas assignment.
 * Keep it out of REGIONS so it cannot enter synthetic sampling or region totals. */
export const UNASSIGNED_REGION: Region = {
  id: 'unassigned', name: 'Unassigned', jp: 'NA', lobe: 'unknown',
  mni: [0, 0, 0], dk: '', destrieux: '', hcp: '', schaefer: '', brainnetome: '',
  yeo7: 'Subcortical', yeo17: 'unknown', gradient: 0, responseRate: 0, depthBias: 0, profile: {},
}

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(
  [...REGIONS, UNASSIGNED_REGION].map((r) => [r.id, r]),
)

export type Hemisphere = 'L' | 'R'

/** Exact frame of every coordinate in the curated REGIONS centroid table. */
export const REGION_CENTROID_FRAME = MNI152_FRAME

/**
 * Largest tolerated distance, in mm, between a region's hemisphere-appropriate centroid
 * and the mean position of the sites assigned to that region in that hemisphere, over
 * cells holding at least MIN_SITES_FOR_RESIDUAL sites.
 *
 * Measured, not assumed: in the correct MNI152 frame the served controlled build's worst
 * such cell is middle temporal gyrus / right at 16.5 mm over 30 sites. Median over all
 * 80 cells is 5.6 mm. The bound is set just above
 * the observed worst case so that a real regression — a sign flip, a transposed axis, a
 * mis-typed centroid — fails the test, while ordinary sampling spread does not.
 *
 * Cells with fewer than MIN_SITES_FOR_RESIDUAL sites are excluded because their "mean
 * position" is one or two contacts and says nothing about the centroid: the single
 * left ventral-diencephalon site sits 29.9 mm from the VDC centroid, which is a fact
 * about that contact, not an error in the table.
 */
// Recalibrated 2026-08-09 from 16 to 18. NOT to make a failing test pass: the residual gate was
// measuring site means in MNI305 against centroids in MNI152, so its worst observed case — the
// number this limit is defined as sitting just above — was measured across a frame mismatch. In
// the correct frame the worst cell with >=5 sites is middle temporal gyrus / right at 16.5 mm
// (n=30). 18 keeps the ~2 mm headroom the old value had over its own worst case, and remains far
// below the ~122 mm a dropped hemisphere mirroring produces, which is what the gate exists to catch.
export const REGION_CENTROID_MAX_RESIDUAL_MM = 18
export const MIN_SITES_FOR_RESIDUAL = 5

/**
 * The MNI centroid to use for `region` in `hemisphere`.
 *
 * Every row of REGIONS stores the LEFT-hemisphere centroid. Each of these regions is a
 * bilaterally paired structure — including the paramedian ones (SMA, cingulate,
 * precuneus, paracentral lobule, calcarine, thalamus, ventral DC), which have a genuine
 * instance on each side and whose right-hemisphere sites do average to positive x in
 * the served build. There is no unpaired midline structure in the table (no brainstem,
 * no corpus callosum), so mirroring x is defensible for all 40 rows and is applied
 * uniformly. UNASSIGNED_REGION has no location and is returned unchanged.
 *
 * The sign is derived with Math.abs rather than negation so that a future sign typo in
 * the table cannot silently place a region on the wrong side.
 *
 * This is a LABELLED CENTROID for a group of sites. It is not an observed position and
 * must not be rendered, exported, or described as the coordinate of any contact, site,
 * or aggregate selection.
 */
export function regionCentroid(region: Region | string, hemisphere: Hemisphere): [number, number, number] {
  const r = typeof region === 'string' ? REGION_BY_ID[region] : region
  if (!r || r.id === UNASSIGNED_REGION.id) return [...UNASSIGNED_REGION.mni]
  const [x, y, z] = r.mni
  return [hemisphere === 'R' ? Math.abs(x) : -Math.abs(x), y, z]
}

export const YEO7_NETWORKS: Yeo7[] = [
  'Visual',
  'Somatomotor',
  'DorsalAttention',
  'VentralAttention',
  'Limbic',
  'Frontoparietal',
  'Default',
]

export const YEO7_COLOR: Record<Yeo7, string> = {
  Visual: '#7b3fa0',
  Somatomotor: '#4f8fc0',
  DorsalAttention: '#2f9e44',
  VentralAttention: '#c2456e',
  Limbic: '#d9b34a',
  Frontoparietal: '#d9730d',
  Default: '#b54848',
  Subcortical: '#7d6ca8',
}
