/* What a set of selected areas contains: the stimulations, the people, and their words.

   Three rules from AGENTS.md hold here by construction, because v2 is a new surface and every
   new surface has re-introduced at least one of them:
     * SHAM IS NEVER IN THE STIMULATION LIST OR ITS COUNTS. It is returned separately, always.
       (isShamRow is the single definition; it has been forgotten in 15 places before.)
     * A STIMULATION IS COUNTED ONCE. A site lists every parcel one of its two contacts lies in,
       so a pair straddling two selected parcels would otherwise be counted twice.
     * A TOTAL NAMES ITS POPULATION. Counts are of stimulations, sites and patients WITH
       STIMULATIONS IN THE SELECTION -- never "patients" bare.
   Two more groups are kept out of the stimulation count, because the record itself says they
   cannot be read as "current was delivered here":
     * RECORDED AT 0 mA. 355 events in the release are labelled iES with a current of 0 mA
       (invariants.py: "no event at 0 mA is served as iES", failing). Whether current was delivered
       is unknown, so they are listed apart, like sham, and never counted.
     * EXCLUDED BY THE RELEASE'S OWN QC (exclude_flag). They are in the download of everything with their reason, and in no area.
   The only code read here is the clinician's own bedside entry (bedsideNote, below). No effect
   family, and nothing the autocoder wrote, reaches v2. */

import type { EventRow } from '../../lib/core/data'
import { isShamRow } from '../../lib/core/query'
import { cortexId, deepId, type AtlasId, type ContactParcels, type SiteParcelRecord } from './parcels'

export type EventGroup = 'stimulation' | 'sham' | 'zero_current' | 'excluded'

/** The one place an event's group is decided. Sham first: a sham trial is sham whatever else. */
export function eventGroup(row: EventRow): EventGroup {
  if (isShamRow(row)) return 'sham'
  if (row.qc?.exclude_flag) return 'excluded'
  if (row.event.current_mA === 0) return 'zero_current'
  return 'stimulation'
}

/* WHAT THE CLINICIAN WROTE AT THE BEDSIDE: an effect, "none", or nothing.

   The source sheet has a category cell for every stimulation. A clinician who saw an effect wrote
   a category, one who saw none wrote "none", and otherwise the cell stayed blank
   (05_assemble.py:131-132). That is the bedside record, not a coding pass, so v2 shows it, but
   only as those three states, never the category. Two things it must never do:
     * SHOW THE AUTOCODER'S READING. The served effect_presence fills 4,560 blank cells with
       autocode_v1's guess (on stimulations: 1,489 to "positive", 2,470 to "null"). Only rows with
       label_source 'human' carry the clinician's entry; every other row was blank at the bedside.
       Measured 10 Oct: this rule reproduces effect_labels.human.json on 11,505 of 11,505 events,
       and scripts/invariants.py re-checks it on every complete real build (its own Python copy of
       the rule; atlas.test.ts tests the TypeScript rule on constructed rows).
     * BE READ AS A RATE. Writing "none" was the habit through 2022 (80-100% of null trials) and had
       stopped by 2024 (0%); 35 of 146 people have "none" on at most a fifth of their non-effect
       stimulations. A blank is not a "none", so effect / (effect + none) would partly measure
       which year an area happened to be stimulated in. */
export type BedsideNote = 'effect' | 'none' | 'blank'

export function bedsideNote(row: EventRow, synthetic: boolean): BedsideNote {
  const e = row.effect
  // the synthetic build declares no label source; every row of a real release does
  const clinician = e?.label_source === 'human' || (synthetic && e?.label_source == null)
  if (!clinician) return 'blank'
  return e.effect_presence === 'positive' ? 'effect' : e.effect_presence === 'null' ? 'none' : 'blank'
}

export function countNotes(rows: readonly SelectedRow[], synthetic: boolean): Record<BedsideNote, number> {
  const c = { effect: 0, none: 0, blank: 0 }
  for (const r of rows) c[bedsideNote(r.row, synthetic)]++
  return c
}

/* WHICH CONTACTS A STIMULATION PASSED CURRENT THROUGH, and the rules built on them. Pure functions,
   so the panel, the hover card, the map and the tests run the same code (validation of 16 Oct,
   M21: these were closures inside App.tsx, and the test carried its own copy of the strict rule,
   which disagreed with the app's on 102 synthetic sites once a deep structure was selected). */

/** Both contacts of a bipolar pair, or the one contact of a monopolar site (the single
    contact is the site by design).
    null when the set is incomplete: a bipolar pair with a contact unidentified has no
    stimulating set to judge, so it never passes the strict rule. */
export function stimulatingSet(rec: SiteParcelRecord | undefined, montage: string | null | undefined): readonly string[] | null {
  if (!rec) return null
  if (rec.c.length === 2) return rec.c
  if (rec.c.length === 1 && montage === 'monopolar') return rec.c
  return null
}

/** The contact lies in one of `ids` (cortical areas of `atlas`, or deep structures). */
export function contactIn(c: ContactParcels | undefined, atlas: AtlasId, ids: ReadonlySet<string>): boolean {
  if (!c) return false
  const k = c[atlas]
  return (!!k && ids.has(cortexId(k))) || (!!c.deep && ids.has(deepId(c.deep)))
}

/** The strict pair rule (Duong 2023, Lyu 2025): every contact current passed through lies in one of
    `ids`. A monopolar site's one contact is its whole stimulating set (the user's ruling, 17 Oct). */
export function allContactsInside(
  rec: SiteParcelRecord | undefined, montage: string | null | undefined,
  contacts: Readonly<Record<string, ContactParcels>>, atlas: AtlasId, ids: ReadonlySet<string>,
): boolean {
  const set = stimulatingSet(rec, montage)
  return !!set && set.every((cid) => contactIn(contacts[cid], atlas, ids))
}

/** A stimulation is in a PART of an area (a finer atlas's area inside it) when one of its contacts
    carries the part's label AND lies in the area itself, so a part holds exactly the stimulations
    of the patch drawn for it. Either-contact membership credited a pair through a contact in the
    neighbouring area (H3). */
export function inPart(
  rec: SiteParcelRecord | undefined, contacts: Readonly<Record<string, ContactParcels>>,
  area: { atlas: AtlasId; key: string }, part: { atlas: AtlasId; key: string },
): boolean {
  return (rec?.c ?? []).some((cid) => {
    const c = contacts[cid]
    return !!c && c[area.atlas] === area.key && c[part.atlas] === part.key
  })
}

export interface SelectedRow {
  row: EventRow
  /** which of the selected areas this stimulation's site lies in (one, or two for a straddling pair) */
  areas: string[]
  text: string | null
  /** every contact of the stimulating set identified and inside the selected areas (the strict rule) */
  both?: boolean
  /** under the strict rule: the selected areas whose own strict rule the site meets, judged area by
      area as the hover card and the map judge them */
  inside?: string[]
}

export interface SelectOptions {
  /** is every contact of this site's stimulating set inside the selected areas? */
  bothInside?: (siteId: string) => boolean
  /** the same, for one area alone: the per-area numbers under the strict rule */
  insideArea?: (siteId: string, areaId: string) => boolean
  /** count only pairs with both contacts inside (Duong 2023, Lyu 2025); default: either contact */
  strict?: boolean
}

export interface AreaBreakdown {
  id: string
  stimulations: number
  sites: number
  patients: number
}

export interface SelectionResult {
  stimulations: SelectedRow[]
  /** labelled iES but recorded at 0 mA: listed apart, never counted */
  zeroCurrent: SelectedRow[]
  sham: SelectedRow[]
  counts: {
    stimulations: number
    withReport: number
    sites: number
    patients: number
    sham: number
    shamWithReport: number
    zeroCurrent: number
    /** events at these sites that the release's own QC excludes: in no list here */
    excluded: number
    /** stimulations whose pair has both contacts inside the selected areas */
    bothInside: number
  }
  perArea: AreaBreakdown[]
}

export function selectRows(
  selected: readonly string[],
  sitesByArea: ReadonlyMap<string, readonly string[]>,
  eventsBySite: ReadonlyMap<string, readonly EventRow[]>,
  textByEvent: (eventId: string) => string | null,
  opts: SelectOptions = {},
): SelectionResult {
  const areasBySite = new Map<string, string[]>()
  for (const id of selected) {
    for (const s of sitesByArea.get(id) ?? []) {
      const a = areasBySite.get(s)
      if (a) {
        if (!a.includes(id)) a.push(id)
      } else areasBySite.set(s, [id])
    }
  }
  const stim: SelectedRow[] = []
  const sham: SelectedRow[] = []
  const zero: SelectedRow[] = []
  let excluded = 0
  const seen = new Set<string>()
  for (const [site, areas] of areasBySite) {
    const both = opts.bothInside ? opts.bothInside(site) : undefined
    if (opts.strict && !both) continue
    const inside = opts.strict ? areas.filter((a) => (opts.insideArea ? opts.insideArea(site, a) : true)) : undefined
    for (const row of eventsBySite.get(site) ?? []) {
      const eid = row.event.event_id
      if (seen.has(eid)) continue
      seen.add(eid)
      const g = eventGroup(row)
      if (g === 'excluded' || (g === 'sham' && row.qc?.exclude_flag)) { excluded++; continue }
      const item: SelectedRow = { row, areas, text: textByEvent(eid), both, inside }
      ;(g === 'sham' ? sham : g === 'zero_current' ? zero : stim).push(item)
    }
  }
  const order = new Map(selected.map((id, i) => [id, i]))
  const firstArea = (r: SelectedRow) => Math.min(...r.areas.map((a) => order.get(a) ?? 1e9))
  const byReading = (a: SelectedRow, b: SelectedRow) =>
    firstArea(a) - firstArea(b) ||
    a.row.event.patient_id.localeCompare(b.row.event.patient_id) ||
    a.row.site.site_id.localeCompare(b.row.site.site_id) ||
    (a.row.event.current_mA ?? 0) - (b.row.event.current_mA ?? 0) ||
    a.row.event.event_id.localeCompare(b.row.event.event_id)
  stim.sort(byReading)
  sham.sort(byReading)
  zero.sort(byReading)

  const perArea = breakdown(stim, selected)
  return {
    stimulations: stim,
    zeroCurrent: zero,
    sham,
    counts: {
      stimulations: stim.length,
      withReport: stim.filter((r) => r.text).length,
      sites: new Set(stim.map((r) => r.row.site.site_id)).size,
      patients: new Set(stim.map((r) => r.row.event.patient_id)).size,
      sham: sham.length,
      shamWithReport: sham.filter((r) => r.text).length,
      zeroCurrent: zero.length,
      excluded,
      bothInside: stim.filter((r) => r.both).length,
    },
    perArea,
  }
}

/** the typed query as lower-case word-start terms; at most 4 terms of letters, apostrophes, hyphens */
export function wordTerms(q: string): string[] {
  return q.toLowerCase().split(/[^a-z'-]+/).map((t) => t.replace(/^['-]+|['-]+$/g, '')).filter((t) => t.length >= 2).slice(0, 4)
}

/** every term begins a word of the text */
export function textMatches(text: string | null, terms: readonly string[]): boolean {
  if (!text || !terms.length) return false
  const words = text.toLowerCase().split(/[^a-z'-]+/)
  return terms.every((t) => words.some((w) => w.startsWith(t)))
}

/** The panel's report filter. The same rule as the word map (every term begins a word of the
    report), so a word that colours an area on the map always lists the same reports in its panel
    (they disagreed: "word gone" coloured an area whose panel listed nothing). A query with no
    term of two letters or more falls back to a plain substring. A string match, not a model. */
export function matchesQuery(text: string | null, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const terms = wordTerms(needle)
  return terms.length ? textMatches(text, terms) : (text ?? '').toLowerCase().includes(needle)
}

/** "Person 123" from "sub-123" (or a synthetic "SYNTH_PATIENT_002"): plain words on screen; the
    id itself stays in "See more" and in the download. */
export function patientLabel(patientId: string): string {
  const m = /(?:^sub-|^SYNTH_PATIENT_)0*(\d+)$/.exec(patientId)
  return m ? `Person ${m[1]}` : patientId
}

/** Per selected area: the stimulations in it. Under the strict rule an area counts a stimulation
    only when the pair meets that area's own rule (`inside`), as the hover card and the map count
    it; a pair with one contact in each of two selected areas is then in the selection's total but
    in neither row (M6). */
function breakdown(stim: readonly SelectedRow[], ids: readonly string[]): AreaBreakdown[] {
  return ids.map((id) => {
    const rows = stim.filter((r) => r.areas.includes(id) && (!r.inside || r.inside.includes(id)))
    return {
      id,
      stimulations: rows.length,
      sites: new Set(rows.map((r) => r.row.site.site_id)).size,
      patients: new Set(rows.map((r) => r.row.event.patient_id)).size,
    }
  })
}

/** The same selection, narrowed (to one part of the area, or one person). Every count, the per-area
    rows included, is recomputed on what is kept, so the panel never shows a number for rows it is
    not listing (M2: perArea used to pass through unchanged). */
export function narrowResult(r: SelectionResult, keep: (row: SelectedRow) => boolean): SelectionResult {
  const stimulations = r.stimulations.filter(keep)
  const sham = r.sham.filter(keep)
  const zeroCurrent = r.zeroCurrent.filter(keep)
  return {
    stimulations, sham, zeroCurrent,
    counts: {
      stimulations: stimulations.length,
      withReport: stimulations.filter((x) => x.text).length,
      sites: new Set(stimulations.map((x) => x.row.site.site_id)).size,
      patients: new Set(stimulations.map((x) => x.row.event.patient_id)).size,
      sham: sham.length,
      shamWithReport: sham.filter((x) => x.text).length,
      zeroCurrent: zeroCurrent.length,
      excluded: 0,
      bothInside: stimulations.filter((x) => x.both).length,
    },
    perArea: breakdown(stimulations, r.perArea.map((a) => a.id)),
  }
}
