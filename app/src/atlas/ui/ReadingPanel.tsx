import { useMemo, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { SelectionResult, SelectedRow } from '../model/selection'
import { bedsideNote, matchesQuery, patientLabel } from '../model/selection'
import { STATE_WORDS, type AtlasId, type SiteParcelRecord } from '../model/parcels'
import { sitePointMni305 } from '../model/space'
import { MIN_PEOPLE } from './Sheets'

export interface AreaView {
  id: string
  name: string
  sub: string
  color: string
  n: number
}

interface Props {
  areas: AreaView[]
  result: SelectionResult
  atlas: AtlasId
  atlasTitle: string
  parcelsBySite: ReadonlyMap<string, SiteParcelRecord>
  areaShort: (key: string) => string
  synthetic: boolean
  /** compare several areas (off: one area at a time) */
  compare: boolean
  onCompare: (on: boolean) => void
  /** the finer atlas's areas inside the one selected area, with counts; null when there are none */
  subregions: { title: string; list: { key: string; name: string; color: string; stim: number; people: number }[]; active: string | null; onClear: () => void } | null
  onRemove: (id: string) => void
  onClear: () => void
  /** phone layout: close the panel and show the brain again */
  onBack: () => void
  /** the person in focus, if any */
  person: string | null
  onPerson: (pid: string | null) => void
}

const METHOD_WORDS: Record<string, string> = {
  native: "the person's own brain scan (FreeSurfer, read by iELVis)",
  synthetic: 'the standard brain (demonstration data: no real person)',
}

function methodWords(m: string): string {
  return m.split('+').map((x) => METHOD_WORDS[x] ?? x).join('; and ')
}

function params(r: SelectedRow): string {
  const e = r.row.event
  // the person is the block's header, so a report lists only its stimulation
  const bits: string[] = []
  if (e.current_mA != null) bits.push(`${e.current_mA} mA`)
  if (e.frequency_hz != null) bits.push(`${e.frequency_hz} Hz`)
  if (e.train_duration_s != null) bits.push(`${e.train_duration_s} s`)
  return bits.join(' · ')
}

function ReportItem({ r, areas, atlas, parcelsBySite, areaShort, synthetic, sham, zero }: {
  r: SelectedRow
  areas: AreaView[]
  atlas: AtlasId
  parcelsBySite: ReadonlyMap<string, SiteParcelRecord>
  areaShort: (key: string) => string
  synthetic: boolean
  sham?: boolean
  zero?: boolean
}) {
  const [open, setOpen] = useState(false)
  const pins = areas.filter((a) => r.areas.includes(a.id))
  const rec = parcelsBySite.get(r.row.site.site_id)
  const isDeep = r.areas.every((a) => a.startsWith('deep:'))
  const entry = isDeep ? rec?.deep : rec?.[atlas]
  const p = sitePointMni305(r.row.site)
  const others = (rec?.[atlas]?.p ?? []).filter((k) => !r.areas.includes(`ctx:${k}`))
  const note = bedsideNote(r.row, synthetic)
  return (
    <li className="atlas-report">
      {r.text ? <blockquote>“{r.text}”</blockquote> : <p className="atlas-noreport">No verbal report recorded.</p>}
      <div className="meta">
        {pins.map((a) => <span key={a.id} className="atlas-pin-inline" style={{ background: a.color }}>{a.n}</span>)}
        {synthetic && <span className="atlas-tag" title="Invented demonstration text">Synthetic</span>}
        {sham && <span className="atlas-tag">Sham</span>}
        {zero && <span className="atlas-tag">Recorded at 0 mA</span>}
        {r.row.qc?.seizure_related_flag && <span className="atlas-tag" title="The release marks this stimulation as seizure-related">Seizure-related</span>}
        <span>{params(r)}</span>
        <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Less' : 'See more'}</button>
      </div>
      {open && (
        <dl className="atlas-dl">
          <dt>Stimulation</dt>
          <dd>
            {r.row.event.stimulation_protocol === 'sham' ? 'Sham (no current delivered)' : 'Electrical stimulation'}
            {r.row.event.current_mA != null ? ` · ${r.row.event.current_mA} mA` : ''}
            {r.row.event.frequency_hz != null ? ` · ${r.row.event.frequency_hz} Hz` : ''}
            {r.row.event.train_duration_s != null ? ` · ${r.row.event.train_duration_s} s` : ''}
          </dd>
          <dt>Contacts</dt>
          <dd>{r.row.site.electrode_pair} · {r.row.site.electrode_type === 'sEEG_depth' ? 'depth electrode' : r.row.site.electrode_type === 'other' ? 'electrode type not recorded' : 'surface electrode'} · {r.row.site.hemisphere === 'L' ? 'left' : 'right'} side</dd>
          <dt>Placed in area by</dt>
          <dd>{entry ? (entry.p.length ? methodWords(entry.m) : STATE_WORDS[entry.s] ?? entry.s) : 'not recorded'}</dd>
          {others.length > 0 && (<><dt>Also touches</dt><dd>{others.map(areaShort).join(', ')} (the pair straddles a boundary)</dd></>)}
          <dt>At the bedside</dt>
          <dd>{note === 'effect' ? 'The clinician entered an effect.' : note === 'none' ? 'The clinician wrote “none”.' : 'The clinician’s entry is blank, which is not the same as “none”.'}</dd>
          <dt>Pair midpoint</dt>
          <dd>
            {p ? `${p.map((v) => v.toFixed(1)).join(', ')} mm, MNI305 (fsaverage). Not a localisation: the area comes from the two contacts, and a midpoint can fall outside the brain.` : 'No common-space position.'}
            {p && r.row.site.electrode_type === 'sEEG_depth' && ' For a depth electrode it is approximate (a straight-line fit to the template).'}
          </dd>
        </dl>
      )}
    </li>
  )
}

const PEOPLE_PAGE = 12

/** One block per person: every report of theirs in the selection, together. The block's header
    selects that person (the panel narrows to them and the brain shows their electrodes). */
function List({ rows, person, onPerson, ...rest }: { rows: SelectedRow[]; person: string | null; onPerson: (pid: string | null) => void } & Omit<Parameters<typeof ReportItem>[0], 'r'>) {
  const [n, setN] = useState(PEOPLE_PAGE)
  const groups = useMemo(() => {
    const m = new Map<string, SelectedRow[]>()
    for (const r of rows) {
      const pid = r.row.event.patient_id
      if (!m.has(pid)) m.set(pid, [])
      m.get(pid)!.push(r)
    }
    return [...m]
  }, [rows])
  const shown = groups.slice(0, n)
  return (
    <>
      <ul className="atlas-people">
        {shown.map(([pid, rs]) => {
          const on = person === pid
          return (
            <li key={pid} className={`atlas-personblock${on ? ' on' : ''}`}>
              <button className="atlas-personhead" aria-pressed={on} onClick={() => onPerson(on ? null : pid)}
                title={on ? 'Show everyone again' : 'Show only this person, and their electrodes on the brain'}>
                <span className="who">{patientLabel(pid)}</span>
                <span className="n">{rs.length} {rs.length === 1 ? 'stimulation' : 'stimulations'}</span>
                <span className="act">{on ? 'Show everyone' : 'Select'}</span>
              </button>
              <ul className="atlas-reports">
                {rs.map((r) => <ReportItem key={r.row.event.event_id} r={r} {...rest} />)}
              </ul>
            </li>
          )
        })}
      </ul>
      {groups.length > n && (
        <button className="atlas-more" onClick={() => setN((x) => x + PEOPLE_PAGE)}>Show {Math.min(PEOPLE_PAGE, groups.length - n)} more people ({groups.length - n} not shown)</button>
      )}
    </>
  )
}

export function ReadingPanel(p: Props) {
  const { result, areas } = p
  const [tab, setTab] = useState<string>('all')
  const [q, setQ] = useState('')
  const [showNo, setShowNo] = useState(false)
  const [showSham, setShowSham] = useState(false)
  const [showZero, setShowZero] = useState(false)
  const [numbers, setNumbers] = useState(false)
  const selectionKey = areas.map((a) => a.id).join(',')
  const [lastKey, setLastKey] = useState(selectionKey)
  if (lastKey !== selectionKey) {
    setLastKey(selectionKey)
    if (tab !== 'all' && !areas.some((a) => a.id === tab)) setTab('all')
  }

  const inTab = (r: SelectedRow) => tab === 'all' || r.areas.includes(tab)
  const visible = useMemo(() => {
    return result.stimulations.filter((r) => inTab(r) && matchesQuery(r.text, q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, tab, q])
  const withText = visible.filter((r) => r.text)
  const without = visible.filter((r) => !r.text)
  const sham = result.sham.filter((r) => inTab(r) && matchesQuery(r.text, q))
  const zero = result.zeroCurrent.filter((r) => inTab(r) && matchesQuery(r.text, q))
  const c = result.counts
  const nAreas = areas.length
  const itemProps = { areas, atlas: p.atlas, parcelsBySite: p.parcelsBySite, areaShort: p.areaShort, synthetic: p.synthetic, person: p.person, onPerson: p.onPerson }


  return (
    <aside className="atlas-panel" id="atlas-panel" tabIndex={-1} aria-label="Selected areas and their reports">
      <button className="atlas-back" onClick={p.onBack}><ArrowLeft size={15} aria-hidden /> Back to the brain</button>
      <header className="atlas-panel-head">
        <h2>{nAreas === 1 ? areas[0].name : `${nAreas} areas`}</h2>
        <button className="link" onClick={p.onClear}>Clear</button>
      </header>
      <label className="atlas-toggle atlas-compare" title="Pick several areas and read their reports together">
        <input type="checkbox" role="switch" aria-label="Compare areas" checked={p.compare} onChange={(e) => p.onCompare(e.target.checked)} />
        <span>Compare areas</span>
      </label>
      {(p.compare || nAreas > 1) && <ul className="atlas-chips">
        {areas.map((a) => (
          <li key={a.id} className="atlas-chip">
            <span className="atlas-pin-inline" style={{ background: a.color }}>{a.n}</span>
            <span className="name" title={a.sub}>{a.name}<span className="sub">{a.sub}</span></span>
            <button aria-label={`Remove ${a.name}`} onClick={() => p.onRemove(a.id)}><X size={14} /></button>
          </li>
        ))}
      </ul>}

      <div className="atlas-population">
        {c.stimulations === 0 ? (
          <p>No stimulations were recorded in {nAreas === 1 ? 'this area' : 'these areas'}{p.subregions?.active ? ' and subregion' : ''}.</p>
        ) : (
          <p>
            <strong>{c.stimulations.toLocaleString()}</strong> stimulation{c.stimulations === 1 ? '' : 's'} in {nAreas === 1 ? 'this area' : `these ${nAreas} areas`}, from{' '}
            <strong>{c.patients.toLocaleString()}</strong> {c.patients === 1 ? 'person' : 'people'} · {c.withReport.toLocaleString()} with a recorded report
          </p>
        )}
        {c.patients > 0 && c.patients < MIN_PEOPLE && (
          <p className="atlas-few small">Fewer than {MIN_PEOPLE} people: read these as individual cases, not a pattern for the area.</p>
        )}
        {c.sham > 0 && <p className="muted">Sham trials (no current), kept apart: {c.sham.toLocaleString()}</p>}
        {c.zeroCurrent > 0 && <p className="muted">Recorded at 0 mA, kept apart: {c.zeroCurrent.toLocaleString()}</p>}
        <button className="link small" onClick={() => setNumbers((x) => !x)}>{numbers ? 'Hide details' : 'Details'}</button>
        {numbers && (
          <div className="atlas-well small">
            <p>A stimulation counts in an area when either of its two contacts lies in it, and is counted once. Sham trials and stimulations recorded at 0 mA are never counted.</p>
            {c.excluded > 0 && <p>{c.excluded.toLocaleString()} stimulation{c.excluded === 1 ? '' : 's'} at these sites {c.excluded === 1 ? 'is' : 'are'} excluded by quality control and not shown.</p>}
            {nAreas > 1 && (
              <table className="atlas-table">
                <thead><tr><th>Area</th><th>Stimulations</th><th>Sites</th><th>People</th></tr></thead>
                <tbody>
                  {result.perArea.map((b) => {
                    const a = areas.find((x) => x.id === b.id)!
                    return <tr key={b.id}><td><span className="atlas-pin-inline" style={{ background: a.color }}>{a.n}</span> {a.name}</td><td>{b.stimulations}</td><td>{b.sites}</td><td>{b.patients}</td></tr>
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {p.subregions && (() => {
        const act = p.subregions.list.find((x) => x.key === p.subregions!.active)
        return act ? (
          <div className="atlas-subsel">
            <i style={{ background: act.color }} aria-hidden />
            <span className="name">{act.name}<span className="sub">{p.subregions.title} subregion · {act.stim} stimulations · {act.people} {act.people === 1 ? 'person' : 'people'}</span></span>
            <button aria-label={`Show all of ${areas[0]?.name ?? 'the area'}`} onClick={p.subregions.onClear}><X size={14} /></button>
          </div>
        ) : (
          <p className="muted small atlas-subhint">{p.subregions.list.length} subregions of the {p.subregions.title} atlas lie in this area. Click one on the brain to read only its reports.</p>
        )
      })()}

      {c.stimulations > 0 && (
        <div className="atlas-tools">
          {nAreas > 1 && (
            <div className="atlas-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
              {areas.map((a) => (
                <button key={a.id} role="tab" aria-selected={tab === a.id} className={tab === a.id ? 'on' : ''} onClick={() => setTab(a.id)} title={a.name}>
                  <span className="atlas-pin-inline" style={{ background: a.color }}>{a.n}</span>
                </button>
              ))}
            </div>
          )}
          <input className="atlas-filter" placeholder="Search these reports" aria-label="Search these reports" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {q && <p className="atlas-note">{withText.length.toLocaleString()} report{withText.length === 1 ? '' : 's'} contain “{q}”.</p>}

      <List rows={withText} {...itemProps} />

      {without.length > 0 && !q && (
        <section className="atlas-group">
          <button className="atlas-group-head" onClick={() => setShowNo((x) => !x)} aria-expanded={showNo}>
            {without.length.toLocaleString()} stimulation{without.length === 1 ? '' : 's'} with no recorded report <span>{showNo ? 'Hide' : 'Show'}</span>
          </button>
          {showNo && <><p className="muted small">No report was transcribed for these. That is not the same as the person feeling nothing.</p><List rows={without} {...itemProps} /></>}
        </section>
      )}

      {sham.length > 0 && (
        <section className="atlas-group">
          <button className="atlas-group-head" onClick={() => setShowSham((x) => !x)} aria-expanded={showSham}>
            Sham trials, no current delivered ({sham.length.toLocaleString()}) <span>{showSham ? 'Hide' : 'Show'}</span>
          </button>
          {showSham && <><p className="muted small">The comparison condition: the same procedure with no current. These are not part of any count above.</p><List rows={sham} sham {...itemProps} /></>}
        </section>
      )}
      {zero.length > 0 && (
        <section className="atlas-group">
          <button className="atlas-group-head" onClick={() => setShowZero((x) => !x)} aria-expanded={showZero}>
            Recorded at 0 mA ({zero.length.toLocaleString()}) <span>{showZero ? 'Hide' : 'Show'}</span>
          </button>
          {showZero && <><p className="muted small">These are labelled as stimulation, but the current was recorded as 0 mA, so whether any current was delivered is unknown. They are not part of any count above.</p><List rows={zero} zero {...itemProps} /></>}
        </section>
      )}
      {p.synthetic && <p className="atlas-note">These reports are synthetic demonstration text, not anything a person said.</p>}
    </aside>
  )
}
