import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { BrainEngine, type CapturedView, type CoverageColors, type Dot, type SelectedArea, type Subregions, type ViewPreset } from '../brain/engine'
import type { AtlasAssets, BrainAssets, Hemi } from '../brain/assets'
import type { ViewName } from '../model/urlState'

export interface BrainCanvasHandle {
  rotateBy: (rad: number) => void
  setView: (v: ViewName) => void
  snapshot: () => string | null
  captureViews: (views: { view: ViewPreset; w: number; h: number; scale?: number }[], opts: { inflated: boolean }) => CapturedView[]
}

interface Props {
  brain: BrainAssets
  inflated: Record<Hemi, Float32Array> | null
  atlas: AtlasAssets | null
  selected: SelectedArea[]
  smooth: boolean
  see: number
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
  onHover: (id: string | null, x: number, y: number) => void
  onClick: (id: string | null) => void
  /** the brain cannot be drawn here (no WebGL 2): the page falls back to the list of areas */
  onError?: (message: string) => void
}

export const BrainCanvas = forwardRef<BrainCanvasHandle, Props>(function BrainCanvas(p, ref) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<BrainEngine | null>(null)
  const cbs = useRef({ onHover: p.onHover, onClick: p.onClick })
  cbs.current = { onHover: p.onHover, onClick: p.onClick }
  const latest = useRef(p)
  latest.current = p

  useEffect(() => {
    let e: BrainEngine
    try {
      e = new BrainEngine(host.current!, p.brain, {
        onHover: (id, x, y) => cbs.current.onHover(id, x, y),
        onClick: (id) => cbs.current.onClick(id),
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
    e.setSeeThrough(q.see)
    e.setDots(q.dots, q.showDots)
    e.setCoverage(q.coverage)
    e.setView(q.initialView)
    e.setFade(q.fade)
    e.setSubregions(q.subregions)
    e.setSubActive(q.subActive)
    if (q.focus) e.focusOn(q.focus)
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
  useEffect(() => engine.current?.setSeeThrough(p.see), [p.see])
  useEffect(() => engine.current?.setDots(p.dots, p.showDots), [p.dots, p.showDots])
  useEffect(() => engine.current?.setCoverage(p.coverage), [p.coverage, p.atlas])
  useEffect(() => engine.current?.setFade(p.fade), [p.fade])
  useEffect(() => engine.current?.setSubregions(p.subregions), [p.subregions])
  useEffect(() => engine.current?.setSubActive(p.subActive), [p.subActive, p.subregions])
  // after the atlas and selection effects, so the area's labels are known when the camera moves
  useEffect(() => engine.current?.focusOn(p.focus), [p.focus, p.atlas])

  useImperativeHandle(ref, () => ({
    rotateBy: (rad) => engine.current?.rotateBy(rad),
    setView: (v) => engine.current?.setView(v),
    snapshot: () => engine.current?.snapshot() ?? null,
    captureViews: (views, opts) => engine.current?.captureViews(views, opts) ?? [],
  }))

  return <div ref={host} className="atlas-canvas" aria-label={p.label} />
})
