/** Dependency-neutral CCEP policy constants.
 *
 * Core data construction imports the tested-pair floor, so its authority cannot live in
 * connectivity.ts: that module imports the 3D renderer, which imports core data in turn.
 */
export const CCEP_MIN_TESTED = 5
