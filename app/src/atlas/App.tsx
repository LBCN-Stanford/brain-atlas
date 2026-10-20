/* The atlas: a plain brain, published atlases, and what people said.

   Data flow: DbProvider (v1's loader -- same joins, same integrity rules) -> site_parcels.json
   (scripts/v2/build_site_parcels.py) -> selectRows (sham apart, one count per stimulation) ->
   the reading panel. The brain draws scripts/v2/build_brain_assets.py's fsaverage assets. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, Info, List } from 'lucide-react'
import { useAtlasDb } from './data'
import type { EventRow } from '../lib/core/data'
import { loadAtlas, loadBrain, loadInflated, type AtlasAssets, type BrainAssets, type Hemi } from './brain/assets'
import type { CoverageColors, Dot, SelectedArea, Subregions } from './brain/engine'
import { BrainCanvas, type BrainCanvasHandle } from './ui/BrainCanvas'
import { SearchBox } from './ui/SearchBox'
import { ReadingPanel, type AreaView } from './ui/ReadingPanel'
import { AboutSheet, AreaListSheet, ATLAS_CARDS, AtlasPicker, CiteSheet, CoverageLegend, DownloadMenu, MIN_PEOPLE, NoticesSheet, WordLegend } from './ui/Sheets'
import { REFERENCES, SITE, citation, viewUrl } from './site'
import { FIGURE_TILES, figurePng, figureSvg, type FigureSpec } from './ui/mapFigure'
import { binsFor, colorFor, mixBlack, mixWhite, NO_DATA, partShades } from './model/colormap'
import { giftiFunc, giftiLabel, mapCsv, mapReadme, summariseAreas, vertexValues } from './model/mapData'
import { areaParts, cortexId, deepId, hemiWord, indexSites, selectablesFor, surfaceDots, type AtlasId, type Selectable, type SiteParcelRecord, type SiteParcelsFile } from './model/parcels'
import { allContactsInside, eventGroup, inPart, narrowResult, patientLabel, selectRows, type SelectedRow } from './model/selection'
import { wordMap, wordTerms } from './model/wordMap'
import { DOWNLOAD_COLUMNS, datasetDescription, downloadRows, readme, sha256sums, toCsv } from './model/download'
import { zipStore } from './model/zip'
import { MAX_AREAS, PALETTE, assignSlots, linkRelease, normaliseSelection, parseLocation, toHash, toSearch, type ViewName, type ViewState } from './model/urlState'

const DATA_DIR = (import.meta.env.VITE_DATA_DIR as string | undefined) || 'data'
// the atlas files live beside the release they were built from, under the same name: a data
// directory with no atlas build is an error, never a silent fall-back to another release
const BASE = import.meta.env.BASE_URL || './'
// the site root: every view is this one page, with its state in the query
const ROOT_PATH = new URL(BASE, window.location.href).pathname

const VIEW_WORDS: Partial<Record<ViewName, string>> = { insideL: 'inside left', insideR: 'inside right' }

/** the finer atlas whose areas subdivide an area of this one (none for the finest) */
const FINER: Record<AtlasId, AtlasId | null> = { dk: 'destrieux', yeo7: 'dk', destrieux: null }


interface ReportTextFile { release?: string; text: Record<string, string> }

const ATLAS_CITATION: Record<AtlasId, string> = {
  dk: 'Desikan RS et al. (2006) NeuroImage 31:968',
  destrieux: 'Destrieux C et al. (2010) NeuroImage 53:1',
  yeo7: 'Yeo BTT et al. (2011) J Neurophysiol 106:1125',
}

function useAtlasData(db: { manifest: { synthetic: boolean; version: string }; sites: { site_id: string }[] } | null) {
  const [parcels, setParcels] = useState<SiteParcelsFile | null>(null)
  const [textFile, setTextFile] = useState<ReportTextFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const synthetic = db ? db.manifest.synthetic : null
  useEffect(() => {
    fetch(`${BASE}atlas/${DATA_DIR}/site_parcels.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`site_parcels.json: ${r.status}`))))
      .then(setParcels)
      .catch((e: Error) => setError(`The area assignments are missing (${e.message}). Run scripts/v2/build_site_parcels.py --data ${DATA_DIR}.`))
  }, [])
  useEffect(() => {
    if (synthetic !== false) return
    // A failed load is an ERROR, not an empty map: an empty map would show every stimulation as
    // "no report recorded" -- an absent input read as a zero (code review, 10 Oct).
    fetch(`${BASE}atlas/${DATA_DIR}/report_text.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`report_text.json: ${r.status}`))))
      .then(setTextFile)
      .catch((e: Error) => setError(`The reports could not be loaded (${e.message}). Run scripts/v2/build_report_text.py.`))
  }, [synthetic])
  // both files must be built from the release that is loaded, and cover every one of its sites
  const mismatch = useMemo(() => {
    if (!db || !parcels) return null
    const release = (parcels as { release?: string }).release
    if (release !== db.manifest.version) return `The area assignments were built for release ${release ?? 'unknown'}, but ${db.manifest.version} is loaded. Re-run scripts/v2/build_site_parcels.py.`
    const missing = db.sites.filter((s) => !parcels.sites[s.site_id]).length
    if (missing) return `${missing} sites of this release have no area assignment. Re-run scripts/v2/build_site_parcels.py.`
    if (textFile && textFile.release !== db.manifest.version) return `The reports were built for release ${textFile.release ?? 'unknown'}, but ${db.manifest.version} is loaded. Re-run scripts/v2/build_report_text.py.`
    return null
  }, [db, parcels, textFile])
  const text = useMemo(() => (textFile ? new Map(Object.entries(textFile.text)) : null), [textFile])
  return { parcels: mismatch ? null : parcels, text, error: error ?? mismatch }
}

export function App() {
  const { db, error: dbError, progress } = useAtlasDb()
  const [brain, setBrain] = useState<BrainAssets | null>(null)
  const [brainError, setBrainError] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>(() => parseLocation(window.location.search, window.location.hash))
  // the release the opening link names, if any; checked against the release that loads
  const [linkRel] = useState(() => linkRelease(window.location.search, window.location.hash))
  const [unknownIds, setUnknownIds] = useState<string[]>([])
  const [relNoticeSeen, setRelNoticeSeen] = useState(false)
  const [pairsNoticeSeen, setPairsNoticeSeen] = useState(false)
  const [atlas, setAtlas] = useState<AtlasAssets | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState(false)
  const [sheet, setSheet] = useState<null | 'about' | 'cite' | 'notices' | 'areas'>(null)
  const [glError, setGlError] = useState<string | null>(null)
  // one person in focus: the panel narrows to them, and the brain shows only their electrodes
  const [person, setPerson] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [hinted, setHinted] = useState(false)
  const slots = useRef(new Map<string, number>())
  const canvas = useRef<BrainCanvasHandle>(null)
  const synthetic = db ? db.manifest.synthetic : null
  const { parcels, text, error: parcelError } = useAtlasData(db)

  const [inflated, setInflated] = useState<Record<Hemi, Float32Array> | null>(null)
  useEffect(() => { loadBrain().then(setBrain, (e: Error) => setBrainError(e.message)) }, [])
  // the inflated surfaces follow the brain, so the first view never waits for them
  // the inflated surfaces follow the brain; if they fail, "Smooth" is unavailable and a link's (or
  // a buried pick's) smooth=1 is dropped rather than left checked over a folded brain (L8)
  const [inflatedFailed, setInflatedFailed] = useState(false)
  useEffect(() => { if (brain) loadInflated().then(setInflated, () => setInflatedFailed(true)) }, [brain])
  useEffect(() => { if (inflatedFailed) setState((s) => (s.smooth ? { ...s, smooth: false } : s)) }, [inflatedFailed])
  useEffect(() => {
    let alive = true
    setAtlas(null)
    loadAtlas(state.atlas).then((a) => { if (alive) setAtlas(a) }, (e: Error) => setBrainError(e.message))
    return () => { alive = false }
  }, [state.atlas])
  const release = db?.manifest.version ?? null
  const stepKey = `${state.atlas}|${state.sel.join(',')}|${state.sub ?? ''}`
  const lastStep = useRef(stepKey)
  const fromHistory = useRef(false)
  useEffect(() => {
    // one page, one address: the root with the state in the query. A legacy hash, or the path
    // of index.html, is replaced so the address bar is always the canonical link. A new atlas,
    // selection or part is a step Back can return to; the camera and the switches are not (U9)
    const url = ROOT_PATH + toSearch(state, release ?? linkRel)
    if (url === window.location.pathname + window.location.search) return
    // a part dropped because its area went (a new pick, Clear) is the same step, not a new one:
    // pushing it trapped Back on the new area (re-audit R1)
    const [la, ls, lsub] = lastStep.current.split('|')
    const subDropped = la === state.atlas && ls === state.sel.join(',') && lsub && !state.sub
    if (stepKey !== lastStep.current && !subDropped) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    lastStep.current = stepKey
  }, [state, release, linkRel, stepKey])
  useEffect(() => {
    // back/forward, or a pasted legacy hash link: follow it, or the address bar and the screen
    // disagree (found by the real-data count check, which navigated by hash)
    const follow = () => {
      const next = parseLocation(window.location.search, window.location.hash)
      setState((s) => {
        if (toHash(s) === toHash(next)) return s
        if (next.view !== s.view) canvas.current?.setView(next.view)
        lastStep.current = `${next.atlas}|${next.sel.join(',')}|${next.sub ?? ''}`
        fromHistory.current = true
        return next
      })
    }
    window.addEventListener('hashchange', follow)
    window.addEventListener('popstate', follow)
    return () => { window.removeEventListener('hashchange', follow); window.removeEventListener('popstate', follow) }
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  /* ----- derived data ------------------------------------------------------------------- */

  const parcelsBySite = useMemo(() => new Map<string, SiteParcelRecord>(Object.entries(parcels?.sites ?? {})), [parcels])
  const sitesByArea = useMemo(() => (parcels ? indexSites(parcels, state.atlas) : new Map<string, string[]>()), [parcels, state.atlas])
  // the loaded atlas only once it is the one the state asks for: while a switch is loading there is
  // nothing to pick, so a click cannot add an area of the previous atlas
  const atlasReady = atlas && atlas.table.id === state.atlas ? atlas : null
  const selectables = useMemo(() => (atlasReady && brain ? selectablesFor(atlasReady.table, brain.deep) : []), [atlasReady, brain])
  const byId = useMemo(() => new Map<string, Selectable>(selectables.map((s) => [s.id, s])), [selectables])
  const textFor = useCallback((eid: string): string | null => {
    if (!db) return null
    if (db.manifest.synthetic) return db.reportByEvent.get(eid)?.raw_report_redacted ?? null
    return text?.get(eid) ?? null
  }, [db, text])

  /** the strict pair rule: every contact current passed through (both of a pair, or a monopolar
      site's one contact) identified and inside one of `ids` (model/selection.ts) */
  const bothInside = useCallback((siteId: string, ids: ReadonlySet<string>) => (
    !!parcels && allContactsInside(parcelsBySite.get(siteId), db?.siteById.get(siteId)?.montage_type, parcels.contacts, state.atlas, ids)
  ), [parcelsBySite, parcels, state.atlas, db])

  /** the site's person is held: an open question on record about where their electrodes are */
  const heldSite = useCallback((siteId: string) => parcelsBySite.get(siteId)?.dk?.s === 'held', [parcelsBySite])

  const areaCounts = useMemo(() => {
    const out = new Map<string, { stim: number; people: number }>()
    if (!db) return out
    for (const [id, sites] of sitesByArea) {
      let stim = 0
      const people = new Set<string>()
      const one = new Set([id])
      // the same population the reading panel counts (selectRows): stimulations only -- never
      // sham, 0 mA or QC-excluded events -- and the same pair rule, so a hover and a click agree
      for (const s of sites) {
        if (state.pairs === 'both' && !bothInside(s, one)) continue
        for (const r of db.eventsBySite.get(s) ?? []) if (eventGroup(r) === 'stimulation') { stim++; people.add(r.event.patient_id) }
      }
      out.set(id, { stim, people: people.size })
    }
    return out
  }, [db, sitesByArea, state.pairs, bothInside])

  const totals = useMemo(() => {
    // sites counts places a STIMULATION happened: a site with only sham trials is not one (44 such
    // sites were counted, code review 10 Oct)
    // the core data: stimulations, from people whose electrode positions have no open question
    const t = { stim: 0, withReport: 0, people: 0, sham: 0, zero: 0, excluded: 0, sites: 0, held: 0, heldPeople: 0 }
    if (!db) return t
    const people = new Set<string>()
    const sites = new Set<string>()
    const heldPeople = new Set<string>()
    for (const r of db.rows) {
      const g = eventGroup(r)
      if (g === 'sham') { t.sham++; continue }
      if (g === 'zero_current') { t.zero++; continue }
      if (g === 'excluded') { t.excluded++; continue }
      if (heldSite(r.site.site_id)) { t.held++; heldPeople.add(r.event.patient_id); continue }
      t.stim++
      sites.add(r.site.site_id)
      people.add(r.event.patient_id)
      if (textFor(r.event.event_id)) t.withReport++
    }
    t.people = people.size
    t.sites = sites.size
    t.heldPeople = heldPeople.size
    return t
  }, [db, textFor, heldSite])

  const placed = useMemo(() => {
    // how many stimulations a click can reach in the current atlas: those whose site lies in one
    // of its areas or in a deep structure (QC-excluded events are in no area, so not here)
    const t = { stim: 0, people: 0 }
    if (!db || !parcels) return t
    const people = new Set<string>()
    for (const r of db.rows) {
      if (eventGroup(r) !== 'stimulation') continue
      const rec = parcelsBySite.get(r.site.site_id)
      if (!rec) continue
      const ids = [...(rec[state.atlas]?.p ?? []).map(cortexId), ...(rec.deep?.p ?? []).map(deepId)]
      // under the strict rule a stimulation is placed only where both contacts lie in one area
      if (!ids.some((id) => state.pairs !== 'both' || bothInside(r.site.site_id, new Set([id])))) continue
      t.stim++
      people.add(r.event.patient_id)
    }
    t.people = people.size
    return t
  }, [db, parcels, parcelsBySite, state.atlas, state.pairs, bothInside])

  const sel = useMemo(() => normaliseSelection(state.sel, (id) => byId.has(id)), [state.sel, byId])
  useEffect(() => {
    // once the atlas is known, drop ids it does not have (a pasted link, an old atlas) from the
    // state itself, so they cannot hold a slot or count toward the cap
    if (!byId.size) return
    if (sel.length !== state.sel.length || sel.some((id, i) => id !== state.sel[i])) {
      // a cited link that quietly shows something else breaks the citation: say what was dropped
      const unknown = state.sel.filter((id) => !byId.has(id))
      if (unknown.length) setUnknownIds(unknown)
      setState((s) => ({ ...s, sel }))
    }
  }, [sel, state.sel, byId])
  const slotMap = useMemo(() => {
    const m = assignSlots(sel, slots.current)
    slots.current = m
    return m
  }, [sel])
  const selectedAreas: SelectedArea[] = useMemo(
    () => sel.map((id) => ({ id, color: PALETTE[slotMap.get(id)! % PALETTE.length], n: slotMap.get(id)! + 1 })),
    [sel, slotMap],
  )
  const areaName = useCallback((id: string) => {
    const s = byId.get(id)
    if (!s) return id
    return s.name
  }, [byId])
  const areaSub = useCallback((id: string) => {
    const s = byId.get(id)
    if (!s) return ''
    // the side, and what kind of thing it is; the atlas's own full label is in the area's tooltip
    const bits = [hemiWord(s.hemisphere)]
    if (s.kind === 'deep') bits.push('deep structure')
    return bits.filter(Boolean).join(' · ')
  }, [byId, state.atlas])
  /** an area's name with its side ("Amygdala, left"), for the areas a pair also touches */
  const areaLabel = useCallback((id: string) => {
    const s = byId.get(id)
    return s ? `${s.name}${s.hemisphere ? `, ${s.hemisphere === 'lh' ? 'left' : 'right'}` : ''}` : id
  }, [byId])
  const areaViews: AreaView[] = useMemo(
    () => selectedAreas.map((a) => ({ id: a.id, name: areaName(a.id), sub: areaSub(a.id), color: a.color, n: a.n })),
    [selectedAreas, areaName, areaSub],
  )

  const result = useMemo(
    () => {
      if (!db) return null
      const ids = new Set(sel)
      return selectRows(sel, sitesByArea, db.eventsBySite as ReadonlyMap<string, readonly EventRow[]>, textFor,
        { bothInside: (s) => bothInside(s, ids), insideArea: (s, a) => bothInside(s, new Set([a])), strict: state.pairs === 'both' })
    },
    [db, sel, sitesByArea, textFor, bothInside, state.pairs],
  )

  const dots: Dot[] = useMemo(() => {
    // stimulated surface contacts at their registered fsaverage vertex; depth contacts are not
    // drawn (model/parcels.ts, surfaceDots)
    if (!db || !parcels || !(state.dots || person)) return []
    const colorByKey = new Map<string, string>()
    for (const a of selectedAreas) colorByKey.set(a.id, a.color)
    const stimulated = (sid: string) => (!person || db.siteById.get(sid)?.patient_id === person)
      && (db.eventsBySite.get(sid) ?? []).some((r) => eventGroup(r) === 'stimulation')
    return surfaceDots(parcels, stimulated, state.atlas, (id) => colorByKey.get(id) ?? null)
  }, [db, parcels, state.dots, state.atlas, selectedAreas, person])

  const coverage = useMemo(() => {
    // People stimulated per area, on one shared binned scale across the atlas and the deep
    // structures. The same counts as the hover card and the panel (areaCounts).
    if (!state.cov || !atlasReady || !brain) return null
    const people = (id: string) => areaCounts.get(id)?.people ?? 0
    const max = Math.max(0, ...selectables.map((a) => people(a.id)))
    const bins = binsFor(max)
    // with areas selected, the coverage scale steps back on screen so the selection colours stand
    // out (the selection's blue sat inside the coverage blues). A figure is drawn from the unfaded
    // colours, the ones its legend and areas.csv give (H2)
    const paint = (fade: boolean): CoverageColors => {
      const shade = (c: string | null) => (c && fade ? mixWhite(c, 0.6) : c)
      const colors: CoverageColors = { cortex: new Map(), deep: new Map() }
      for (const l of atlasReady.table.labels) {
        const c = shade(l.key ? colorFor(people(cortexId(l.key)), bins) : null)
        if (c) colors.cortex.set(l.index, c)
      }
      for (const d of brain.deep) {
        const c = shade(colorFor(people(deepId(d.key)), bins))
        if (c) colors.deep.set(d.key, c)
      }
      return colors
    }
    const reaching5 = selectables.filter((a) => people(a.id) >= 5).length
    return { colors: paint(sel.length > 0), unfaded: paint(false), bins, max, reaching5, areas: selectables.length }
  }, [state.cov, atlasReady, brain, areaCounts, selectables, sel.length])

  /* ----- experience search: a word becomes a map (model/wordMap.ts) ------------------------- */

  const sayTerms = useMemo(() => (state.say ? wordTerms(state.say) : []), [state.say])
  const words = useMemo(() => {
    if (!db || !parcels || !sayTerms.length) return null
    const areasOfSite = (sid: string) => {
      const rec = parcelsBySite.get(sid)
      const ids = [...(rec?.[state.atlas]?.p ?? []).map(cortexId), ...(rec?.deep?.p ?? []).map(deepId)]
      // the same pair rule as the panel, the hover card and Coverage
      return state.pairs === 'both' ? ids.filter((id) => bothInside(sid, new Set([id]))) : ids
    }
    return wordMap(db.rows, sayTerms, textFor, areasOfSite, heldSite)
  }, [db, parcels, parcelsBySite, sayTerms, state.atlas, state.pairs, bothInside, textFor, heldSite])
  const wordColors = useMemo(() => {
    // people who said it, per area, on a binned scale like Coverage; an area where people were
    // stimulated and nobody said it takes the zero colour, an area never stimulated stays plain
    if (!words || !atlasReady || !brain) return null
    const said = (id: string) => words.perArea.get(id)?.saidPeople ?? 0
    const max = Math.max(0, ...selectables.map((a) => said(a.id)))
    const bins = binsFor(max)
    const shade = (c: string | null) => (c && sel.length ? mixWhite(c, 0.6) : c)
    const colors: CoverageColors = { cortex: new Map(), deep: new Map() }
    for (const l of atlasReady.table.labels) {
      const c = shade(l.key ? colorFor(said(cortexId(l.key)), bins) : null)
      if (c) colors.cortex.set(l.index, c)
    }
    for (const d of brain.deep) {
      const c = shade(colorFor(said(deepId(d.key)), bins))
      if (c) colors.deep.set(d.key, c)
    }
    const areasWith = selectables.filter((a) => said(a.id) > 0).length
    return { colors, bins, max, areasWith }
  }, [words, atlasReady, brain, selectables, sel.length])

  /* ----- focus and subregions --------------------------------------------------------------- */

  // the area the camera turns to: the one picked last
  const focusArea = sel.length ? sel[sel.length - 1] : null
  const finerId = FINER[state.atlas]
  const [finer, setFiner] = useState<AtlasAssets | null>(null)
  useEffect(() => {
    let alive = true
    setFiner(null)
    if (finerId) loadAtlas(finerId).then((a) => { if (alive) setFiner(a) }, () => { /* no subregions */ })
    return () => { alive = false }
  }, [finerId])
  // the subregion lives in the link (sub=); it belongs to the area in focus, so a new area clears it
  const subFilter = state.sub
  const setSubFilter = useCallback((f: string | null | ((x: string | null) => string | null)) => {
    setState((s) => ({ ...s, sub: typeof f === 'function' ? f(s.sub) : f }))
  }, [])
  const prevFocus = useRef(focusArea)
  useEffect(() => {
    // Back and Forward restore the area with its part, so a step from history keeps it
    if (fromHistory.current) { fromHistory.current = false; prevFocus.current = focusArea; return }
    if (prevFocus.current !== focusArea && prevFocus.current !== null) setSubFilter(null)
    prevFocus.current = focusArea
  }, [focusArea, setSubFilter])
  // the history flag lives for the one render it arrived in (this runs after the effect above)
  useEffect(() => { fromHistory.current = false })
  // a subregion the finer atlas does not have in this area is dropped, once the subregions are known

  /** The finer atlas's areas inside the focused area: same vertices, so a part is exactly the piece
      of a published finer area that falls inside this one (Destrieux inside Desikan-Killiany,
      Desikan-Killiany inside a Yeo network). Slivers under 3% of the area are not listed
      (model/parcels.ts, areaParts). */
  const sub = useMemo(() => {
    if (!finer || !finerId || !atlasReady || !focusArea?.startsWith('ctx:') || sel.length !== 1 || state.cov) return null
    const lab = atlasReady.table.labels.find((l) => l.key && cortexId(l.key) === focusArea)
    if (!lab?.hemisphere || !lab.key) return null
    const h = lab.hemisphere as Hemi
    const { parts, sliverShare } = areaParts(atlasReady.labels[h], finer.labels[h], lab.index, finer.table.labels)
    if (parts.length < 2) return null
    const base = selectedAreas.find((a) => a.id === focusArea)?.color ?? PALETTE[0]
    const shades = partShades(parts.length)
    const colors = new Map<number, string>(), keys = new Map<number, string>()
    const list = parts.map((x, k) => {
      const t = shades[k]
      const color = t >= 0 ? mixWhite(base, t) : mixBlack(base, -t)
      colors.set(x.index, color)
      keys.set(x.index, x.key)
      return { key: x.key, name: x.name, color, share: x.share }
    })
    const engine: Subregions = { labels: finer.labels, colors, keys }
    return { engine, list, sliverShare, area: { atlas: state.atlas, key: lab.key }, atlas: finerId, title: ATLAS_CARDS.find((c) => c.id === finerId)!.title }
  }, [finer, finerId, atlasReady, focusArea, sel.length, state.cov, selectedAreas, state.atlas])

  /** a stimulation is in a part when one contact carries the part's label and lies in the area
      itself (model/selection.ts, inPart) */
  const inSub = useCallback((r: SelectedRow, key: string) => (
    !!parcels && !!sub && inPart(parcelsBySite.get(r.row.site.site_id), parcels.contacts, sub.area, { atlas: sub.atlas, key })
  ), [parcels, parcelsBySite, sub])
  const subInfo = useMemo(() => {
    if (!sub || !result) return null
    const list = sub.list.map((x) => {
      const rows = result.stimulations.filter((r) => inSub(r, x.key))
      return { ...x, stim: rows.length, people: new Set(rows.map((r) => r.row.event.patient_id)).size }
    })
    // the parts need not cover the area (slivers are not listed) and may overlap (a pair can lie
    // in two parts): both are said, not left for the reader to discover in the sums (M1)
    let outside = 0, overlap = false
    for (const r of result.stimulations) {
      const n = sub.list.filter((x) => inSub(r, x.key)).length
      if (n === 0) outside++
      if (n > 1) overlap = true
    }
    return { list, outside, overlap }
  }, [sub, result, inSub])
  const subList = subInfo?.list ?? null
  // a part filter applies only while the parts it names are on screen: under Coverage, Compare or
  // another atlas there are none, and narrowing by it emptied the panel ("No stimulations were
  // recorded in this area", H5). It stays in the state, so it returns when they do.
  const activeSub = subFilter && subList?.some((x) => x.key === subFilter) ? subFilter : null
  // one person in focus belongs to the selection it was chosen in: any change to the selection
  // clears it (removing the other area of a comparison left a filter with no rows and no control
  // to clear it, H5), and so does a result that no longer holds them
  const selKey = sel.join(',')
  useEffect(() => { setPerson(null) }, [selKey, state.atlas, activeSub])
  // phone only: the reading sheet lowered to see the brain; a new selection raises it again (U5)
  const [panelDown, setPanelDown] = useState(false)
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 700px)').matches ?? false)
  useEffect(() => {
    const m = window.matchMedia?.('(max-width: 700px)')
    if (!m) return
    const on = () => setPhone(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  // how much of the brain's stage the phone's reading sheet covers, measured, so the view's centre
  // moves into the part left open (the sheet is 55% of the window; the stage ends above the footer)
  const [sheetInset, setSheetInset] = useState(0)
  const sheetOpen = phone && sel.length > 0 && !panelDown
  useEffect(() => {
    if (!sheetOpen) { setSheetInset(0); return }
    const measure = () => {
      const c = document.querySelector('.atlas-canvas')?.getBoundingClientRect()
      const sheetTop = window.innerHeight * 0.45
      setSheetInset(c ? Math.max(0, Math.round(Math.min(c.bottom, window.innerHeight) - sheetTop)) : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [sheetOpen])
  useEffect(() => { setPanelDown(false) }, [selKey, state.atlas])
  useEffect(() => {
    if (person && result && !result.stimulations.some((r) => r.row.event.patient_id === person)) setPerson(null)
  }, [person, result])
  const shown = useMemo(() => {
    if (!result) return result
    let r = result
    if (activeSub) r = narrowResult(r, (x) => inSub(x, activeSub))
    if (person) r = narrowResult(r, (x) => x.row.event.patient_id === person)
    return r
  }, [result, activeSub, inSub, person])
  // a link's subregion that this area does not hold is dropped rather than filtering to nothing
  useEffect(() => {
    if (subFilter && subList && !subList.some((x) => x.key === subFilter)) setSubFilter(null)
  }, [subFilter, subList, setSubFilter])

  // the cortex fades on its own when a deep structure is picked, so it can be seen inside. The
  // electrodes no longer fade it: every dot is a surface contact, on the cortex (M3)
  const autoSee = sel.some((id) => id.startsWith('deep:')) ? 0.7 : 0
  // the Opacity slider, once moved (or set by a link), wins over the automatic fade
  const [manualSee, setManualSee] = useState<number | null>(() => state.see)
  const see = manualSee ?? autoSee
  // a deep structure newly picked gets the automatic fade back, or one picked after Opacity was
  // set solid sits hidden inside the cortex (U8)
  // compared on the selection as stored, which a link sets before anything loads: the shown
  // selection is empty until the atlas arrives, so a link's own deep id looked newly picked (re-audit R2)
  const prevSel = useRef(state.sel)
  useEffect(() => {
    if (state.sel.some((id) => id.startsWith('deep:') && !prevSel.current.includes(id))) {
      setManualSee(null)
      setState((s) => (s.see == null ? s : { ...s, see: null }))
    }
    prevSel.current = state.sel
  }, [state.sel])

  const onCanvasClick = (id: string | null) => {
    // 'sub:' alone is a sliver of the selected area, in no listed part: it clears the part, and
    // never deselects the area (M1)
    if (id?.startsWith('sub:')) { const k = id.slice(4); setSubFilter((f) => (!k || f === k ? null : k)); return }
    toggleArea(id)
  }

  // "Smooth" switched on only because a buried area was picked goes off again once no buried area
  // is selected, and whenever a deep structure is picked: the smoothed surface hides the deep
  // structures, so a hippocampus picked after an insula showed nothing (M9)
  const autoSmoothed = useRef(false)

  /** the folded brain hides the area: measured at build time, one verdict for both sides
      (build_brain_assets.py, BURIED: the insula, Heschl's gyrus, the plana polare, the deep sulci) */
  const buried = useCallback((id: string) => {
    if (!id.startsWith('ctx:') || !atlasReady) return false
    return !!atlasReady.table.labels.find((l) => l.key && cortexId(l.key) === id)?.buried
  }, [atlasReady])

  useEffect(() => {
    // the deep structures are drawn on the folded brain only: a deep pick or link turns Smooth
    // off, whoever turned it on, or the structure is selected and invisible (U7)
    if (state.smooth && sel.some((id) => id.startsWith('deep:'))) {
      if (!autoSmoothed.current) setToast({ text: 'Smooth is off: the deep structures are drawn on the folded brain.' })
      autoSmoothed.current = false
      setState((x) => ({ ...x, smooth: false }))
      return
    }
    if (!autoSmoothed.current) return
    if (!sel.some(buried)) { autoSmoothed.current = false; setState((x) => ({ ...x, smooth: false })) }
  }, [sel, buried, state.smooth])

  // a link to a buried area opens on the smoothed surface too, as a click on it does (U17)
  const linkSmoothed = useRef(false)
  useEffect(() => {
    if (linkSmoothed.current || !atlasReady || !inflated) return
    linkSmoothed.current = true
    if (!state.smooth && sel.some(buried) && !sel.some((id) => id.startsWith('deep:'))) {
      autoSmoothed.current = true
      setState((x) => ({ ...x, smooth: true }))
    }
  }, [atlasReady, inflated, sel, buried, state.smooth])

  /** Undo puts back what Clear took: the areas and the Smooth that came with them (L8) */
  const restorer = useCallback(() => {
    const prev = { sel: state.sel, smooth: state.smooth, auto: autoSmoothed.current }
    return () => { autoSmoothed.current = prev.auto; setState((x) => ({ ...x, sel: prev.sel, smooth: prev.smooth })) }
  }, [state.sel, state.smooth])

  /* ----- actions -------------------------------------------------------------------------- */

  const toggleArea = useCallback((id: string | null) => {
    if (!id || !byId.has(id)) return
    setHinted(true)
    setState((s) => {
      if (s.sel.includes(id)) {
        const prev = s.sel
        setToast({ text: `Removed ${areaName(id)}.`, undo: () => setState((x) => ({ ...x, sel: prev })) })
        return { ...s, sel: s.sel.filter((x) => x !== id) }
      }
      // a buried area (the insula, deep in its sulcus) is shown on the smoothed surface, where it
      // can be seen; the toggle stays the reader's to turn off
      const canSmooth = !inflatedFailed
      if (!s.smooth && canSmooth && buried(id)) autoSmoothed.current = true
      const smooth = s.smooth || (canSmooth && buried(id))
      // one area at a time unless comparing: a new pick replaces the old one
      if (!s.multi) return { ...s, sel: [id], smooth }
      if (s.sel.length >= MAX_AREAS) {
        setToast({ text: `Up to ${MAX_AREAS} areas at a time. Remove one to add another.` })
        return s
      }
      return { ...s, sel: [...s.sel, id], smooth }
    })
  }, [areaName, byId, buried, inflatedFailed])

  const pickAtlas = (a: AtlasId) => {
    setPicker(false)
    if (a === state.atlas) return
    const prev = state
    const kept = state.sel.filter((id) => id.startsWith('deep:'))
    const dropped = state.sel.length - kept.length
    setState({ ...state, atlas: a, sel: kept })
    if (dropped) setToast({ text: `Switched to ${ATLAS_CARDS.find((c) => c.id === a)!.title}. ${dropped} area${dropped === 1 ? ' was' : 's were'} cleared.`, undo: () => setState(prev) })
  }

  const setView = (v: ViewName) => {
    setState((s) => ({ ...s, view: v }))
    canvas.current?.setView(v)
  }
  /** the outside of the hemisphere the area in focus is on (U3: Outside always showed the left) */
  const outside = () => setView(byId.get(focusArea ?? '')?.hemisphere === 'rh' ? 'right' : 'left')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sheet && e.key !== '?') return
      if (e.key === 'ArrowLeft') canvas.current?.rotateBy(-Math.PI / 12)
      else if (e.key === 'ArrowRight') canvas.current?.rotateBy(Math.PI / 12)
      else if (e.key === 'r' || e.key === 'R') outside()
      else if (e.key === '?') setSheet('about')
      else if (e.key === 'a' || e.key === 'A') setSheet('areas')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const downloadReports = async () => {
    if (!db || !atlas) return
    // what is on screen: the selection as narrowed to a part or a person, so the file, its README
    // and the link it cites describe the same rows (M15: the zip held the whole area while citing
    // a link that opens one part of it)
    const rows: SelectedRow[] = shown && sel.length
      ? [...shown.stimulations, ...shown.zeroCurrent, ...shown.sham]
      : db.rows.map((row) => ({ row, areas: [], text: textFor(row.event.event_id) }))
    const partName = activeSub ? subList?.find((x) => x.key === activeSub)?.name ?? activeSub : null
    const narrowed = [
      partName ? `the part ${partName} (${sub?.title})` : null,
      person ? `one person, ${patientLabel(person)} (patient_id ${person}; the link does not carry the person)` : null,
    ].filter(Boolean).join(' and ') || null
    const isHeld = (r: SelectedRow) => eventGroup(r.row) === 'stimulation' && heldSite(r.row.site.site_id)
    // left and right areas share names ("Insula"): the download names the side
    const areaLabel = (id: string) => [hemiWord(byId.get(id)?.hemisphere ?? null), areaName(id)].filter(Boolean).join(' ')
    const table = downloadRows(rows, state.atlas, parcelsBySite, areaLabel, db.manifest.synthetic, heldSite)
    const stim = rows.filter((r) => eventGroup(r.row) === 'stimulation' && !isHeld(r))
    const enc = new TextEncoder()
    const cite = citation(db.manifest.version, viewUrl(), new Date())
    const files = [
      { name: 'reports.csv', data: enc.encode(toCsv(table)) },
      {
        name: 'README.txt',
        data: enc.encode(readme({
          cite: cite.text,
          release: db.manifest.version,
          synthetic: db.manifest.synthetic,
          atlasTitle: atlas.table.title,
          atlasCitation: ATLAS_CITATION[state.atlas],
          areas: sel.map((id) => `${areaName(id)} (${areaSub(id)})`),
          narrowed,
          pulseWidthRecorded: rows.filter((r) => r.row.event.pulse_width_us != null).length,
          pairs: state.pairs,
          stimulations: stim.length,
          sham: rows.filter((r) => eventGroup(r.row) === 'sham').length,
          zeroCurrent: rows.filter((r) => eventGroup(r.row) === 'zero_current').length,
          excluded: rows.filter((r) => eventGroup(r.row) === 'excluded').length,
          excludedElsewhere: sel.length && !activeSub && !person ? result?.counts.excluded ?? 0 : 0,
          held: rows.filter(isHeld).length,
          patients: new Set(stim.map((r) => r.row.event.patient_id)).size,
          generated: new Date(),
        }) + `\nCOLUMNS\n  ${DOWNLOAD_COLUMNS.join(', ')}\n`),
      },
      { name: 'CITATION.bib', data: enc.encode(cite.bibtex + '\n') },
      { name: 'dataset_description.json', data: enc.encode(datasetDescription({
        name: SITE.name, release: db.manifest.version, synthetic: db.manifest.synthetic, authors: SITE.lab, institution: SITE.institution,
        url: viewUrl(), doi: SITE.datasetDoi, irb: SITE.irb, funding: SITE.funding, references: [ATLAS_CITATION[state.atlas], REFERENCES.fischl],
      })) },
    ]
    files.push({ name: 'SHA256SUMS', data: enc.encode(await sha256sums(files)) })
    const zip = zipStore(files)
    const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `brain-atlas_${state.atlas}_${sel.length ? `${sel.length}-areas` : 'all'}_${localDate()}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setToast({ text: `Saved ${rows.length.toLocaleString()} rows${sel.length ? ` from ${sel.length} area${sel.length === 1 ? '' : 's'}` : ''}${narrowed ? `, narrowed to ${partName && person ? 'a part and a person' : partName ? 'one part' : 'one person'}` : ''}, with a README.` })
  }

  /** the map on screen: coverage when it is on, else the selected areas */
  const mapKind: 'coverage' | 'selection' | null = state.cov ? 'coverage' : sel.length ? 'selection' : null
  const downloadMap = async () => {
    if (!db || !atlasReady || !brain || !canvas.current || !mapKind || !result) return
    setToast({ text: 'Making the map…' })
    await new Promise((r) => setTimeout(r, 30)) // let the toast paint before the render blocks
    const synth = db.manifest.synthetic
    // the reader's own date: a Pacific-evening figure was stamped with tomorrow's UTC date (L12)
    const date = localDate()
    const cite = ATLAS_CITATION[state.atlas]
    const rule = state.pairs === 'both' ? 'both contacts of the pair lie inside it' : 'one of its contacts lies in it'
    const side = (id: string) => (byId.get(id)?.hemisphere === 'lh' ? 'left' : 'right')
    const selNumber = (id: string) => (sel.includes(id) ? (slotMap.get(id) ?? 0) + 1 : null)
    const selColour = (id: string) => selectedAreas.find((a) => a.id === id)?.color ?? null
    const summaries = summariseAreas(selectables, state.atlas, sitesByArea, db.eventsBySite as ReadonlyMap<string, readonly EventRow[]>,
      { bothInside, strict: state.pairs === 'both', synthetic: synth }, selNumber)
    const bins = binsFor(Math.max(0, ...summaries.map((r) => r.people)))
    // per area, by the same rule as the table and the hover card (each area judged on its own)
    const perArea = new Map(summaries.map((r) => [r.id, r]))

    if (!inflated) setInflated(await loadInflated())
    await new Promise((r) => setTimeout(r, 30)) // the engine takes the surfaces on the next render
    const views = canvas.current.captureViews(FIGURE_TILES.map((t) => ({ view: t.view, w: t.w, h: t.h, scale: t.scale })),
      { inflated: true, coverage: mapKind === 'coverage' ? coverage?.unfaded ?? null : undefined })
    // a coverage figure explains no selection, so it carries no selection pins (M8)
    if (mapKind === 'coverage') for (const v of views) v.pins = []
    // the figure is the cortex on the inflated surface: deep structures are in the legend and the
    // table, marked as not drawn, and the coverage scale says it includes them (M8)
    const deepScale = mapKind === 'coverage' && summaries.some((r) => r.atlas === 'aseg' && r.people > Math.max(0, ...summaries.filter((x) => x.atlas !== 'aseg').map((x) => x.people)))
    const electrodesNote = person ? ` (${patientLabel(person)} only)` : ''
    const spec: FigureSpec = {
      title: mapKind === 'coverage' ? 'People stimulated per area' : `${sel.length} selected area${sel.length === 1 ? '' : 's'}`,
      subtitle: `${atlasCard.title} · fsaverage, inflated surface · release ${db.manifest.version}`,
      legend: mapKind === 'coverage'
        ? { kind: 'coverage', bins, measure: `People with at least one stimulation in the area (of ${placed.people} people with a stimulation in ${placedInWords[state.atlas]} or a deep structure)`,
            scaleNote: `The scale includes the 14 deep structures, which this cortical figure does not draw (see areas.csv)${deepScale ? '; the top step is reached only by a deep structure' : ''}.`,
            electrodes: state.dots || person ? dots.length : null, electrodesNote }
        : {
            kind: 'selection',
            electrodes: state.dots || person ? dots.length : null,
            electrodesNote,
            areas: selectedAreas.map((a) => {
              const b = perArea.get(a.id)
              const counts = b ? `${b.stimulations.toLocaleString('en-US')} stimulation${b.stimulations === 1 ? '' : 's'} · ${b.people} ${b.people === 1 ? 'person' : 'people'}` : ''
              const deep = a.id.startsWith('deep:')
              return { n: a.n, color: a.color, name: `${areaName(a.id)}, ${side(a.id)}`, detail: deep ? `not on this figure · ${counts}` : counts, drawn: !deep }
            }),
          },
      source: `Areas: ${cite}, on FreeSurfer fsaverage (Fischl et al. 1999). A stimulation counts in an area when ${rule}, by each contact's label in the person's own MRI. Counted: stimulations with current delivered (no sham, none recorded at 0 mA, none excluded by quality control) from people whose electrode positions have no open question. Intracranial Stimulation Atlas, made ${date}.`,
      synthetic: synth,
    }
    const png = await figurePng(views, spec)
    const svg = figureSvg(views, spec)

    const value = (r: (typeof summaries)[number]) => (mapKind === 'coverage' ? r.people : r.selected ?? '')
    const colour = (r: (typeof summaries)[number]) => (mapKind === 'coverage' ? colorFor(r.people, bins) ?? NO_DATA : selColour(r.id) ?? '')
    const enc = new TextEncoder()
    const files: { name: string; data: Uint8Array }[] = [
      { name: 'figure.png', data: new Uint8Array(await png.arrayBuffer()) },
      { name: 'figure.svg', data: enc.encode(svg) },
      { name: 'areas.csv', data: enc.encode(mapCsv(summaries, value, colour)) },
    ]
    const desc = `${mapKind === 'coverage' ? 'people' : 'selected'}${state.atlas}`
    const giftiNames: string[] = []
    for (const h of ['lh', 'rh'] as const) {
      const stem = `source-lbcniesatlas_desc-${desc}_space-fsaverage_den-164k_hemi-${h === 'lh' ? 'L' : 'R'}`
      const meta = { Description: spec.title, Atlas: atlasCard.title, Release: db.manifest.version, Synthetic: synth ? 'yes' : 'no' }
      const lab = atlasReady.labels[h]
      if (mapKind === 'coverage') {
        const byIndex = new Map<number, number>()
        for (const l of atlasReady.table.labels) if (l.key) byIndex.set(l.index, summaries.find((r) => r.id === cortexId(l.key!))?.people ?? 0)
        const name = `${stem}_feature.func.gii`
        files.push({ name, data: enc.encode(await giftiFunc(vertexValues(lab, byIndex, NaN), h, 'people_stimulated', meta)) })
        giftiNames.push(name)
      } else {
        const keyOf = new Map<number, number>()
        for (const l of atlasReady.table.labels) {
          const n = l.key ? selNumber(cortexId(l.key)) : null
          if (n) keyOf.set(l.index, n)
        }
        const keys = new Int32Array(lab.length)
        for (let v = 0; v < lab.length; v++) keys[v] = keyOf.get(lab[v]) ?? 0
        const table = selectedAreas.filter((a) => a.id.startsWith('ctx:')).map((a) => ({ key: a.n, name: `${a.n} ${areaName(a.id)} (${side(a.id)})`, color: a.color }))
        const name = `${stem}_dseg.label.gii`
        files.push({ name, data: enc.encode(await giftiLabel(keys, table, h, meta)) })
        giftiNames.push(name)
      }
    }
    const mapCite = citation(db.manifest.version, viewUrl(), new Date())
    files.push({ name: 'CITATION.bib', data: enc.encode(mapCite.bibtex + '\n') })
    files.push({
      name: 'README.txt',
      data: enc.encode(mapReadme({
        kind: mapKind, release: db.manifest.version, synthetic: synth, generated: new Date(), atlasTitle: atlasCard.title,
        citation: cite, rule, people: placed.people, stimulations: placed.stim, releasePeople: totals.people, releaseStimulations: totals.stim, areas: summaries.length,
        gifti: giftiNames, electrodes: state.dots || person ? dots.length : null,
        selected: selectedAreas.map((a) => `${a.n} ${areaName(a.id)} (${side(a.id)})`),
      })),
    })
    files.push({ name: 'SHA256SUMS', data: enc.encode(await sha256sums(files)) })
    const zip = zipStore(files)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }))
    a.download = `brain-atlas_${state.atlas}_${mapKind === 'coverage' ? 'coverage' : `${sel.length}-areas`}_map_${date}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setToast({ text: 'Saved the map: figure (PNG and SVG), a table of every area, surface files and a README.' })
  }

  /* ----- render --------------------------------------------------------------------------- */

  const linkNotice: string[] = []
  if (linkRel && release && linkRel !== release && !relNoticeSeen) linkNotice.push(`This link was made on data release ${linkRel}. You are viewing release ${release}, so counts may differ.`)
  if (state.pairs === 'both' && !pairsNoticeSeen) linkNotice.push('This link counts only pairs with both contacts inside an area (the stricter rule).')
  if (unknownIds.length) linkNotice.push(`This link names ${unknownIds.length === 1 ? 'an area' : `${unknownIds.length} areas`} not in ${ATLAS_CARDS.find((c) => c.id === state.atlas)!.title}: ${unknownIds.map((id) => id.replace(/^(ctx|deep):/, '')).join(', ')}.`)
  const err = dbError || brainError || parcelError
  const ready = db && brain && parcels && result && (synthetic || text)
  const hoverSel = hover ? byId.get(hover.id) : null
  const hoverCount = hover ? areaCounts.get(hover.id) : undefined
  const atlasCard = ATLAS_CARDS.find((c) => c.id === state.atlas)!

  const examples = EXAMPLES.filter((e) => byId.has(e.id)).map((e) => ({ id: e.id, label: e.label }))
  const pickExample = (id: string) => { setSheet(null); if (!state.sel.includes(id)) toggleArea(id) }

  return (
    <div className={`atlas ${sel.length ? 'has-panel' : ''}`}>
      <a className="atlas-skip" href="#atlas-panel" onClick={(e) => { if (!sel.length) { e.preventDefault(); setSheet('areas') } }}>Skip to the reports</a>
      <header className="atlas-top">
        <div className="atlas-brand">
          <h1 className="atlas-wordmark">{SITE.name}</h1>
          {synthetic && <span className="atlas-badge" title="Synthetic demonstration data, not real patients">Demonstration data</span>}
        </div>
        <nav className="atlas-actions" aria-label="Atlas">
          <div className="atlas-picker-wrap">
            <button className="atlas-ghost" data-popover-trigger onClick={() => setPicker((p) => !p)} aria-haspopup="dialog" aria-expanded={picker}>
              <span className="label-wide">{atlasCard.title}</span><span className="label-narrow">Atlas</span> <ChevronDown size={15} aria-hidden />
            </button>
            {picker && <AtlasPicker value={state.atlas} onPick={pickAtlas} onClose={() => setPicker(false)} />}
          </div>
          <button className="atlas-ghost" onClick={() => setSheet('areas')} disabled={!selectables.length} aria-label="Areas: the list of every area"><List size={15} aria-hidden /> <span className="label-wide">Areas</span></button>
          <button className="atlas-ghost" onClick={() => setSheet('about')} aria-label="About"><Info size={15} aria-hidden /> <span className="label-wide">About</span></button>
          <div className="atlas-picker-wrap">
            <button className="atlas-primary" data-popover-trigger onClick={() => setMenu((m) => !m)} disabled={!ready} aria-haspopup="dialog" aria-expanded={menu} aria-label="Download">
              <Download size={15} aria-hidden /> <span className="label-wide">Download</span> <ChevronDown size={15} aria-hidden className="label-wide" />
            </button>
            {menu && (
              <DownloadMenu
                reports={!sel.length ? 'Every stimulation in the release, with its report.'
                  : `The stimulations ${person ? `of ${patientLabel(person)} ` : ''}in ${activeSub ? `${subList?.find((x) => x.key === activeSub)?.name ?? activeSub}, part of ${areaName(sel[sel.length - 1])}` : sel.length === 1 ? `${areaName(sel[0])} (${areaSub(sel[0])})` : `the ${sel.length} selected areas`}, with their reports.`}
                onReports={() => { setMenu(false); downloadReports().catch((e: Error) => setToast({ text: `The download could not be made: ${e.message}` })) }}
                map={mapKind}
                onMap={() => {
                  setMenu(false)
                  downloadMap().catch((e: Error) => setToast({ text: `The map could not be made: ${e.message}` }))
                }}
                onClose={() => setMenu(false)}
              />
            )}
          </div>
        </nav>
      </header>

      <main className="atlas-main">
        <section className="atlas-stage" aria-label="Brain">
          {err && (
            <div className="atlas-error" role="alert">
              <p>The atlas could not load its data.</p>
              <p className="small muted">{err}</p>
              <button className="atlas-ghost bordered" onClick={() => window.location.reload()}>Try again</button>
            </div>
          )}
          {!err && glError && (
            <div className="atlas-error" role="alert">
              <p>This browser cannot draw the 3D brain (WebGL 2 is not available).</p>
              <p className="small muted">Every report is still reachable from the list of areas. To see the brain, try a current version of Chrome, Edge, Firefox or Safari, or check <a href="https://get.webgl.org/webgl2/" target="_blank" rel="noreferrer">get.webgl.org</a>.</p>
              <button className="atlas-ghost bordered" onClick={() => setSheet('areas')} disabled={!selectables.length}>Open the list of areas</button>
            </div>
          )}
          {!err && !glError && !brain && <p className="atlas-loading">Loading the brain…</p>}
          {brain && !glError && (
            <BrainCanvas
              ref={canvas}
              brain={brain}
              inflated={inflated}
              atlas={atlasReady}
              selected={selectedAreas}
              smooth={state.smooth}
              see={see}
              seeManual={manualSee != null && manualSee >= 0.5}
              onHidden={(h) => setState((s) => {
                // the engine showed or hid a hemisphere for a focus: the view, its buttons and the
                // link follow it (M12)
                const view: ViewName = h === 'rh' ? 'insideL' : h === 'lh' ? 'insideR' : s.view.startsWith('inside') ? 'left' : s.view
                return view === s.view ? s : { ...s, view }
              })}
              focus={focusArea}
              bottomInset={sheetInset}
              fade={sel.length > 0 && !state.cov}
              subregions={sub?.engine ?? null}
              subActive={activeSub}
              dots={dots}
              showDots={state.dots || !!person}
              coverage={wordColors?.colors ?? coverage?.colors ?? null}
              initialView={state.view}
              label={`3D brain${VIEW_WORDS[state.view] ? `, ${VIEW_WORDS[state.view]}` : ''}. ${sel.length ? `${sel.length} ${sel.length === 1 ? 'area' : 'areas'} selected: ${sel.map(areaName).join(', ')}.` : 'No areas selected.'} Use the Areas list for the same choices without the 3D view.`}
              onHover={(id, x, y) => setHover(id ? { id, x, y } : null)}
              onClick={onCanvasClick}
              onError={(m) => setGlError(m)}
            />
          )}
          {brain && <SearchBox all={selectables} counts={areaCounts} onPick={(id) => { if (!state.sel.includes(id)) toggleArea(id) }}
            onSay={(q) => setState((s) => ({ ...s, say: q, cov: false }))} />}

          {hover && hover.id === 'sub:' && !picker && !sheet && (
            <div className="atlas-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <strong>Smaller parts of {areaName(focusArea ?? '')}</strong>
              <span>Each under 3% of the area · {sub?.title}; not listed</span>
            </div>
          )}
          {hover && hover.id.startsWith('sub:') && hover.id !== 'sub:' && !picker && !sheet && (() => {
            const x = subList?.find((t) => t.key === hover.id.slice(4))
            return x ? (
              <div className="atlas-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
                <strong>{x.name}</strong>
                <span>Part of {areaName(focusArea ?? '')} · {sub?.title}</span>
                <span>{x.stim ? `${x.stim.toLocaleString()} stimulation${x.stim === 1 ? '' : 's'} · ${x.people} ${x.people === 1 ? 'person' : 'people'}` : 'No stimulation here'}</span>
                <span>{activeSub === x.key ? 'Click to deselect' : 'Click to select'}</span>
              </div>
            ) : null
          })()}
          {hover && hoverSel && !picker && !sheet && (
            <div className="atlas-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <strong>{areaName(hover.id)}</strong>
              <span>{areaSub(hover.id)}</span>
              <span>{hoverCount && hoverCount.stim ? `${hoverCount.stim.toLocaleString()} stimulation${hoverCount.stim === 1 ? '' : 's'} · ${hoverCount.people} ${hoverCount.people === 1 ? 'person' : 'people'}` : state.pairs === 'both' ? 'No stimulation with both contacts inside' : 'No stimulation here'}</span>
              {words && (() => {
                const w = words.perArea.get(hover.id)
                return w ? <span>{w.saidPeople} of {w.people} {w.people === 1 ? 'person' : 'people'} with a report here said “{state.say}” · {w.saidReports} of {w.reports} reports</span> : null
              })()}
              {hoverCount && hoverCount.people > 0 && hoverCount.people < MIN_PEOPLE && <span>Fewer than {MIN_PEOPLE} people</span>}
            </div>
          )}

          {!hinted && brain && !sel.length && !glError && (
            <div className="atlas-hint">
              <p>Click an area to read what people felt when it was stimulated.</p>
              {examples.length > 0 && (
                <p className="atlas-examples">
                  <span>Try</span>
                  {examples.map((e) => <button key={e.id} className="atlas-ghost small bordered" onClick={() => pickExample(e.id)}>{e.label}</button>)}
                </p>
              )}
            </div>
          )}

          {linkNotice.length > 0 && (
            <div className="atlas-linknote" role="status">
              {linkNotice.map((t) => <p key={t}>{t}</p>)}
              <button className="link small" onClick={() => { setUnknownIds([]); setRelNoticeSeen(true); setPairsNoticeSeen(true) }}>Dismiss</button>
            </div>
          )}
          <div className="atlas-status" aria-live="polite">
            {ready ? (
              <>{totals.stim.toLocaleString()} stimulations · {totals.people} people · {totals.withReport.toLocaleString()} recorded reports</>
            ) : db ? 'Loading reports…' : `Loading the data… ${progress.done}/${progress.total}`}
          </div>
          {(state.dots || person || coverage || words) && (
            <div className="atlas-float">
              {words && wordColors && <WordLegend say={state.say!} bins={wordColors.bins} areasWith={wordColors.areasWith} areas={selectables.length}
                stimulation={words.stimulation} sham={words.sham} faded={sel.length > 0} onClear={() => setState((s) => ({ ...s, say: null }))} />}
              {!words && coverage && <CoverageLegend bins={coverage.bins} reaching5={coverage.reaching5} areas={coverage.areas} faded={sel.length > 0} deepHidden={see < 0.5} />}
              {(state.dots || person) && <p className="atlas-note">Stimulated surface contacts, each at the point of the standard brain it was registered to. Depth contacts are not drawn.</p>}
            </div>
          )}
          {sel.length > 0 && result && db && panelDown && (
            <button className="atlas-panel-up atlas-primary" onClick={() => setPanelDown(false)}>Read the reports</button>
          )}
          <div className="atlas-bottom">
            <div className="atlas-views" role="group" aria-label="View">
              <button className={!state.view.startsWith('inside') ? 'on' : ''} aria-pressed={!state.view.startsWith('inside')} onClick={outside} title="The outer surface (R)">Outside</button>
              <button className={state.view.startsWith('inside') ? 'on' : ''} aria-pressed={state.view.startsWith('inside')} title="The inner (medial) surface of the hemisphere"
                onClick={() => setView(state.view === 'insideL' ? 'insideR' : state.view === 'insideR' ? 'insideL' : (byId.get(focusArea ?? '')?.hemisphere === 'rh' ? 'insideR' : 'insideL'))}>
                {state.view === 'insideL' ? 'Inside · left' : state.view === 'insideR' ? 'Inside · right' : 'Inside'}
              </button>
            </div>
            <div className="atlas-toggles" role="group" aria-label="Display">
              <label className="atlas-toggle">
                <input type="checkbox" role="switch" aria-label="Smooth" checked={state.smooth && !inflatedFailed} disabled={!inflated} onChange={(e) => { autoSmoothed.current = false; setState((s) => ({ ...s, smooth: e.target.checked })) }} />
                <span>Smooth</span>
              </label>
              <label className="atlas-toggle">
                <input type="checkbox" role="switch" aria-label="Electrodes" checked={state.dots} onChange={(e) => setState((s) => ({ ...s, dots: e.target.checked }))} />
                <span>Electrodes</span>
              </label>
              <label className="atlas-toggle" title="Colour every area by how many people were stimulated there">
                <input type="checkbox" role="switch" aria-label="Coverage" checked={state.cov && !state.say} onChange={(e) => setState((s) => ({ ...s, cov: e.target.checked, say: e.target.checked ? null : s.say }))} />
                <span>Coverage</span>
              </label>
              <label className="atlas-slider" title="How solid the cortex is: lower it to see selected areas whole and the deep structures inside">
                <span>Opacity</span>
                <input type="range" min={0.1} max={1} step={0.01} value={1 - see} aria-label="Opacity"
                  onChange={(e) => { const v = 1 - Number(e.target.value); setManualSee(v); setState((s) => ({ ...s, see: v })) }} />
              </label>
            </div>
          </div>
        </section>

        {sel.length > 0 && result && db && !panelDown && (
          <ReadingPanel
            areas={areaViews}
            result={shown!}
            atlas={state.atlas}
            atlasTitle={atlasCard.title}
            parcelsBySite={parcelsBySite}
            areaLabel={areaLabel}
            synthetic={db.manifest.synthetic}
            pairs={state.pairs}
            fullPatients={result.counts.patients}
            query={state.say}
            compare={state.multi}
            onCompare={(on) => setState((s) => ({ ...s, multi: on, sel: on ? s.sel : s.sel.slice(-1) }))}
            subregions={subInfo && sub ? { title: sub.title, list: subInfo.list, active: activeSub, onPick: (k: string) => setSubFilter(k), onClear: () => setSubFilter(null), outside: subInfo.outside, overlap: subInfo.overlap } : null}
            onRemove={(id) => toggleArea(id)}
            person={person}
            onPerson={setPerson}
            onBack={() => setPanelDown(true)}
            onClear={() => {
              const undo = restorer()
              setState((s) => ({ ...s, sel: [] }))
              setToast({ text: 'Cleared all areas.', undo })
            }}
          />
        )}
      </main>

      <footer className="atlas-foot">
        <div className="atlas-foot-lab">
          <span>{SITE.labShort}, Stanford University</span>
          {release && <span>Data release {release}</span>}
          <button className="link" onClick={() => setSheet('cite')} disabled={!release}>How to cite</button>
          <button className="link" onClick={() => setSheet('notices')}>Licences</button>
          <a href={SITE.issuesUrl} target="_blank" rel="noreferrer">Report a problem</a>
        </div>
        {/* Stanford's global footer, complete and unaltered (Stanford Identity: its links "may not be
            altered"). Links as on www.stanford.edu, checked 19 Oct 2026. */}
        <nav className="atlas-foot-su" aria-label="Stanford University">
          {STANFORD_FOOTER.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">{label}</a>)}
          <span>© Stanford University. Stanford, California 94305.</span>
        </nav>
      </footer>

      {toast && (
        <div className="atlas-toast" role="status">
          {toast.text}
          {toast.undo && <button className="link" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
        </div>
      )}
      {sheet === 'about' && db && (
        <AboutSheet
          onClose={() => setSheet(null)}
          onOpen={(k) => setSheet(k)}
          examples={examples}
          onExample={pickExample}
          release={db.manifest.version}
          synthetic={db.manifest.synthetic}
          totals={totals}
          placed={placed}
          atlas={state.atlas}
          placedIn={placedInWords[state.atlas]}
          validation={(parcels as unknown as { validation?: Parameters<typeof AboutSheet>[0]['validation'] })?.validation ?? null}
        />
      )}
      {sheet === 'cite' && release && <CiteSheet onClose={() => setSheet(null)} release={release} atlasCitation={ATLAS_CITATION[state.atlas]} />}
      {sheet === 'notices' && <NoticesSheet onClose={() => setSheet(null)} synthetic={!!db?.manifest.synthetic} />}
      {sheet === 'areas' && (
        <AreaListSheet
          onClose={() => setSheet(null)}
          all={selectables}
          counts={areaCounts}
          selected={sel}
          onToggle={(id) => { toggleArea(id); if (!state.multi && !sel.includes(id)) setSheet(null) }}
          atlasTitle={atlasCard.title}
        />
      )}
    </div>
  )
}

const placedInWords: Record<AtlasId, string> = { dk: 'a Desikan–Killiany area', destrieux: 'a Destrieux area', yeo7: 'a Yeo network' }

/** today's date where the reader is, as yyyy-mm-dd */
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Stanford's global footer links, in Stanford's order, as on www.stanford.edu (19 Oct 2026) */
const STANFORD_FOOTER: [string, string][] = [
  ['Stanford Home', 'https://www.stanford.edu/'],
  ['Maps & Directions', 'https://visit.stanford.edu/basics'],
  ['Search Stanford', 'https://www.stanford.edu/search'],
  ['Emergency Info', 'https://emergency.stanford.edu'],
  ['Terms of Use', 'https://www.stanford.edu/terms'],
  ['Privacy', 'https://www.stanford.edu/privacy'],
  ['Copyright', 'https://uit.stanford.edu/security/copyright-infringement'],
  ['Trademarks', 'https://adminguide.stanford.edu/chapter-1/subchapter-5/policy-1-5-4'],
  ['Non-Discrimination', 'https://non-discrimination.stanford.edu/'],
  ['Accessibility', 'https://www.stanford.edu/accessibility'],
]

/** one-click starting points, shown when they exist in the loaded atlas */
const EXAMPLES: { id: string; label: string }[] = [
  { id: 'ctx:lh.insula', label: 'Left insula' },
  { id: 'ctx:rh.fusiform', label: 'Right fusiform' },
  { id: 'deep:Left-Hippocampus', label: 'Left hippocampus' },
  { id: 'ctx:lh.precentral', label: 'Left precentral' },
]
