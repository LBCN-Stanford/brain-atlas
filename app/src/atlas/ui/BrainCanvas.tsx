import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { BrainEngine, type CapturedView, type CoverageColors, type Dot, type SelectedArea, type Subregions, type ViewPreset } from '../brain/engine'
import type { AtlasAssets, BrainAssets, Hemi } from '../brain/assets'
import type { ViewName } from '../model/urlState'

export interface BrainCanvasHandle {
  rotateBy: (rad: number) => void
  setView: (v: ViewName) => void
  snapshot: () => string | null
  captureViews: (views: { view: ViewPreset; w: number; h: number; scale?: number }[], opts: { inflated: boolean; coverage?: CoverageColors | null }) => CapturedView[]
}

interface Props {
  brain: BrainAssets
  inflated: Record<Hemi, Float32Array> | null
  atlas: AtlasAssets | null
  selected: SelectedArea[]
  smooth: boolean
  see: number
  /** the reader set Opacity themselves: only then can a click reach inside the cortex */
  seeManual: boolean
  dots: Dot[]
  showDots: boolean
  coverage: CoverageColors | null
  initialView: ViewName
  /** the area to turn to and move in on; null for the whole brain */
  focus: string | null
  /** fade everything but the selected areas */
  fade: boolean
  subregions: Subregions | null
  /** the selected subregion's key */
  subActive: string | null
  label: string
  /** pixels at the bottom of the stage the phone's reading sheet covers */
  bottomInset?: number
  onHover: (id: string | null, x: number, y: number) => void
  onClick: (id: string | null) => void
  /** the engine hid or showed a hemisphere on its own (a focus on a medial area) */
  onHidden?: (hidden: Hemi | null) => void
  /** the brain cannot be drawn here (no WebGL 2): the page falls back to the list of areas */
  onError?: (message: string) => void
}

export const BrainCanvas = forwardRef<BrainCanvasHandle, Props>(function BrainCanvas(p, ref) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<BrainEngine | null>(null)
  const cbs = useRef({ onHover: p.onHover, onClick: p.onClick, onHidden: p.onHidden })
  cbs.current = { onHover: p.onHover, onClick: p.onClick, onHidden: p.onHidden }
  // a link that opens on an Inside view keeps that view: the selection's camera focus is skipped
  // for the area the link opened with, or the reload showed the focus camera instead (L7)
  const skipFocus = useRef<string | null>(p.initialView.startsWith('inside') ? p.focus : null)
  const latest = useRef(p)
  latest.current = p

  useEffect(() => {
    let e: BrainEngine
    try {
      e = new BrainEngine(host.current!, p.brain, {
        onHover: (id, x, y) => cbs.current.onHover(id, x, y),
        onClick: (id) => cbs.current.onClick(id),
        onHidden: (h) => cbs.current.onHidden?.(h),
      })
    } catch (err) {
      latest.current.onError?.(err instanceof Error ? err.message : String(err))
      return
    }
    engine.current = e
    // A new engine starts blank: give it everything the old one had, or a re-created engine
    // (StrictMode, or new brain assets) silently shows no atlas, no selection, no toggles.
    const q = latest.current
    if (q.inflated) e.setInflated(q.inflated)
    e.setAtlas(q.atlas)
    e.setSelection(q.selected)
    e.setSmooth(q.smooth ? 1 : 0)
    e.setSeeThrough(q.see, q.seeManual)
    e.setDots(q.dots, q.showDots)
    e.setCoverage(q.coverage)
    e.setView(q.initialView)
    e.setFade(q.fade)
    e.setSubregions(q.subregions)
    e.setSubActive(q.subActive)
    if (q.focus && q.focus !== skipFocus.current) e.focusOn(q.focus)
    return () => {
      e.dispose()
      engine.current = null
    }
    // the engine lives as long as the brain assets do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.brain])

  useEffect(() => {
    engine.current?.setAtlas(p.atlas)
  }, [p.atlas])
  // the canvas is the element with role="img": it carries the description itself
  useEffect(() => { host.current?.querySelector('canvas')?.setAttribute('aria-label', p.label) })
  useEffect(() => engine.current?.setSelection(p.selected), [p.selected, p.atlas])
  useEffect(() => { if (p.inflated) engine.current?.setInflated(p.inflated) }, [p.inflated])
  useEffect(() => engine.current?.setSmooth(p.smooth ? 1 : 0), [p.smooth])
  useEffect(() => engine.current?.setSeeThrough(p.see, p.seeManual), [p.see, p.seeManual])
  useEffect(() => engine.current?.setDots(p.dots, p.showDots), [p.dots, p.showDots])
  useEffect(() => engine.current?.setCoverage(p.coverage), [p.coverage, p.atlas])
  useEffect(() => engine.current?.setFade(p.fade), [p.fade])
  useEffect(() => engine.current?.setInset(p.bottomInset ?? 0), [p.bottomInset])
  useEffect(() => engine.current?.setSubregions(p.subregions), [p.subregions])
  useEffect(() => engine.current?.setSubActive(p.subActive), [p.subActive, p.subregions])
  // after the atlas and selection effects, so the area's labels are known when the camera moves
  useEffect(() => {
    if (p.focus && p.focus === skipFocus.current) return
    skipFocus.current = null
    engine.current?.focusOn(p.focus)
  }, [p.focus, p.atlas])

  useImperativeHandle(ref, () => ({
    rotateBy: (rad) => engine.current?.rotateBy(rad),
    setView: (v) => engine.current?.setView(v),
    snapshot: () => engine.current?.snapshot() ?? null,
    captureViews: (views, opts) => engine.current?.captureViews(views, opts) ?? [],
  }))

  return <div ref={host} className="atlas-canvas" aria-label={p.label} />
})
