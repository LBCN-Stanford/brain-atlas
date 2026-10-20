/* The whole view lives in the URL query, so copying the address bar shares exactly what is on
   screen: release, atlas, areas (in pick order), camera preset, smooth, electrodes, coverage,
   see-through. The page itself is always the site root; links from before the query (state in
   the hash) and links into the earlier app (#/overview, #/brain3d, ...) still open, the first on
   the view they name and the second on the default view. */

import { ATLAS_IDS, type AtlasId } from './parcels'

export type ViewName = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back' | 'insideL' | 'insideR'
const VIEWS: readonly ViewName[] = ['left', 'right', 'top', 'bottom', 'front', 'back', 'insideL', 'insideR']

export const MAX_AREAS = 8

export interface ViewState {
  atlas: AtlasId
  sel: string[]
  view: ViewName
  smooth: boolean
  dots: boolean
  /** the Opacity slider as the reader set it (0 = solid); null when they never moved it, so the
      automatic fade applies. A solid cortex chosen by hand is kept in the link too (L7) */
  see: number | null
  /** which pairs a selection counts: either contact inside (default) or both */
  pairs: 'either' | 'both'
  /** colour every area by how many people were stimulated there */
  cov: boolean
  /** compare several areas at once (off: a new pick replaces the selection) */
  multi: boolean
  /** a subregion of the selected area, by the finer atlas's key */
  sub: string | null
  /** experience search: the brain shows where people's reports contain these words */
  say: string | null
}

export const DEFAULT_STATE: ViewState = { atlas: 'dk', sel: [], view: 'left', smooth: false, dots: false, see: null, pairs: 'either', cov: false, multi: false, sub: null, say: null }

/** the parameters of a query or hash string, with or without its leading '?' or '#' */
function params(s: string): URLSearchParams {
  const body = s.replace(/^[?#]/, '')
  // a route of the earlier app (#/overview, #/site/x) carries no atlas state
  return new URLSearchParams(body.startsWith('/') ? '' : body)
}

export function parseHash(hash: string): ViewState {
  const q = params(hash)
  const atlas = q.get('atlas') as AtlasId | null
  const view = q.get('view') as ViewName | null
  const see = Number(q.get('see'))
  return {
    atlas: atlas && ATLAS_IDS.includes(atlas) ? atlas : DEFAULT_STATE.atlas,
    // well-formed and de-duplicated here; whether an id names an area of the loaded atlas, and the
    // MAX_AREAS cap, are applied by the app once the atlas is known (normaliseSelection) -- capping
    // first let unknown ids crowd out real ones (code review, 10 Oct)
    sel: [...new Set((q.get('sel') ?? '').split(',').map((s) => s.trim()).filter((s) => /^(ctx|deep):[\w.\-&+]+$/.test(s)))].slice(0, 64),
    view: view && VIEWS.includes(view) ? view : DEFAULT_STATE.view,
    smooth: q.get('smooth') === '1',
    dots: q.get('dots') === '1',
    see: q.has('see') && Number.isFinite(see) ? Math.min(1, Math.max(0, see)) : null,
    pairs: q.get('pairs') === 'both' ? 'both' : 'either',
    cov: q.get('map') === 'coverage',
    multi: q.get('compare') === '1',
    sub: /^(lh|rh)\.[\w.\-&+]+$/.test(q.get('sub') ?? '') ? q.get('sub') : null,
    say: /^[A-Za-z' -]{2,40}$/.test(q.get('say') ?? '') ? q.get('say')!.trim() : null,
  }
}

export function toHash(s: ViewState): string {
  const q = new URLSearchParams()
  q.set('atlas', s.atlas)
  if (s.sel.length) q.set('sel', s.sel.join(','))
  if (s.view !== 'left') q.set('view', s.view)
  if (s.smooth) q.set('smooth', '1')
  if (s.dots) q.set('dots', '1')
  if (s.see != null) q.set('see', s.see.toFixed(2))
  if (s.pairs === 'both') q.set('pairs', 'both')
  if (s.cov) q.set('map', 'coverage')
  if (s.multi) q.set('compare', '1')
  if (s.sub) q.set('sub', s.sub)
  if (s.say) q.set('say', s.say)
  return '#' + q.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',')
}

/** The state for a location: the query when it carries any atlas state, else a legacy hash. */
export function parseLocation(search: string, hash: string): ViewState {
  const q = params(search)
  return parseHash([...q.keys()].some((k) => STATE_KEYS.has(k)) ? search : hash)
}

const STATE_KEYS = new Set(['atlas', 'sel', 'view', 'smooth', 'dots', 'see', 'pairs', 'map', 'compare', 'sub', 'say'])

/** The release a link was made on, if it names one. */
export function linkRelease(search: string, hash: string): string | null {
  return params(search).get('release') ?? params(hash).get('release')
}

/** The query for a state, release first so a cited link always says which data it shows. */
export function toSearch(s: ViewState, release: string | null): string {
  const q = new URLSearchParams()
  if (release) q.set('release', release)
  for (const [k, v] of new URLSearchParams(toHash(s).slice(1))) q.set(k, v)
  return '?' + q.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',')
}

/** Known ids only, each once, in pick order, at most MAX_AREAS. */
export function normaliseSelection(sel: readonly string[], known: (id: string) => boolean): string[] {
  return [...new Set(sel)].filter(known).slice(0, MAX_AREAS)
}

/** Colour slots stick to their area while it is selected; a freed slot goes to the next pick. */
export function assignSlots(sel: readonly string[], previous: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  const used = new Set<number>()
  for (const id of sel) {
    const p = previous.get(id)
    if (p !== undefined && !used.has(p)) {
      out.set(id, p)
      used.add(p)
    }
  }
  for (const id of sel) {
    if (out.has(id)) continue
    let k = 0
    while (used.has(k)) k++
    out.set(id, k)
    used.add(k)
  }
  return out
}

/** Design brief C5: eight colours checked under simulated colour-vision deficiency; numbers carry identity too. */
export const PALETTE = ['#3775B2', '#C48334', '#1FA28F', '#8E3B6E', '#7A8AE0', '#AE5768', '#857030', '#375E35'] as const
