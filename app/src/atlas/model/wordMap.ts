/* Where did people say a word? A word becomes a brain map.

   The first discovery feature (precedent: Neurosynth's term maps, the part of that tool people
   cite). It is lexical on purpose: a report matches when every typed term begins a word in it, so
   "tingl" finds "tingling" and "tingly". Nothing is coded, inferred or summarised, which keeps it
   inside the 10 October brief (raw reports, no AI coding).

   What is counted follows the reading panel exactly (the same matching rule, the same pair rule):
     * stimulations only (eventGroup), never sham, 0 mA or QC-excluded events, and never a held
       person's events;
     * a stimulation counts in the areas the active pair rule gives (either contact, or both);
     * the denominator is what could have matched: stimulations WITH a transcribed report, and the
       people they came from. A stimulation with no report is not a "no".
   Sham is counted apart, over the whole release (without held people and QC-excluded trials), so the map can say how often the same word was
   said when no current was delivered. Counts only, never a rate on the map: an area stimulated in
   many people has more chances, and the hover card shows both numbers. */

import type { EventRow } from '../../lib/core/data'
import { eventGroup, textMatches } from './selection'

// the matching rule is shared with the reading panel (model/selection.ts)
export { textMatches, wordTerms } from './selection'

export interface WordCount {
  /** people with at least one stimulation here that has a transcribed report */
  people: number
  /** of them, people with at least one matching report here */
  saidPeople: number
  /** stimulations here with a transcribed report */
  reports: number
  /** of them, matching reports */
  saidReports: number
}

export interface WordMap {
  terms: string[]
  perArea: Map<string, WordCount>
  /** the release-wide stimulation and sham totals, for the side-by-side line */
  stimulation: { reports: number; saidReports: number; people: number; saidPeople: number }
  sham: { reports: number; saidReports: number; people: number; saidPeople: number }
}

export function wordMap(
  rows: readonly EventRow[],
  terms: readonly string[],
  textFor: (eventId: string) => string | null,
  areasOfSite: (siteId: string) => readonly string[],
  held: (siteId: string) => boolean,
): WordMap {
  const people = new Map<string, Set<string>>(), saidPeople = new Map<string, Set<string>>()
  const reports = new Map<string, number>(), saidReports = new Map<string, number>()
  const total = { stimulation: { reports: 0, said: 0, p: new Set<string>(), sp: new Set<string>() }, sham: { reports: 0, said: 0, p: new Set<string>(), sp: new Set<string>() } }
  for (const r of rows) {
    const g = eventGroup(r)
    if (g !== 'stimulation' && g !== 'sham') continue
    // both sides of the comparison come from the same population: a held person's events and
    // QC-excluded events are left out of the sham side too, as they are of the stimulation side
    if (held(r.site.site_id) || r.qc?.exclude_flag) continue
    const text = textFor(r.event.event_id)
    if (!text) continue
    const hit = textMatches(text, terms)
    const pid = r.event.patient_id
    const t = total[g]
    t.reports++
    t.p.add(pid)
    if (hit) { t.said++; t.sp.add(pid) }
    if (g !== 'stimulation') continue
    for (const id of areasOfSite(r.site.site_id)) {
      if (!people.has(id)) { people.set(id, new Set()); saidPeople.set(id, new Set()) }
      people.get(id)!.add(pid)
      reports.set(id, (reports.get(id) ?? 0) + 1)
      if (hit) { saidPeople.get(id)!.add(pid); saidReports.set(id, (saidReports.get(id) ?? 0) + 1) }
    }
  }
  const perArea = new Map<string, WordCount>()
  for (const [id, p] of people) perArea.set(id, { people: p.size, saidPeople: saidPeople.get(id)!.size, reports: reports.get(id) ?? 0, saidReports: saidReports.get(id) ?? 0 })
  const sum = (x: typeof total.sham) => ({ reports: x.reports, saidReports: x.said, people: x.p.size, saidPeople: x.sp.size })
  return { terms: [...terms], perArea, stimulation: sum(total.stimulation), sham: sum(total.sham) }
}
