/* ============================================================================
   Query / filter engine. Operates over the denormalized EventRow[]. Empty array
   filters mean "no constraint". Returns a new filtered array (pure).
   ========================================================================== */

import type { EventRow } from './data'
import { siteNetwork } from './data'
import type { EffectFamilyId, EffectMode, HierarchyLevel } from '../space/ontology'
import { effectAxes } from '../space/ontology'
import type { Yeo7 } from '../space/anatomy'

export type Presence = 'positive' | 'null' | 'uncertain' | 'not_assessable' | 'excluded'
export type ElectrodeType = 'ECoG_grid' | 'strip' | 'sEEG_depth' | 'other'
export type Protocol = 'iES' | 'sham' | 'other'
export type ProtocolSource = 'declared_stim' | 'assumed_stim' | 'declared_sham' | 'assumed_sham' | 'unmatched' | 'unrecognised_flag' | 'not_recorded'
export type SpaceView = 'native' | 'common'

export interface Filters {
  patientIds: string[]
  regionIds: string[]
  networks: Yeo7[]
  families: EffectFamilyId[]
  subtypes: string[]
  modes: EffectMode[]
  levels: HierarchyLevel[]
  presence: Presence[]
  hemisphere: ('L' | 'R')[]
  electrodeTypes: ElectrodeType[]
  protocols: Protocol[]
  protocolSources: ProtocolSource[]
  taskContexts: string[]
  currentRange: [number, number] | null
  frequencyRange: [number, number] | null
  // QC toggles
  noAfterdischarge: boolean
  noSeizure: boolean
  notPathological: boolean
  notNearSoz: boolean
  excludeExcluded: boolean
  analysisSetOnly: boolean // composite: clean QC, assessable
  // Aim-3 / availability
  ccepAvailable: boolean | null
  tractographyAvailable: boolean | null
  rsfmriAvailable: boolean | null
  search: string
}

export function defaultFilters(): Filters {
  return {
    patientIds: [], regionIds: [], networks: [], families: [], subtypes: [], modes: [], levels: [],
    presence: [], hemisphere: [], electrodeTypes: [], protocols: [], protocolSources: [], taskContexts: [],
    currentRange: null, frequencyRange: null,
    noAfterdischarge: false, noSeizure: false, notPathological: false, notNearSoz: false,
    excludeExcluded: false, analysisSetOnly: false,
    ccepAvailable: null, tractographyAvailable: null, rsfmriAvailable: null,
    search: '',
  }
}

export function countActive(f: Filters): number {
  let n = 0
  n += f.patientIds.length ? 1 : 0
  n += f.regionIds.length ? 1 : 0
  n += f.networks.length ? 1 : 0
  n += f.families.length ? 1 : 0
  n += f.subtypes.length ? 1 : 0
  n += f.modes.length ? 1 : 0
  n += f.levels.length ? 1 : 0
  n += f.presence.length ? 1 : 0
  n += f.hemisphere.length ? 1 : 0
  n += f.electrodeTypes.length ? 1 : 0
  n += f.protocols.length ? 1 : 0
  n += f.protocolSources.length ? 1 : 0
  n += f.taskContexts.length ? 1 : 0
  n += f.currentRange ? 1 : 0
  n += f.frequencyRange ? 1 : 0
  n += f.noAfterdischarge ? 1 : 0
  n += f.noSeizure ? 1 : 0
  n += f.notPathological ? 1 : 0
  n += f.notNearSoz ? 1 : 0
  n += f.excludeExcluded ? 1 : 0
  n += f.analysisSetOnly ? 1 : 0
  n += f.ccepAvailable !== null ? 1 : 0
  n += f.tractographyAvailable !== null ? 1 : 0
  n += f.rsfmriAvailable !== null ? 1 : 0
  n += f.search.trim() ? 1 : 0
  return n
}

const inSet = (arr: string[], v: string) => arr.length === 0 || arr.includes(v)

/* ============================================================================
   THE ANALYSIS-SET / DENOMINATOR RULE — one definition, used by every
   research-facing rate (aggregations.ts, effectMap.ts). Anything that computes a
   rate without going through these predicates is a defect, not a variant.
   ========================================================================== */

/**
 * Sham — the negative control, where the stimulator delivers nothing.
 *
 * Sham events are real data and stay fully browsable, filterable and exportable; they are
 * simply not stimulations, so they can never sit in a stimulation denominator. Pooling them
 * answers a different question than the one the atlas asks ("stimulate here — do you get an
 * experience?") and biases every rate toward the control, which by construction is positive
 * far less often. The arms are counted separately and reported separately.
 *
 * `event` is always present on a joined EventRow (buildDb drops rows that fail to join); the
 * optional read only tolerates hand-built fixtures. An UNKNOWN protocol is treated as
 * stimulation, because sham has to be positively identified before it is set aside.
 */
export function isShamRow(r: EventRow): boolean {
  return r.event?.stimulation_protocol === 'sham'
}

/**
 * A positive response ON THE STIMULATION ARM — the only rows that may contribute to a claim that
 * stimulating somewhere evoked something.
 *
 * This exists because the sham split was applied to the RESPONSE axis (positive/silent) and not to
 * the EFFECT-FAMILY axis, and the gap was invisible: four separate functions across four files each
 * wrote `if (r.effect.effect_presence !== 'positive') continue` and each independently forgot the
 * protocol check. Seven sites where no current was ever delivered were painted as somatosensory,
 * vestibular, visual or sensory_unspecified responders on the flagship 3D view, and Entorhinal
 * cortex (R) was coloured somatosensory when its stimulation arm's dominant family is epileptic —
 * flipped by exactly two positive sham rows.
 *
 * Any code deciding "what did stimulation evoke here" must go through this, not through a bare
 * presence check. A rule that has to be remembered in four places is a rule that will be forgotten
 * in a fifth.
 */
export function isEvokedPositive(r: EventRow): boolean {
  return r.effect?.effect_presence === 'positive' && !isShamRow(r)
}

/**
 * Outcomes that may enter a positive-versus-null denominator.
 *
 * `uncertain` may NOT. A response nobody could score is not evidence of absence, so counting
 * it as a null inflates the denominator and deflates every rate. Uncertain rows stay visible
 * in the analysis set — they are data, and their count is worth reporting — they just never
 * sit on the bottom of a fraction.
 */
export function isAssessableOutcome(p: Presence): boolean {
  return p === 'positive' || p === 'null'
}

/** The full elicitation-denominator rule: a real stimulation with a scoreable outcome. */
export function isElicitationDenominatorRow(r: EventRow): boolean {
  return !isShamRow(r) && isAssessableOutcome(r.effect.effect_presence)
}

/**
 * Keep a widened analysis population inside the sites selected by a narrower result set.
 *
 * Outcome filters (family, subtype, hierarchy/mode, presence, and free-text effect search) may
 * select only positive events. A rate must remove those filters to recover its null side, but it
 * must not silently release the spatial/site selection along with them. This helper makes that
 * second constraint explicit and shared by every UI that widens an outcome denominator.
 */
export function retainRowsAtSelectedSites(widenedRows: EventRow[], selectedRows: EventRow[]): EventRow[] {
  const selectedSiteIds = new Set(selectedRows.map((r) => r.site.site_id))
  return widenedRows.filter((r) => selectedSiteIds.has(r.site.site_id))
}

/** A clean "analysis set" — the composite QC preset. Sham is outside it by construction. */
export function isAnalysisRow(r: EventRow): boolean {
  return (
    !isShamRow(r) &&
    !r.qc.exclude_flag &&
    !r.qc.afterdischarge_flag &&
    !r.qc.seizure_related_flag &&
    !r.qc.stimulation_artifact_flag &&
    !r.qc.localization_uncertain_flag &&
    r.effect.effect_presence !== 'not_assessable'
  )
}

/**
 * Which active filters cannot be applied because the table they read was never shipped.
 *
 * An absent table is not a column of `false`. The served controlled release ships no
 * `ccep_availability.json`, so `ccepBySite` is empty and the old `?? false` made every event read
 * as "no CCEP": filtering to yes returned 0 rows, to no returned everything,
 * and `region_summary.csv` reported `ccep_graph_sites=0` for all 40 regions. All three look like
 * findings and are actually a missing file.
 *
 * Callers should surface these and disable the corresponding control, rather than presenting a
 * filter that silently matches nothing.
 */
export function inapplicableFilters(f: Filters, unavailableTables: readonly string[] = []): string[] {
  const out: string[] = []
  if (f.ccepAvailable !== null && unavailableTables.includes('ccep_availability')) out.push('ccepAvailable')
  return out
}

export function filterRows(
  rows: EventRow[],
  f: Filters,
  ccepBySite: Map<string, { has_ccep: boolean; exact_pair_match: boolean }>,
  unavailableTables: readonly string[] = [],
): EventRow[] {
  const inapplicable = new Set(inapplicableFilters(f, unavailableTables))
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (!inSet(f.patientIds, r.patient.patient_id)) return false
    if (!inSet(f.regionIds, r.site.region_id)) return false
    // Filter on the site's own native Yeo-7. Filtering on region.yeo7 meant "Network = Visual"
    // selected by centroid grouping, not by where the electrode actually was.
    const net = siteNetwork(r.site)
    // A site with no native network is not a member of any network, so it fails every
    // network filter rather than being matched by a fallback.
    if (f.networks.length && (!net || !f.networks.includes(net))) return false
    if (f.families.length) {
      const fams = [r.effect.primary_effect_family, ...r.effect.additional_families]
      if (!fams.some((x) => f.families.includes(x))) return false
    }
    if (f.subtypes.length) {
      const subs = [r.effect.effect_subtype, ...r.effect.additional_subtypes].filter(Boolean) as string[]
      if (!subs.some((x) => f.subtypes.includes(x))) return false
    }
    if (f.modes.length || f.levels.length) {
      const ax = effectAxes(r.effect.primary_effect_family, r.effect.effect_subtype)
      if (f.modes.length && !f.modes.includes(ax.mode)) return false
      if (f.levels.length && !f.levels.includes(ax.level)) return false
    }
    if (f.presence.length && !f.presence.includes(r.effect.effect_presence)) return false
    if (!inSet(f.hemisphere, r.site.hemisphere)) return false
    if (!inSet(f.electrodeTypes, r.site.electrode_type)) return false
    if (!inSet(f.protocols, r.event.stimulation_protocol)) return false
    if (!inSet(f.protocolSources, r.event.protocol_source ?? 'not_recorded')) return false
    if (!inSet(f.taskContexts, r.event.task_context)) return false

    // When a parameter band is set, rows whose value is unknown (null) are EXCLUDED —
    // otherwise the majority (null-frequency/current) rows silently pass and the band
    // never actually narrows the set.
    if (f.currentRange) {
      if (r.event.current_mA === null || r.event.current_mA < f.currentRange[0] || r.event.current_mA > f.currentRange[1]) return false
    }
    if (f.frequencyRange) {
      if (r.event.frequency_hz === null || r.event.frequency_hz < f.frequencyRange[0] || r.event.frequency_hz > f.frequencyRange[1]) return false
    }

    if (f.noAfterdischarge && r.qc.afterdischarge_flag) return false
    if (f.noSeizure && r.qc.seizure_related_flag) return false
    if (f.notPathological && r.qc.pathological_tissue_flag) return false
    if (f.notNearSoz && r.qc.near_seizure_onset_zone_flag) return false
    if (f.excludeExcluded && r.effect.effect_presence === 'excluded') return false
    if (f.analysisSetOnly && !isAnalysisRow(r)) return false

    /* Skipped entirely when the table is absent — see inapplicableFilters. Filtering on a
       resource we did not ship would answer a question the data cannot answer, and answer it
       confidently. The caller is responsible for telling the user the control is unavailable;
       silently returning every row would be its own lie, which is why this pairs with the
       inapplicable list rather than standing alone. */
    if (f.ccepAvailable !== null && !inapplicable.has('ccepAvailable')) {
      // "CCEP connectivity" = graph membership (exact_pair_match, 1642 sites), not raw has_ccep (2887, overstates).
      const has = ccepBySite.get(r.site.site_id)?.exact_pair_match ?? false
      if (has !== f.ccepAvailable) return false
    }
    if (f.tractographyAvailable !== null && r.patient.tractography_available !== f.tractographyAvailable) return false
    if (f.rsfmriAvailable !== null && r.patient.rsfmri_available !== f.rsfmriAvailable) return false

    if (q) {
      const hay = `${r.event.event_id} ${r.site.site_id} ${r.site.electrode_pair} ${r.patient.patient_id} ${r.region.name} ${r.region.jp} ${r.effect.primary_effect_family} ${r.effect.effect_subtype ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Compute slider bounds from the data. */
export function filterBounds(rows: EventRow[]) {
  let curMax = 1, freqMax = 1
  for (const r of rows) {
    if (r.event.current_mA && r.event.current_mA > curMax) curMax = r.event.current_mA
    if (r.event.frequency_hz && r.event.frequency_hz > freqMax) freqMax = r.event.frequency_hz
  }
  return { currentMax: Math.ceil(curMax), frequencyMax: Math.ceil(freqMax) }
}
