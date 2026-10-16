import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, FileText, Map as MapIcon, X } from 'lucide-react'
import { hemiWord, type AtlasId, type Selectable } from '../model/parcels'
import { binLabel, mixWhite, NO_DATA, type Bin } from '../model/colormap'
import { BUILD, REFERENCES, SITE, citation, viewUrl } from '../site'

/** fewer people than this in an area: its reports are individual cases, not a regional pattern
    (the MNI Open iEEG Atlas reports a region from 5 channels, F-TRACT from 5 responses) */
export const MIN_PEOPLE = 5

export const ATLAS_CARDS: { id: AtlasId; title: string; count: string; line: string }[] = [
  { id: 'dk', title: 'Desikan–Killiany', count: '34 areas per side', line: 'Areas follow the gyri (Desikan et al., 2006).' },
  { id: 'destrieux', title: 'Destrieux', count: '74 areas per side', line: 'Each gyrus and sulcus named separately (Destrieux et al., 2010).' },
  { id: 'yeo7', title: 'Yeo networks', count: '7 networks', line: 'Large-scale networks from resting-state scans of 1,000 people (Yeo et al., 2011).' },
]

/** close a popover on Escape or on a click outside it */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    // a click on the button that opened it is left to that button, which toggles it closed
    const away = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current && !ref.current.contains(t) && !t.closest?.('[data-popover-trigger]')) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => window.addEventListener('mousedown', away), 0)
    window.addEventListener('keydown', esc)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [ref, onClose])
}

export function AtlasPicker({ value, onPick, onClose }: { value: AtlasId; onPick: (a: AtlasId) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  return (
    <div className="atlas-popover" ref={ref} role="dialog" aria-label="Choose an atlas">
      <p className="muted small">An atlas divides the cortex into named areas. The deep structures are available with each.</p>
      {ATLAS_CARDS.map((c) => (
        <button key={c.id} className={`atlas-card ${c.id === value ? 'on' : ''}`} onClick={() => onPick(c.id)} aria-pressed={c.id === value}>
          <span className="title">{c.title}{c.id === value && <Check size={15} aria-hidden />}</span>
          <span className="count">{c.count}</span>
          <span className="line">{c.line}</span>
        </button>
      ))}
    </div>
  )
}

export function DownloadMenu({ reports, onReports, map, onMap, onClose }: {
  /** what the reports download contains, as a sentence */
  reports: string
  onReports: () => void
  map: 'coverage' | 'selection' | null
  onMap: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  return (
    <div className="atlas-popover atlas-menu" ref={ref} role="dialog" aria-label="Download">
      <button className="atlas-card" onClick={onReports} autoFocus>
        <span className="title"><span className="with-icon"><FileText size={15} aria-hidden /> Reports</span></span>
        <span className="line">{reports} One row per stimulation (CSV), with a README, citation files and checksums.</span>
      </button>
      <button className="atlas-card" onClick={() => map && onMap()} aria-disabled={!map} data-disabled={!map || undefined}>
        <span className="title"><span className="with-icon"><MapIcon size={15} aria-hidden /> Map</span></span>
        <span className="line">
          {map
            ? `${map === 'coverage' ? 'The coverage map' : 'The selected areas'} as a figure (PNG at 300 dpi, and SVG), a table of every area, and fsaverage surface files (GIFTI).`
            : 'Not available yet: turn on Coverage or select an area first.'}
        </span>
      </button>
    </div>
  )
}

export function CoverageLegend({ bins, reaching5, areas, faded }: { bins: Bin[]; reaching5: number; areas: number; faded?: boolean }) {
  const items = [{ color: NO_DATA, label: '0' }, ...bins.map((b) => ({ color: faded ? mixWhite(b.color, 0.6) : b.color, label: binLabel(b) }))]
  return (
    <div className="atlas-legend" role="group" aria-label="Coverage legend">
      <div className="atlas-legend-title">People stimulated per area</div>
      <div className="atlas-legend-row">
        {items.map((it) => (
          <span key={it.label} className="atlas-legend-item"><i style={{ background: it.color }} />{it.label}</span>
        ))}
      </div>
      <div className="atlas-legend-note">{reaching5} of {areas} areas have {MIN_PEOPLE} or more people{faded ? '. Faded while areas are selected.' : ''}</div>
    </div>
  )
}

/* ---- sheets ------------------------------------------------------------------------------ */

/** A side sheet: a modal dialog that takes focus when it opens and gives it back when it closes. */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('keydown', esc); back?.focus?.() }
  }, [onClose])
  return (
    <div className="atlas-sheet-backdrop" onMouseDown={onClose}>
      <article ref={ref} tabIndex={-1} className={`atlas-sheet${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title}>
        <button className="atlas-sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>{title}</h2>
        {children}
      </article>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="atlas-ghost small" onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }, () => setDone(false))
    }}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {done ? 'Copied' : label}
    </button>
  )
}

function save(name: string, type: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/* ---- About ------------------------------------------------------------------------------- */

interface Agreement { agreement: number | null; compared: number; agreement_counting_undetermined_as_miss?: number | null; disagreeing_dot_to_own_area_mm?: { median: number } | null }
interface Validation {
  site_states?: Record<string, Record<string, number>>
  people_held?: number
  people_held_by_reason?: Record<string, number>
  registered_vertex_vs_native_on_surface_contacts?: Record<'dk' | 'destrieux' | 'yeo7', Agreement> | null
}

export interface AboutTotals {
  stim: number; withReport: number; people: number; sham: number; zero: number; excluded: number
  sites: number; held: number; heldPeople: number
}

const pct = (x: number | null | undefined) => (x == null ? 'not measured' : `${Math.round(100 * x)}%`)
const n = (x: number | undefined) => (x ?? 0).toLocaleString()

const HELD_REASONS: [string, string][] = [
  ['lab_note', 'the lab’s notes question the localisation'],
  ['conflicting_localisation', 'two localisation records disagree'],
  ['contact_identity_unverified', 'which contact each coordinate belongs to is not verified'],
  ['native_localisation_missing', 'some contacts have no position in the person’s own scan'],
]

export function AboutSheet({ onClose, release, synthetic, totals, placed, placedIn, atlas, validation, onOpen, examples, onExample }: {
  onClose: () => void
  release: string
  synthetic: boolean
  totals: AboutTotals
  placed: { stim: number; people: number }
  placedIn: string
  atlas: AtlasId
  validation: Validation | null
  onOpen: (sheet: 'cite' | 'notices') => void
  examples: { id: string; label: string }[]
  onExample: (id: string) => void
}) {
  const reg = validation?.registered_vertex_vs_native_on_surface_contacts
  const st = validation?.site_states?.[atlas] ?? {}
  const reasons = validation?.people_held_by_reason ?? {}
  const held = validation?.people_held ?? 0
  return (
    <Sheet title={`About the ${SITE.name}`} onClose={onClose}>
      <div className="atlas-about">
        <p className="lede">
          What people reported when a small area of their brain was electrically stimulated, organised by the area of a published brain atlas where each stimulation took place.
          The stimulations were part of clinical monitoring for epilepsy, during which electrodes stay in the brain for one to two weeks.
        </p>
        {synthetic && <p className="atlas-well small"><strong>Demonstration data.</strong> This copy shows synthetic data. Every number, electrode position and report on it is invented and describes no one.</p>}

        <HelpBody examples={examples} onExample={onExample} />

        <h3>Data</h3>
        <table className="atlas-table atlas-about-table">
          <thead><tr><th /><th>Stimulations</th><th>People</th></tr></thead>
          <tbody>
            <tr className="em"><td>In the atlas</td><td>{n(totals.stim)}</td><td>{n(totals.people)}</td></tr>
            <tr><td className="indent">in {placedIn} or a deep structure</td><td>{n(placed.stim)}</td><td>{n(placed.people)}</td></tr>
            <tr><td className="indent">with a transcribed report</td><td>{n(totals.withReport)}</td><td /></tr>
            {totals.held > 0 && <tr><td>Held: an open question about electrode positions</td><td>{n(totals.held)}</td><td>{n(totals.heldPeople)}</td></tr>}
            <tr><td>Kept apart: sham trials (no current)</td><td>{n(totals.sham)}</td><td /></tr>
            <tr><td>Kept apart: recorded at 0 mA</td><td>{n(totals.zero)}</td><td /></tr>
            <tr><td>Excluded by quality control</td><td>{n(totals.excluded)}</td><td /></tr>
          </tbody>
        </table>
        <p className="note">Data release {release}. Every count on the page uses the first row. The other rows stay in the full download, each marked with its reason.</p>

        <h3>How a stimulation is placed in an area</h3>
        <p>
          Each contact was labelled in the person’s own MRI with FreeSurfer, read by the lab’s iELVis pipeline (Groppe et al. 2017). A stimulation passes current between two neighbouring contacts, and it counts in every area either contact lies in (Rangarajan et al. 2014; Fox et al. 2020). The download marks the pairs with both contacts inside (Duong et al. 2023), because a pair that straddles a boundary may owe its effect to the other side (Foster et al. 2017).
        </p>
        <p>
          A contact with no label, or in white matter or fluid, is in no area. No position is estimated in its place.
          {synthetic && ' In this demonstration copy the contacts are placed on the standard brain, not in anyone’s own scan.'}
        </p>
        {!synthetic && validation?.site_states && (
          <ul className="small">
            <li>{n(st.contacts_unidentified)} sites are in no area because their contacts could not be identified in the localisation records.</li>
            <li>{n(st.unlabelled)} have no label in the person’s records.</li>
            <li>{n((st.white_matter ?? 0) + (st.ventricle_csf ?? 0))} lie in white matter or fluid.</li>
            <li>{n(st.side_conflict)} have a label on the other side of the brain from the electrode.</li>
          </ul>
        )}
        {!synthetic && held > 0 && (
          <p className="small">{held} people are held back because a record questions where their electrodes are: {HELD_REASONS.filter(([k]) => reasons[k]).map(([k, w]) => `${w} (${reasons[k]})`).join('; ')}. They return when the question is resolved.</p>
        )}

        <h3>Electrodes on the brain</h3>
        <p>
          “Electrodes” shows each stimulated surface contact at the point of the standard brain its own cortical folds map to (Fischl et al. 1999).
          {reg?.dk?.agreement != null && <> For {pct(reg.dk.agreement)} of surface contacts the area under the dot is the area from the person’s own MRI; the lists always follow the person’s own MRI.</>}
          {' '}Depth electrodes are drawn inside the brain, one dot per stimulated pair, at an approximate position (a straight-line fit to the standard brain that cannot follow the folds). They show where the coverage is, not an exact location.
        </p>

        <h3>The reports</h3>
        <p>
          Reports are shown as transcribed at the bedside, without coding or categories, ordered by area, person and current. The clinician’s entry from the stimulation sheet (an effect, “none”, or blank) is in the download, not on screen. Writing “none” was routine through 2022 and had stopped by 2024, so a blank is not a “none” and the entries are never turned into a rate.
          Areas with fewer than {MIN_PEOPLE} people are marked: their reports are individual cases.
        </p>

        <h3>The brain and the atlases</h3>
        <p>
          The brain is FreeSurfer’s <em>fsaverage</em> surface, drawn as distributed. “Smooth” shows FreeSurfer’s inflated version of the same surface. The deep structures are surfaces built from fsaverage’s own segmentation.
        </p>

        <h3>Use</h3>
        <p>For research and education. Not for clinical decisions about any patient.</p>
        <ul className="small atlas-links">
          <li><button className="link" onClick={() => onOpen('cite')}>How to cite</button></li>
          <li><button className="link" onClick={() => onOpen('notices')}>Licences and third-party notices</button></li>
        </ul>
        {!synthetic && (
          <p className="atlas-well small">Controlled data, collected under {SITE.irb}. Do not share these reports, put them in public material, or paste them into any outside service.</p>
        )}

        <h3>Privacy and accessibility</h3>
        <p className="small">This site sets no cookies and collects no personal information. It aims to meet WCAG 2.1 AA; every report can be reached from the Areas list without the 3D view. To report a barrier or any other problem, <a href={SITE.issuesUrl} target="_blank" rel="noreferrer">open an issue</a>.</p>

        <h3>Made by</h3>
        <p className="small">{SITE.lab}, {SITE.department}, {SITE.institution}. Maintained by the lab; problems are answered as time allows. <a href={SITE.labUrl} target="_blank" rel="noreferrer">The lab</a> · <a href={SITE.repoUrl} target="_blank" rel="noreferrer">Source</a></p>
        {SITE.funding.length > 0 && <p className="small">Funding: {SITE.funding.join('; ')}.</p>}

        <h3>References</h3>
        <ul className="small refs">
          {Object.values(REFERENCES).map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="note">Build {BUILD.commit}{BUILD.date ? `, ${BUILD.date}` : ''}.</p>
      </div>
    </Sheet>
  )
}

/* ---- Help -------------------------------------------------------------------------------- */

export const SHORTCUTS: [string, string][] = [
  ['/', 'Find an area'],
  ['A', 'Open the list of areas'],
  ['← →', 'Turn the brain'],
  ['R', 'Reset the view'],
  ['?', 'About and help'],
  ['Esc', 'Close a panel or menu'],
]

function HelpBody({ examples, onExample }: { examples: { id: string; label: string }[]; onExample: (id: string) => void }) {
  return (
    <>
      <h3>Using the atlas</h3>
      <ol className="atlas-steps">
        <li>Click an area of the brain, find one by name, or open <strong>Areas</strong> for the full list. The view moves in on it and the rest of the brain steps back.</li>
        <li>The panel lists every stimulation in that area and what the person said. Where a finer atlas divides the area, its subregions are listed too: click one, on the brain or in the list, to read only its reports.</li>
        <li>Turn on <strong>Compare areas</strong> to read several areas together. <strong>Download</strong> gives the reports as a table, or a map figure of what is on screen.</li>
      </ol>
      {examples.length > 0 && (
        <div className="atlas-examples" role="group" aria-label="Examples">
          <span className="muted small">Try:</span>
          {examples.map((e) => <button key={e.id} className="atlas-ghost small bordered" onClick={() => onExample(e.id)}>{e.label}</button>)}
        </div>
      )}

      <h3>What the numbers mean</h3>
      <dl className="atlas-faq">
        <dt>What is counted?</dt>
        <dd>Stimulations with current delivered, from people whose electrode positions have no open question. A stimulation counts in every area either of its two contacts lies in. Sham trials, stimulations recorded at 0 mA and those excluded by quality control are listed separately and never counted.</dd>
        <dt>Why is there no percentage?</dt>
        <dd>How clinicians recorded “nothing felt” changed over the years, so the bedside entries cannot be turned into a response rate. Read the reports themselves.</dd>
        <dt>What does “no transcribed report” mean?</dt>
        <dd>Nothing was transcribed for that stimulation. It does not mean the person felt nothing.</dd>
        <dt>Why is an area empty or thin?</dt>
        <dd>Electrodes are placed for each patient’s clinical needs, so some areas were rarely or never stimulated. <strong>Coverage</strong> shows how many people were stimulated in each area. Areas with fewer than {MIN_PEOPLE} people are marked.</dd>
        <dt>Where are the electrodes?</dt>
        <dd><strong>Electrodes</strong> shows every stimulated contact: surface contacts on the cortex, depth electrodes inside it at approximate positions.</dd>
      </dl>

      <h3>Keyboard</h3>
      <table className="atlas-table atlas-keys">
        <tbody>{SHORTCUTS.map(([k, w]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{w}</td></tr>)}</tbody>
      </table>
      <p className="small">The 3D brain needs WebGL 2 (current Chrome, Edge, Firefox or Safari). Without it, the Areas list still reaches every report. The tables behind the page are static JSON files under <code>data/</code> and <code>atlas/data/</code>; for analysis, use Download.</p>
    </>
  )
}

/* ---- Cite -------------------------------------------------------------------------------- */

export function CiteSheet({ onClose, release, atlasCitation }: { onClose: () => void; release: string; atlasCitation: string }) {
  const now = useMemo(() => new Date(), [])
  const url = useMemo(() => viewUrl(), [])
  const site = useMemo(() => new URL('./', url).toString().replace(/\?.*$/, ''), [url])
  const c = citation(release, site, now)
  const view = citation(release, url, now)
  return (
    <Sheet title="How to cite" onClose={onClose}>
      <div className="atlas-about">
        <p>Cite the atlas and the data release you used{SITE.paper ? ', and the paper describing the data' : ''}. Cite the published atlas whose areas you used as well.</p>
        <h3>The atlas</h3>
        <blockquote className="atlas-cite">{c.text}</blockquote>
        <div className="atlas-row">
          <CopyButton text={c.text} label="Copy" />
          <button className="atlas-ghost small" onClick={() => save(`brain-atlas-${release}.bib`, 'application/x-bibtex', c.bibtex)}>BibTeX</button>
          <button className="atlas-ghost small" onClick={() => save(`brain-atlas-${release}.ris`, 'application/x-research-info-systems', c.ris)}>RIS</button>
          <button className="atlas-ghost small" onClick={() => save(`brain-atlas-${release}.json`, 'application/json', c.cslJson)}>CSL-JSON</button>
        </div>
        {SITE.paper && (<><h3>The paper</h3><blockquote className="atlas-cite">{SITE.paper.citation} doi:{SITE.paper.doi}</blockquote></>)}
        <h3>This view</h3>
        <p className="small">A link to exactly what is on screen, including the release, so it opens the same data later.</p>
        <blockquote className="atlas-cite mono">{url}</blockquote>
        <div className="atlas-row"><CopyButton text={url} label="Copy link" /><CopyButton text={view.text} label="Copy citation for this view" /></div>
        <h3>The atlas areas</h3>
        <blockquote className="atlas-cite">{atlasCitation}</blockquote>
        <p className="small">On FreeSurfer’s fsaverage: {REFERENCES.fischl}</p>
      </div>
    </Sheet>
  )
}

/* ---- Licences ------------------------------------------------------------------------------ */

export function NoticesSheet({ onClose }: { onClose: () => void }) {
  const rows: [string, string, string][] = [
    ['This site’s code', 'BSD 3-Clause', 'LICENSE.txt'],
    ['Derived and synthetic data', 'CC BY 4.0', 'LICENSE-DATA.txt'],
    ['fsaverage surfaces, segmentation, Desikan–Killiany and Destrieux labels (FreeSurfer; converted and therefore modified)', 'FreeSurfer Software License', 'NOTICE.txt'],
    ['Yeo 7-network labels on fsaverage (distributed with FreeSurfer)', 'FreeSurfer Software License', 'NOTICE.txt'],
    ['three.js, three-mesh-bvh, React, React DOM', 'MIT', 'NOTICE.txt'],
    ['Lucide icons', 'ISC', 'NOTICE.txt'],
    ['IBM Plex Sans, Source Serif 4', 'SIL Open Font License 1.1', 'NOTICE.txt'],
  ]
  return (
    <Sheet title="Licences and notices" onClose={onClose}>
      <div className="atlas-about">
        <table className="atlas-table">
          <thead><tr><th>Component</th><th>Terms</th><th>Text</th></tr></thead>
          <tbody>{rows.map(([w, t, f]) => <tr key={w}><td>{w}</td><td>{t}</td><td><a href={`./${f}`} target="_blank" rel="noreferrer">{f}</a></td></tr>)}</tbody>
        </table>
        <p className="small">FreeSurfer’s licence states that clinical applications are neither recommended nor advised, and that the software is provided for research. This site follows the same terms.</p>
        <p className="small">Patient-derived data are not licensed by any of these files. Real data were collected under {SITE.irb}; access is governed by that protocol.</p>
      </div>
    </Sheet>
  )
}

/* ---- the list of areas (every report without the 3D view) ----------------------------------- */

export function AreaListSheet({ onClose, all, counts, selected, onToggle, atlasTitle }: {
  onClose: () => void
  all: readonly Selectable[]
  counts: ReadonlyMap<string, { stim: number; people: number }>
  selected: readonly string[]
  onToggle: (id: string) => void
  atlasTitle: string
}) {
  const [q, setQ] = useState('')
  const [side, setSide] = useState<'all' | 'lh' | 'rh'>('all')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...all]
      .filter((a) => (side === 'all' || a.hemisphere === side) && (!s || `${a.name} ${a.short} ${a.group ?? ''}`.toLowerCase().includes(s)))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'cortex' ? -1 : 1) || a.name.localeCompare(b.name) || (a.hemisphere ?? '').localeCompare(b.hemisphere ?? ''))
  }, [all, q, side])
  const chosen = new Set(selected)
  return (
    <Sheet title={`Areas · ${atlasTitle}`} onClose={onClose} wide>
      <p className="small muted">Every area of the atlas and the deep structures, with how many stimulations and people each holds. Choose up to eight; their reports open beside the brain.</p>
      <div className="atlas-row">
        <input className="atlas-filter grow" placeholder="Filter areas" aria-label="Filter areas" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="atlas-seg" role="group" aria-label="Side">
          {(['all', 'lh', 'rh'] as const).map((k) => (
            <button key={k} aria-pressed={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>{k === 'all' ? 'Both' : k === 'lh' ? 'Left' : 'Right'}</button>
          ))}
        </div>
      </div>
      <ul className="atlas-arealist" aria-label="All areas">
        {rows.map((a) => {
          const c = counts.get(a.id)
          const thin = (c?.people ?? 0) > 0 && (c?.people ?? 0) < MIN_PEOPLE
          return (
            <li key={a.id}>
              <button aria-pressed={chosen.has(a.id)} className={chosen.has(a.id) ? 'on' : ''} onClick={() => onToggle(a.id)} disabled={!c?.stim && !chosen.has(a.id)}>
                <span className="name">{a.name}<span className="sub">{[hemiWord(a.hemisphere), a.kind === 'deep' ? 'deep structure' : ''].filter(Boolean).join(' · ')}</span></span>
                <span className="nums">{c?.stim ? `${c.stim.toLocaleString()} stimulations · ${c.people} ${c.people === 1 ? 'person' : 'people'}` : 'No stimulation'}{thin && <span className="atlas-tag" title={`Fewer than ${MIN_PEOPLE} people`}>few people</span>}</span>
                {chosen.has(a.id) && <Check size={15} aria-hidden />}
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
