/**
 * Coordinate-space contracts for anatomical assets and atlas observations.
 *
 * The renderer currently consumes ICBM152/MNI152 millimetres. MNI305 and native
 * patient coordinates are distinct frames and must never be treated as if they
 * were interchangeable just because all three are numeric triples.
 */

export type CoordinateSpace = 'native' | 'mni152' | 'mni305' | 'unknown'
export type AxisOrder = 'RAS' | 'LAS' | 'LPS' | 'unknown'
export type Handedness = 'right' | 'left' | 'unknown'

export interface CoordinateFrame {
  space: CoordinateSpace
  templateId: string | null
  axisOrder: AxisOrder
  handedness: Handedness
  units: 'mm'
  transformId?: string
}

export type Point3 = readonly [number, number, number]

/** A coordinate that may be unresolved in a release table. */
export type MaybePoint3 = Point3 | null | undefined

export type ContactResolutionSource = 'two_contact_mean' | 'single_contact' | 'missing'

export interface ContactResolution {
  point: Point3 | null
  source: ContactResolutionSource
  contactsUsed: 0 | 1 | 2
}

/**
 * Resolve a site location from the contacts that were actually found.
 *
 * A single resolved contact is retained as a single-contact location. It is
 * never presented as a two-contact midpoint, and an unresolved pair never
 * receives a synthetic coordinate.
 */
export function resolveContactPoint(points: readonly MaybePoint3[]): ContactResolution {
  if (points.length > 2) {
    throw new CoordinateSpaceError('A site coordinate may resolve at most two contacts')
  }
  const resolved = points.filter((point): point is Point3 => point != null && isFinitePoint(point))
  if (resolved.length === 0) return { point: null, source: 'missing', contactsUsed: 0 }
  if (resolved.length === 1) return { point: resolved[0], source: 'single_contact', contactsUsed: 1 }

  const point: Point3 = [
    resolved.reduce((sum, value) => sum + value[0], 0) / resolved.length,
    resolved.reduce((sum, value) => sum + value[1], 0) / resolved.length,
    resolved.reduce((sum, value) => sum + value[2], 0) / resolved.length,
  ]
  return { point, source: 'two_contact_mean', contactsUsed: 2 }
}

export type NativeCoordinateStatus = 'measured_native' | 'mni_derived' | 'missing' | 'unknown'

/** Classify whether a stored native-looking point is genuinely native. */
export function nativeCoordinateStatus(
  source: string | null | undefined,
  point: MaybePoint3,
): NativeCoordinateStatus {
  if (point == null || !isFinitePoint(point)) return 'missing'
  if (source === 'two_contact_mean' || source === 'contact_mean') return 'measured_native'
  if (source === 'contact_mean_mni' || source === 'mni_fallback') return 'mni_derived'
  return 'unknown'
}

export interface LocalizationMetrics {
  /** Measurement/localization uncertainty, in millimetres. */
  localizationUncertaintyMm: number | null
  /** Distance to a coarse assignment centroid, in millimetres. */
  centroidAssignmentDistanceMm: number | null
}

/** Keep measurement uncertainty distinct from a coarse region-assignment distance. */
export function localizationMetrics(
  localizationUncertaintyMm: number | null | undefined,
  centroidAssignmentDistanceMm: number | null | undefined,
): LocalizationMetrics {
  return {
    localizationUncertaintyMm: typeof localizationUncertaintyMm === 'number' && Number.isFinite(localizationUncertaintyMm) && localizationUncertaintyMm >= 0 ? localizationUncertaintyMm : null,
    centroidAssignmentDistanceMm: typeof centroidAssignmentDistanceMm === 'number' && Number.isFinite(centroidAssignmentDistanceMm) && centroidAssignmentDistanceMm >= 0 ? centroidAssignmentDistanceMm : null,
  }
}

export const MNI152_FRAME: CoordinateFrame = {
  space: 'mni152',
  templateId: 'ICBM152_NLin6Asym',
  axisOrder: 'RAS',
  handedness: 'right',
  units: 'mm',
}

export const MNI305_FRAME: CoordinateFrame = {
  space: 'mni305',
  templateId: 'MNI305',
  axisOrder: 'RAS',
  handedness: 'right',
  units: 'mm',
}

/** How a transform was estimated. Reported, never inferred: the choice changes the error
 *  budget by millimetres and a reviewer will ask which one we used. */
export type TransformMethod = 'affine' | 'nonlinear' | 'registration-fusion'

export interface CoordinateTransform {
  id: string
  source: CoordinateSpace
  target: CoordinateSpace
  direction: 'forward' | 'inverse'
  sourceReference: string
  /** Has a human checked this is the right transform for this data? */
  reviewed: boolean
  reviewReference: string
  sourceFrame: CoordinateFrame
  targetFrame: CoordinateFrame
  /** Exact template variants. `space: 'mni152'` is not specific enough to be safe:
   *  ICBM152_NLin6Asym (FSL, where Harvard-Oxford lives) and ICBM152_NLin2009aAsym (where
   *  Julian's parcellations live) are both "MNI152" and are NOT interchangeable. */
  sourceTemplateId?: string
  targetTemplateId?: string
  /** How it was estimated, and the numbers if affine. A transform WITHOUT a matrix is a
   *  declaration only: applyTransform throws rather than passing the input through
   *  unconverted. Declaring a transform is not implementing one. */
  method?: TransformMethod
  matrix?: readonly (readonly [number, number, number, number])[]
}

export class CoordinateSpaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinateSpaceError'
  }
}

/**
 * Can a point in `actual` be consumed where `expected` is required?
 *
 * This guard is the union of two independently-written versions and BOTH sets of conditions
 * are load-bearing, so neither may be dropped for being verbose:
 *
 *  - Full frame equality, not just `space`. Axis order and handedness differing means the
 *    numbers mean different things, and that must never pass silently.
 *  - Template VARIANT. ICBM152_NLin6Asym and ICBM152_NLin2009aAsym are both `mni152`, differ
 *    by millimetres, and host different atlases (Harvard-Oxford vs JuBrain/Glasser/Schaefer).
 *    A transform targeting one is not a licence to render into the other.
 *  - Provenance. A transform must be identified, sourced and REVIEWED before it can bridge
 *    anything. An unreviewed transform is a hypothesis, not a conversion.
 *
 * A transform that leaves a template id undeclared falls back to the space check, so older
 * transforms keep working; an explicitly declared MISMATCH is always refused.
 */
export function assertFrameCompatible(
  expected: CoordinateFrame,
  actual: CoordinateFrame,
  transform?: CoordinateTransform,
): void {
  if (framesEqual(actual, expected)) return

  const templatesLineUp =
    !!transform &&
    (transform.sourceTemplateId === undefined ||
      actual.templateId === null ||
      transform.sourceTemplateId === actual.templateId) &&
    (transform.targetTemplateId === undefined ||
      expected.templateId === null ||
      transform.targetTemplateId === expected.templateId)

  if (
    transform &&
    transform.id.trim() !== '' &&
    transform.source === actual.space &&
    transform.target === expected.space &&
    transform.direction === 'forward' &&
    transform.sourceReference.trim() !== '' &&
    transform.reviewed &&
    transform.reviewReference.trim() !== '' &&
    framesEqual(transform.sourceFrame, actual) &&
    framesEqual(transform.targetFrame, expected) &&
    templatesLineUp
  ) return

  const detail =
    transform && transform.source === actual.space && transform.target === expected.space
      ? ` Transform "${transform.id}" spans ${transform.source}->${transform.target} but is declared ${transform.sourceTemplateId ?? '?'}->${transform.targetTemplateId ?? '?'}, which does not match this pair.`
      : ''
  throw new CoordinateSpaceError(
    `Cannot render ${actual.space}/${actual.templateId ?? 'unknown'} as ${expected.space}/${expected.templateId ?? 'unknown'} without an explicit forward transform.${detail}`,
  )
}

/** Coordinate frames are directly interchangeable only when all frame metadata agrees. */
export function framesEqual(left: CoordinateFrame, right: CoordinateFrame): boolean {
  return (
    left.space === right.space &&
    left.templateId === right.templateId &&
    left.axisOrder === right.axisOrder &&
    left.handedness === right.handedness &&
    left.units === right.units
  )
}

/** Convert a declared MNI152 RAS point into the scene convention used by NiiVue. */
export function mni152ToScene(point: Point3, frame: CoordinateFrame = MNI152_FRAME): [number, number, number] {
  assertFrameCompatible(MNI152_FRAME, frame)
  return [point[0], point[2], -point[1]]
}

/** Keep the stored measurement separate from any display-space conversion. */
export function isFinitePoint(point: Point3): boolean {
  return point.every(Number.isFinite)
}

/* ---------------------------------------------------------------------------
   MNI305 -> MNI152.

   Our electrode coordinates come from iELVis `elec_recon` (the elec_loc sheets carry
   LEPTO / mgrid / SUBINF / FSAVERAGEINF / scannerNativeRAS alongside MNI). Per session the
   MNI column is an EXACT affine of the subject's own FreeSurfer coordinates — median
   residual 4.9e-14 mm from LEPTO and 6.1e-14 mm from scannerNativeRAS, i.e. machine
   precision (`scripts/probe_coordinate_space.py`). No nonlinear normalisation can produce
   that, and an exact affine out of scannerNativeRAS is the signature of FreeSurfer's
   `talairach.xfm`, whose target is MNI305 rather than MNI152.

   That is strong evidence, NOT proof, so nothing here silently rewrites a stored
   coordinate. The transform is declared so it can be applied EXPLICITLY at the point of
   use, and so both readings can be shown side by side while the provenance question is
   open. See docs/explanation/localization-remediation.md.

   Magnitude on our data: median 2.19 mm, but the mean per-axis shift (+0.30, +1.47, +1.28)
   dominates the SD (0.59, 0.50, 0.53), so it is a systematic displacement, not scatter —
   every contact crosses a given parcel boundary in the same direction.
   --------------------------------------------------------------------------- */
/**
 * The FreeSurfer-documented MNI305 -> MNI152 affine.
 *
 * KNOWN TO BE THE WEAKER METHOD, kept deliberately as the documented fallback. The
 * FreeSurfer developers themselves recommend against it on their mailing list:
 *
 *   "There are better ways to achieve this transformation than using the matrix; see Wu
 *    et al., Accurate nonlinear mapping between MNI volumetric and FreeSurfer surface
 *    coordinate system, Hum Brain Mapp. 2018 Sep; 39(9): 3793-3808."
 *
 * The preferred method is Registration Fusion (RF-ANTs). See docs/reference/coordinate-spaces.md for
 * the hierarchy, the citations, and why this one still ships.
 *
 * Target variant matters: this lands in ICBM152_NLin6Asym, which is the same variant
 * Harvard-Oxford is defined in, so the HO lookup chain is at least space-consistent. Its
 * weakness is linearity, not a wrong target.
 */
export const FREESURFER_MNI305_TO_MNI152: CoordinateTransform = {
  id: 'freesurfer-mni305-to-mni152-affine',
  source: 'mni305',
  target: 'mni152',
  sourceTemplateId: 'MNI305',
  targetTemplateId: 'ICBM152_NLin6Asym',
  direction: 'forward',
  method: 'affine',
  reviewed: true,
  reviewReference: 'scripts/verify_coordinate_provenance.py — talairach.xfm reproduces the elec_loc MNI columns for 155/222 assessable subjects at 7.5e-06 mm',
  sourceFrame: MNI305_FRAME,
  targetFrame: MNI152_FRAME,
  sourceReference:
    'FreeSurfer CoordinateSystems: MNI305 RAS -> MNI152 RAS affine. Superseded by Wu et al. 2018 (HBM 39:3793-3808); see docs/reference/coordinate-spaces.md',
  matrix: [
    [0.9975, -0.0073, 0.0176, -0.0429],
    [0.0146, 1.0009, -0.0024, 1.5496],
    [-0.0130, -0.0093, 0.9971, 1.1840],
  ],
}

/**
 * The template Julian's parcellations were computed in, per his offboarding note:
 * "Atlases are in MNI ICBM152 T1 TAL NLIN ASYM 09a brain space."
 *
 * Declared so it is NAMEABLE and therefore refusable. His JuBrain / Glasser / Brainnetome /
 * Schaefer / Tian labels are only valid for coordinates in THIS frame. They are not
 * interchangeable with our Harvard-Oxford chain, which is ICBM152_NLin6Asym. Measured
 * discrepancy between his MNI coordinates and ours is ~8.7 mm (median, 7 patients), far
 * beyond the ~2.2 mm MNI305->MNI152 affine, so this is not a rounding difference.
 *
 * No transform between 2009a and NLin6Asym is registered here on purpose: we do not have a
 * validated one, and inventing it is exactly what the standing rules forbid.
 */
/**
 * The template the app actually DISPLAYS: app/public/brain/mni152_t1.nii.gz, plus the glass
 * projections rendered from it and (same asset family) the ICBM152 cortical mesh.
 *
 * It is NOT the frame the electrodes are in. Measured, not assumed: the volume's own NIfTI
 * `descrip` reads "www.bic.mni.mcgill.ca/ServicesAtlases/ICBM152NLin2009", it is 0.7375 mm
 * isotropic at 207x256x215, and resampling it onto the templateflow references gives NCC 0.9895
 * against MNI152NLin2009cAsym with an optimal translation of exactly (0,0,0) mm, versus NCC
 * 0.7833 against MNI152NLin6Asym. It is asymmetric, so it is a *Asym build.
 *
 * Our coordinates are converted into NLin6Asym (FREESURFER_MNI305_TO_MNI152.targetTemplateId),
 * which is also Harvard-Oxford's space. So every electrode is drawn on a brain roughly 1.3 mm
 * from the space it was placed in: brain-mask Dice 0.9677, centre-of-mass offset 1.277 mm, and
 * per-electrode displacement over our 4,761 sites of mean 1.35 mm, median 1.33, p95 2.07,
 * max 2.25 (moment-matched affine between the two brain masks; an independent ANTs-based
 * estimate gives mean 1.46).
 *
 * THIS IS A DISPLAY-ONLY ERROR. No label, statistic, region assignment or exported coordinate
 * is computed against this volume — Harvard-Oxford is queried in its own NLin6Asym grid with
 * NLin6Asym coordinates. The consequence is that a bead can sit a millimetre or two off the
 * gyrus it is drawn over, not that anything downstream is wrong.
 *
 * Declared here for the same reason MNI152_2009A_FRAME is: a frame that cannot be NAMED cannot
 * be REFUSED. No transform to NLin6Asym is registered, because we have not validated one.
 */
export const ICBM152_2009C_DISPLAY_FRAME: CoordinateFrame = {
  space: 'mni152',
  templateId: 'ICBM152_NLin2009cAsym',
  axisOrder: 'RAS',
  handedness: 'right',
  units: 'mm',
}

export const MNI152_2009A_FRAME: CoordinateFrame = {
  space: 'mni152',
  templateId: 'ICBM152_NLin2009aAsym',
  axisOrder: 'RAS',
  handedness: 'right',
  units: 'mm',
}

/**
 * Which template each atlas is actually defined in. An atlas must only ever be queried with
 * coordinates in its own frame. This registry exists so that fact lives in one auditable
 * place rather than in the memory of whoever wrote each lookup.
 */
export const ATLAS_NATIVE_FRAME: Readonly<Record<string, CoordinateFrame>> = {
  'harvard-oxford-cortical': MNI152_FRAME,
  'harvard-oxford-subcortical': MNI152_FRAME,
  jubrain: MNI152_2009A_FRAME,
  glasser: MNI152_2009A_FRAME,
  brainnetome: MNI152_2009A_FRAME,
  schaefer: MNI152_2009A_FRAME,
  tian: MNI152_2009A_FRAME,
}

/**
 * The frame our stored `mni_midpoint_*` / `mni_*` columns are actually in: MNI305, the space of
 * FreeSurfer's fsaverage (whose talairach.xfm is the identity). Declaring it, not MNI152, makes
 * assertFrameCompatible fire wherever a query would mix the two frames. The evidence is in the
 * dataset descriptor; native coordinates remain the primary anatomy.
 */
export const SITE_COORDINATE_FRAME: CoordinateFrame = MNI305_FRAME

/**
 * Apply a declared affine transform.
 *
 * THROWS if the transform carries no matrix. A `CoordinateTransform` is a declaration, and
 * `assertFrameCompatible` deliberately accepts a matrix-less one because the asset registry
 * uses transforms as provenance metadata. But a declaration cannot move a point. Returning
 * the input unchanged here would mean a transform that "converts" nothing satisfies the very
 * guard whose purpose is to force a real conversion, and the caller would get MNI305
 * millimetres labelled MNI152 with no record that anything was skipped. That is the exact
 * class of bug this module exists to prevent, so it is loud.
 */
export function applyTransform(point: Point3, transform: CoordinateTransform): [number, number, number] {
  const m = transform.matrix
  if (!m) {
    throw new CoordinateSpaceError(
      `Transform "${transform.id}" (${transform.source} -> ${transform.target}) declares no matrix, so it cannot convert a coordinate. Declaring a transform is not the same as implementing one.`,
    )
  }
  const [x, y, z] = point
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
    m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
    m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
  ]
}

/**
 * Put a point into `target`, applying `transform` when one is needed and available.
 * Throws (via assertFrameCompatible) when the frames differ and no forward transform bridges
 * them, so a space mismatch is a loud failure rather than a silent 2 mm error.
 */
export function toFrame(
  point: Point3,
  from: CoordinateFrame,
  target: CoordinateFrame,
  transform?: CoordinateTransform,
): [number, number, number] {
  assertFrameCompatible(target, from, transform)
  // Compare templateId as well as space. Two frames can both be `mni152` and still be
  // different templates (ICBM152 2009 vs FSL NLin6 are not interchangeable), and deciding on
  // space alone would let a declared same-space transform satisfy the guard and then be
  // skipped, which is a second route to "guard passed, nothing converted".
  const identical = from.space === target.space && from.templateId === target.templateId
  if (identical) return [point[0], point[1], point[2]]
  if (!transform) {
    // Unreachable in practice: assertFrameCompatible above throws first. Kept so this
    // function is safe to call directly and never silently returns an unconverted point.
    throw new CoordinateSpaceError(
      `Cannot convert ${from.space}/${from.templateId ?? 'unknown'} to ${target.space}/${target.templateId ?? 'unknown'} without a transform`,
    )
  }
  return applyTransform(point, transform)
}

/**
 * The question every consumer of a stored common-space midpoint is actually asking: can this
 * point be placed in MNI152, and if so, where?
 *
 * This exists because that question used to be spelled `common_coordinate_space === 'mni152'`
 * in three independent places (sitePoint, Brain3DPage.goodGeom, Brain3DPage.regionCentroid),
 * and an exact-match test is NOT the same question. Our contacts are MNI305 — proven, not
 * assumed; see FREESURFER_MNI305_TO_MNI152.reviewReference — so the exact-match test rejects
 * every real site, the atlas draws nothing, and the data it threw away was usable the whole
 * time through a reviewed affine.
 *
 * The rule:
 *   mni152 -> already there; pass through untouched.
 *   mni305 + the reviewed transform's id -> convert with that affine. It lands in
 *             ICBM152_NLin6Asym, the same variant Harvard-Oxford and the renderer's bounding
 *             box are defined in, so the result is space-consistent with everything downstream.
 *   mni305 with NO transform_id -> REFUSE. Naming a source space is not the same as recording
 *             that a reviewed conversion was applied to produce it. A release that says
 *             "these are MNI305" but records no transform has not been through the step whose
 *             provenance we would be claiming, and this module's whole premise is that a
 *             transform must be identified and reviewed before it may bridge anything.
 *   native / unknown -> REFUSE. A coordinate whose space was never established is not rescued
 *             by guessing, and 'unknown' is exactly what a legacy artifact built before
 *             scripts/canonical_build/05_assemble.py started declaring the space still says.
 *             Assuming mni305 here because it is *probably* right is the failure mode this
 *             module exists to prevent: the fix belongs in the build, not in a client guess.
 *
 * Returns null rather than throwing. Declining to place a point is an ordinary outcome that
 * callers render as "not shown", not an exceptional one.
 */
export function commonPointInMni152(
  point: Point3,
  declaredSpace: CoordinateSpace,
  transformId?: string | null,
): [number, number, number] | null {
  if (!isFinitePoint(point)) return null
  if (declaredSpace === 'mni152') return [point[0], point[1], point[2]]
  if (declaredSpace === 'mni305' && transformId === FREESURFER_MNI305_TO_MNI152.id) {
    return applyTransform(point, FREESURFER_MNI305_TO_MNI152)
  }
  return null
}
