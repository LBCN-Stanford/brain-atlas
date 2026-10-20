import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { Selectable } from '../model/parcels'
import { hemiWord } from '../model/parcels'

/* Plain-language entry points to areas whose atlas names are not plain. Each word maps to the
   atlas areas it should surface, BY KEY, per atlas (annotation names; deep structures by aseg name):
   a free-text alias matched by substring offered pars triangularis for "angular" and precuneus for
   "cuneus", missed the central sulcus for "motor" in Destrieux, and found nothing for "broca" in
   Destrieux or "basal ganglia" anywhere (validation of 16 Oct, L3). Nothing here assigns anatomy;
   it only helps find it, and the classical terms are offered as starting points, not as claims
   that an area IS Broca's or Wernicke's. */
const ALIASES: Record<string, { dk?: string[]; destrieux?: string[]; yeo7?: string[]; deep?: string[] }> = {
  broca: { dk: ['parsopercularis', 'parstriangularis'], destrieux: ['G_front_inf-Opercular', 'G_front_inf-Triangul'] },
  wernicke: { dk: ['superiortemporal', 'bankssts'], destrieux: ['G_temp_sup-Plan_tempo', 'G_temp_sup-Lateral'] },
  motor: { dk: ['precentral', 'paracentral'], destrieux: ['G_precentral', 'S_central', 'G_and_S_paracentral'], yeo7: ['7Networks_2'] },
  sensory: { dk: ['postcentral', 'paracentral'], destrieux: ['G_postcentral', 'S_central', 'S_postcentral', 'G_and_S_paracentral'], yeo7: ['7Networks_2'] },
  touch: { dk: ['postcentral'], destrieux: ['G_postcentral', 'S_central', 'S_postcentral'], yeo7: ['7Networks_2'] },
  vision: { dk: ['pericalcarine', 'cuneus', 'lingual', 'lateraloccipital'], destrieux: ['S_calcarine', 'G_cuneus', 'G_oc-temp_med-Lingual', 'Pole_occipital', 'G_occipital_middle', 'G_occipital_sup'], yeo7: ['7Networks_1'] },
  hearing: { dk: ['transversetemporal', 'superiortemporal'], destrieux: ['G_temp_sup-G_T_transv', 'S_temporal_transverse', 'G_temp_sup-Plan_tempo'] },
  face: { dk: ['fusiform'], destrieux: ['G_oc-temp_lat-fusifor'] },
  memory: { dk: ['parahippocampal', 'entorhinal'], destrieux: ['G_oc-temp_med-Parahip'], deep: ['Hippocampus'] },
  angular: { dk: ['inferiorparietal'], destrieux: ['G_pariet_inf-Angular'] },
  emotion: { dk: ['insula', 'rostralanteriorcingulate', 'caudalanteriorcingulate'], destrieux: ['G_insular_short', 'G_Ins_lg_and_S_cent_ins', 'G_and_S_cingul-Ant'], deep: ['Amygdala'] },
  'basal ganglia': { deep: ['Caudate', 'Putamen', 'Pallidum', 'Accumbens-area'] },
  striatum: { deep: ['Caudate', 'Putamen', 'Accumbens-area'] },
  pallidum: { deep: ['Pallidum'] },
}

const SIDES: Record<string, 'lh' | 'rh'> = { left: 'lh', right: 'rh', l: 'lh', r: 'rh' }
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
/** the area's own name for an alias: its annotation name, or its aseg name without the side */
const own = (x: Selectable) => (x.kind === 'deep' ? x.key.replace(/^(Left|Right)-/, '') : x.key.split('.').slice(1).join('.'))

export function searchSelectables(all: readonly Selectable[], q: string, limit = 8): Selectable[] {
  let s = norm(q)
  if (!s) return []
  // a side word filters by hemisphere: "left insula"
  let side: 'lh' | 'rh' | null = null
  const first = s.split(' ')[0]
  if (SIDES[first] && s.includes(' ')) { side = SIDES[first]; s = s.slice(first.length + 1) }
  const alias = ALIASES[s]
  const scored: { x: Selectable; score: number }[] = []
  for (const x of all) {
    if (side && x.hemisphere !== side) continue
    const hay = norm(`${x.name} ${x.short} ${x.long ?? ''} ${x.group ?? ''} ${x.key} ${hemiWord(x.hemisphere)}`)
    const words = hay.split(/[\s,()/-]+/)
    let score = 0
    if (norm(x.short) === s || norm(x.name) === s) score = 100
    else if (norm(x.name).startsWith(s)) score = 80
    else if (alias && (alias[x.kind === 'deep' ? 'deep' : atlasOf(x)] ?? []).includes(own(x))) score = 70
    else if (hay.includes(` ${s}`) || hay.startsWith(s) || words.some((w) => w.startsWith(s))) score = 60
    if (score) scored.push({ x, score })
  }
  scored.sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name) || (a.x.hemisphere ?? '').localeCompare(b.x.hemisphere ?? ''))
  return scored.slice(0, limit).map((r) => r.x)
}

/** which atlas a cortical selectable belongs to, from its key's annotation name */
function atlasOf(x: Selectable): 'dk' | 'destrieux' | 'yeo7' {
  const nm = own(x)
  if (/^7Networks_/.test(nm)) return 'yeo7'
  if (/^(G_|S_|Lat_Fis|Pole_|G_and_S)/.test(nm)) return 'destrieux'
  return 'dk'
}

interface Props {
  all: readonly Selectable[]
  counts: ReadonlyMap<string, { stim: number; people: number }>
  onPick: (id: string) => void
  /** experience search: show where people's reports contain the typed words */
  onSay?: (q: string) => void
}

export function SearchBox({ all, counts, onPick, onSay }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchSelectables(all, q), [all, q])
  const sayable = !!onSay && /^[A-Za-z' -]{2,40}$/.test(q.trim()) && q.trim().replace(/[^A-Za-z]/g, '').length >= 2
  const rows = hits.length + (sayable ? 1 : 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (x: Selectable) => {
    onPick(x.id)
    setQ('')
    setOpen(false)
    setCursor(0)
  }
  const say = () => {
    onSay?.(q.trim())
    setQ('')
    setOpen(false)
    setCursor(0)
  }

  return (
    <div className="atlas-search">
      <Search size={16} aria-hidden className="atlas-search-icon" />
      <input
        ref={input}
        value={q}
        placeholder="Find a brain area…"
        aria-label="Find a brain area"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && rows > 0}
        aria-controls="atlas-search-results"
        aria-activedescendant={open && rows > 0 ? `atlas-search-opt-${cursor}` : undefined}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setCursor(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
          else if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor])
          else if (e.key === 'Enter' && sayable && cursor === hits.length) say()
          else if (e.key === 'Escape') { setQ(''); input.current?.blur() }
        }}
      />
      {open && rows > 0 && (
        <ul className="atlas-search-results" role="listbox" id="atlas-search-results" aria-label="Areas and words">
          {hits.map((x, i) => {
            const c = counts.get(x.id)
            return (
              <li key={x.id} id={`atlas-search-opt-${i}`} role="option" aria-selected={i === cursor} className={i === cursor ? 'active' : ''} onMouseDown={() => pick(x)} onMouseEnter={() => setCursor(i)}>
                <span className="name">{x.name}</span>
                <span className="sub">
                  {hemiWord(x.hemisphere)}
                  {x.short.toLowerCase() !== x.name.toLowerCase() ? ` · ${x.short}` : ''}
                  {' · '}
                  {c && c.stim ? `${c.stim.toLocaleString()} stimulation${c.stim === 1 ? '' : 's'}` : 'no stimulation'}
                </span>
              </li>
            )
          })}
          {sayable && (
            <li id={`atlas-search-opt-${hits.length}`} role="option" aria-selected={cursor === hits.length} className={`atlas-search-say${cursor === hits.length ? ' active' : ''}`} onMouseDown={say} onMouseEnter={() => setCursor(hits.length)}>
              <span className="name">Where did people say “{q.trim()}”?</span>
              <span className="sub">Show on the brain where reports contain these words</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
