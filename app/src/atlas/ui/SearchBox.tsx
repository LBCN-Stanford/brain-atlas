import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { Selectable } from '../model/parcels'
import { hemiWord } from '../model/parcels'

/* Plain-language entry points to areas whose atlas names are not plain. Each maps a word people
   use to the atlas names it should surface; nothing here assigns anatomy, it only helps find it. */
const SYNONYMS: Record<string, string[]> = {
  broca: ['pars opercularis', 'pars triangularis', 'area 44', 'area 45'],
  motor: ['precentral', 'primary motor', 'premotor'],
  sensory: ['postcentral', 'somatosensory', 'area 1', 'area 2', 'area 3'],
  touch: ['postcentral', 'somatosensory'],
  vision: ['visual', 'calcarine', 'pericalcarine', 'occipital', 'lingual', 'cuneus'],
  hearing: ['auditory', 'transverse temporal', 'heschl'],
  face: ['fusiform', 'face'],
  memory: ['hippocampus', 'parahippocampal', 'entorhinal'],
  angular: ['angular', 'inferior parietal'],
  emotion: ['amygdala', 'insula', 'cingulate'],
}

export function searchSelectables(all: readonly Selectable[], q: string, limit = 8): Selectable[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const terms = [s, ...(SYNONYMS[s] ?? [])]
  const scored: { x: Selectable; score: number }[] = []
  for (const x of all) {
    const hay = `${x.name} ${x.short} ${x.long ?? ''} ${x.group ?? ''} ${hemiWord(x.hemisphere)}`.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (x.short.toLowerCase() === t) score = Math.max(score, 100)
      else if (x.name.toLowerCase().startsWith(t)) score = Math.max(score, 80)
      else if (hay.includes(t)) score = Math.max(score, t === s ? 60 : 40)
    }
    if (score) scored.push({ x, score })
  }
  scored.sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name) || (a.x.hemisphere ?? '').localeCompare(b.x.hemisphere ?? ''))
  return scored.slice(0, limit).map((r) => r.x)
}

interface Props {
  all: readonly Selectable[]
  counts: ReadonlyMap<string, { stim: number; people: number }>
  onPick: (id: string) => void
}

export function SearchBox({ all, counts, onPick }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchSelectables(all, q), [all, q])

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

  return (
    <div className="atlas-search">
      <Search size={16} aria-hidden className="atlas-search-icon" />
      <input
        ref={input}
        value={q}
        placeholder="Find a brain area…"
        aria-label="Find a brain area"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setCursor(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
          else if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor])
          else if (e.key === 'Escape') { setQ(''); input.current?.blur() }
        }}
      />
      {open && hits.length > 0 && (
        <ul className="atlas-search-results" role="listbox">
          {hits.map((x, i) => {
            const c = counts.get(x.id)
            return (
              <li key={x.id} role="option" aria-selected={i === cursor} className={i === cursor ? 'active' : ''} onMouseDown={() => pick(x)} onMouseEnter={() => setCursor(i)}>
                <span className="name">{x.name}</span>
                <span className="sub">
                  {hemiWord(x.hemisphere)}
                  {x.short !== x.name ? ` · ${x.short}` : ''}
                  {' · '}
                  {c && c.stim ? `${c.stim.toLocaleString()} stimulations` : 'no stimulation here yet'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
