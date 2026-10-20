import { useMemo, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { SelectionResult, SelectedRow } from '../model/selection'
import { bedsideNote, matchesQuery, patientLabel, wordTerms } from '../model/selection'
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
  /** an area's name with its side, by id ('ctx:lh.insula', 'deep:Left-Amygdala') */
  areaLabel: (id: string) => string
  synthetic: boolean
  /** the pair rule the counts use */
  pairs: 'either' | 'both'
  /** people in the selection before any part or person filter: the few-people warning is about
      the area, not about what a filter leaves (M2) */
  fullPatients: number
  /** experience search: the reports filter starts on this text, and follows it when it changes */
  query?: string | null
  /** compare several areas (off: one area at a time) */
  compare: boolean
  onCompare: (on: boolean) => void
  /** the finer atlas's areas inside the one selected area, with counts; null when there are none.
      `outside`: the area's stimulations in no listed part (parts under 3% of the area are not
      listed); `overlap`: a pair can be in two parts, so the parts' counts can sum to more */
  subregions: {
    title: string
    list: { key: string; name: string; color: string; stim: number; people: number }[]
    active: string | null
    onPick: (key: string) => void
    onClear: () => void
    outside: number
    overlap: boolean
  } | null
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

function ReportItem({ r, areas, atlas, parcelsBySite, areaLabel, synthetic, sham, zero }: {
  r: SelectedRow
  areas: AreaView[]
  atlas: AtlasId
  parcelsBySite: ReadonlyMap<string, SiteParcelRecord>
  areaLabel: (id: string) => string
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
  // every other area or deep structure the pair's contacts lie in: the effect may owe to that side
  // (Foster and Parvizi 2017), and a deep structure was never named here (M16)
  const others = [...(rec?.[atlas]?.p ?? []).map((k) => `ctx:${k}`), ...(rec?.deep?.p ?? []).map((k) => `deep:${k}`)]
    .filter((id) => !r.areas.includes(id))
  const note = bedsideNote(r.row, synthetic)
  return (
    <li className="atlas-report">
      {r.text ? <blockquote>“{r.text}”</blockquote> : <p className="atlas-noreport">No verbal report recorded.</p>}
      <div className="meta">
        {pins.map((a) => <span key={a.id} className="atlas-pin-inline" style={{ background: a.color }}>{a.n}</span>)}
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
          {others.length > 0 && (<><dt>Also touches</dt><dd>{others.map(areaLabel).join(', ')} (the pair straddles a boundary)</dd></>)}
          <dt>At the bedside</dt>
          <dd>{note === 'effect' ? 'The clinician entered an effect.' : note === 'none' ? 'The clinician wrote “none”.' : 'The clinician’s entry is blank, which is not the same as “none”.'}</dd>
          <dt>Pair midpoint</dt>
          <dd>
            {p ? `${p.map((v) => v.toFixed(1)).join(', ')} mm, MNI305 (fsaverage). Not a localisation: the area comes from the contacts, and a midpoint can fall outside the brain.` : 'No common-space position.'}
            {p && r.row.site.electrode_type === 'sEEG_depth' && ' For a depth electrode it is approximate (a straight-line fit to the template).'}
          </dd>
        </dl>
      )}
    </li>
  )
}

const PEOPLE_PAGE = 12

/** The sham explorer: for each person, their sham trials beside their real stimulations at the
    same contact pairs, so a reader can compare what one person said with and without current.
    A reading aid with no statistic: the release's own comparison of sham and real stimulation is a
    validation question for the dataset, not a number this panel computes. */
function ShamSideBySide({ shamRows: sham, realRows: real, person, onPerson, ...rest }: { shamRows: SelectedRow[]; realRows: SelectedRow[]; person: string | null; onPerson: (pid: string | null) => void } & Omit<Parameters<typeof ReportItem>[0], 'r' | 'sham' | 'zero'>) {
  const people = useMemo(() => {
    const m = new Map<string, { sham: SelectedRow[]; real: SelectedRow[] }>()
    for (const r of sham) {
      const pid = r.row.event.patient_id
      if (!m.has(pid)) m.set(pid, { sham: [], real: [] })
      m.get(pid)!.sham.push(r)
    }
    for (const [pid, g] of m) {
      const sites = new Set(g.sham.map((r) => r.row.site.site_id))
      g.real = real.filter((r) => r.row.event.patient_id === pid && sites.has(r.row.site.site_id))
    }
    return [...m]
  }, [sham, real])
  const realTotal = people.reduce((n, [, g]) => n + g.real.length, 0)
  return (
    <>
      <p className="muted small">{people.length} {people.length === 1 ? 'person' : 'people'}: {sham.length} sham {sham.length === 1 ? 'trial' : 'trials'}, and {realTotal} real {realTotal === 1 ? 'stimulation' : 'stimulations'} by the same {people.length === 1 ? 'person' : 'people'} at the same contacts.</p>
      <ul className="atlas-people">
        {people.map(([pid, g]) => (
          <li key={pid} className={`atlas-personblock${person === pid ? ' on' : ''}`}>
            <button className="atlas-personhead" aria-pressed={person === pid} onClick={() => onPerson(person === pid ? null : pid)}>
              <span className="who">{patientLabel(pid)}</span>
              <span className="n">{g.sham.length} sham · {g.real.length} real</span>
              <span className="act">{person === pid ? 'Show everyone' : 'Select'}</span>
            </button>
            <div className="atlas-shamcmp">
              <div><p className="atlas-shamhead">Sham, no current</p><ul className="atlas-reports">{g.sham.map((r) => <ReportItem key={r.row.event.event_id} r={r} sham {...rest} />)}</ul></div>
              <div><p className="atlas-shamhead">Real stimulation, same contacts</p>{g.real.length ? <ul className="atlas-reports">{g.real.map((r) => <ReportItem key={r.row.event.event_id} r={r} {...rest} />)}</ul> : <p className="muted small">None in these areas.</p>}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** One block per person: every report of theirs in the selection, together. The block's header
    selects that person (the panel narrows to them and the brain shows their electrodes). */
function List({ rows, person, onPerson, reported, ...rest }: { rows: SelectedRow[]; person: string | null; onPerson: (pid: string | null) => void; reported?: boolean } & Omit<Parameters<typeof ReportItem>[0], 'r'>) {
  // the person header counts what this list holds: a sham list holds sham trials, not stimulations
  const noun = (k: number) => rest.sham ? `sham trial${k === 1 ? '' : 's'}` : rest.zero ? `trial${k === 1 ? '' : 's'} at 0 mA`
    : reported === true ? 'with a report' : reported === false ? 'without a report' : `stimulation${k === 1 ? '' : 's'}`
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
                <span className="n">{rs.length} {noun(rs.length)}</span>
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
  const [partsOpen, setPartsOpen] = useState(false)
  const [q, setQ] = useState(p.query ?? '')
  const [lastQuery, setLastQuery] = useState(p.query ?? null)
  if ((p.query ?? null) !== lastQuery) {
    setLastQuery(p.query ?? null)
    setQ(p.query ?? '')
  }
  const [showNo, setShowNo] = useState(false)
  const [showSham, setShowSham] = useState(false)
  const [shamSide, setShamSide] = useState(false)
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
  const itemProps = { areas, atlas: p.atlas, parcelsBySite: p.parcelsBySite, areaLabel: p.areaLabel, synthetic: p.synthetic, person: p.person, onPerson: p.onPerson }
  // what the counts below cover: the area(s), or one part of the area, and possibly one person.
  // Worded from the active filter, so a narrowed number is never presented as the area's (M2)
  const part = p.subregions?.list.find((x) => x.key === p.subregions!.active) ?? null
  const scope = part ? `this part (${part.name})` : nAreas === 1 ? 'this area' : `these ${nAreas} areas`
  const who = p.person ? patientLabel(p.person) : null


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
        {who && (
          <p className="atlas-narrow small">Showing one person: {who}. <button className="link" onClick={() => p.onPerson(null)}>Show everyone</button></p>
        )}
        {c.stimulations === 0 ? (
          <p>{who ? `No stimulations from ${who} in ${scope}.` : `No stimulations were recorded in ${scope}.`}</p>
        ) : (
          <p>
            <strong>{c.stimulations.toLocaleString()}</strong> stimulation{c.stimulations === 1 ? '' : 's'} in {scope}, {who ? <>all from {who}</> : <>from{' '}
            <strong>{c.patients.toLocaleString()}</strong> {c.patients === 1 ? 'person' : 'people'}</>} · {c.withReport.toLocaleString()} with a recorded report
          </p>
        )}
        {p.fullPatients > 0 && p.fullPatients < MIN_PEOPLE && (
          <p className="atlas-few small">Fewer than {MIN_PEOPLE} people: read these as individual cases, not a pattern for the area.</p>
        )}
        {c.sham > 0 && <p className="muted">Sham trials (no current), kept apart: {c.sham.toLocaleString()}</p>}
        {c.zeroCurrent > 0 && <p className="muted">Recorded at 0 mA, kept apart: {c.zeroCurrent.toLocaleString()}</p>}
        <button className="link small" onClick={() => setNumbers((x) => !x)}>{numbers ? 'Hide details' : 'Details'}</button>
        {numbers && (
          <div className="atlas-well small">
            {p.pairs === 'both'
              ? <p>The stricter rule: a stimulation counts only when every contact it passed current through lies inside the selected areas (one contact, for a monopolar site), and is counted once.{nAreas > 1 && ' In the table each area is judged on its own, as on the map, so a pair with one contact in each area counts in the total above and in neither row.'} Sham trials and stimulations recorded at 0 mA are never counted.</p>
              : <p>A stimulation counts in an area when one of its contacts lies in it, and is counted once. Sham trials and stimulations recorded at 0 mA are never counted.</p>}
            {c.excluded > 0 && <p>{c.excluded.toLocaleString()} trial{c.excluded === 1 ? '' : 's'} at these sites {c.excluded === 1 ? 'is' : 'are'} excluded by quality control and not shown.</p>}
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
        const sr = p.subregions
        const act = sr.list.find((x) => x.key === sr.active)
        return (
          <>
            {act ? (
              <div className="atlas-subsel">
                <i style={{ background: act.color }} aria-hidden />
                <span className="name">{act.name}<span className="sub">Part of {areas[0]?.name} · {act.stim} stimulation{act.stim === 1 ? '' : 's'} · {act.people} {act.people === 1 ? 'person' : 'people'}</span></span>
                <button aria-label={`Show all of ${areas[0]?.name ?? 'the area'}`} onClick={sr.onClear}><X size={14} /></button>
              </div>
            ) : (
              <p className="muted small atlas-subhint">
                {sr.list.length} parts ({sr.title}). Pick one on the brain, or{' '}
                <button className="link small" onClick={() => setPartsOpen((o) => !o)} aria-expanded={partsOpen}>{partsOpen ? 'hide the list' : 'list them'}</button>.
              </p>
            )}
            {/* the list is the path that needs no 3D and no pointer: some parts have no clickable
                pixel in the framed view (M17) */}
            {(partsOpen || act) && (
              <div className="atlas-subs">
                <ul aria-label={`Parts of ${areas[0]?.name ?? 'the area'}`}>
                  {sr.list.map((x) => (
                    <li key={x.key}>
                      <button className={x.key === sr.active ? 'on' : ''} aria-pressed={x.key === sr.active} disabled={!x.stim && x.key !== sr.active} onClick={() => (x.key === sr.active ? sr.onClear() : sr.onPick(x.key))}>
                        <i style={{ background: x.color }} aria-hidden /><span>{x.name}</span><span className="n">{x.stim ? x.stim.toLocaleString() : 'none'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {/* what the parts do not add up to, said once, where the parts are listed */}
                {(sr.outside > 0 || sr.overlap) && (
                  <p className="muted small atlas-subnote">
                    {sr.outside > 0 && `${sr.outside.toLocaleString()} of the area's stimulations ${sr.outside === 1 ? 'is' : 'are'} in no listed part (parts under 3% of the area are not listed).`}
                    {sr.overlap && `${sr.outside > 0 ? ' ' : ''}A pair can lie in two parts.`}
                  </p>
                )}
              </div>
            )}
          </>
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

      {q.trim() && <p className="atlas-note">{withText.length.toLocaleString()} report{withText.length === 1 ? ' matches' : 's match'} “{q.trim()}”{wordTerms(q).length ? '' : ' (anywhere in the text)'}.</p>}

      <List rows={withText} reported {...itemProps} />

      {without.length > 0 && !q && (
        <section className="atlas-group">
          <button className="atlas-group-head" onClick={() => setShowNo((x) => !x)} aria-expanded={showNo}>
            {without.length.toLocaleString()} stimulation{without.length === 1 ? '' : 's'} with no recorded report <span>{showNo ? 'Hide' : 'Show'}</span>
          </button>
          {showNo && <><p className="muted small">No report was transcribed for these. That is not the same as the person feeling nothing.</p><List rows={without} reported={false} {...itemProps} /></>}
        </section>
      )}

      {sham.length > 0 && (
        <section className="atlas-group">
          <button className="atlas-group-head" onClick={() => setShowSham((x) => !x)} aria-expanded={showSham}>
            Sham trials, no current delivered ({sham.length.toLocaleString()}) <span>{showSham ? 'Hide' : 'Show'}</span>
          </button>
          {showSham && <>
            <p className="muted small">The comparison condition: the same procedure with no current. These are not part of any count above.</p>
            <label className="atlas-toggle atlas-shamtoggle">
              <input type="checkbox" role="switch" aria-label="Side by side with real stimulation" checked={shamSide} onChange={(e) => setShamSide(e.target.checked)} />
              <span>Side by side with real stimulation at the same contacts</span>
            </label>
            {shamSide ? <ShamSideBySide shamRows={sham} realRows={result.stimulations} {...itemProps} /> : <List rows={sham} sham {...itemProps} />}
          </>}
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
