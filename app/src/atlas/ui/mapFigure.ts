/* A publication figure of the map on screen, as a 300 dpi PNG and an editable SVG.

   Five views rendered from fixed cameras on FreeSurfer's inflated surface, the convention for
   parcel maps because the pial surface hides the insula and the sulcal banks: lateral above
   medial for each hemisphere, and the ventral surface (fusiform, parahippocampal, entorhinal,
   orbitofrontal: much of where depth electrodes go) as a tall panel on the right. The SVG carries
   the same brain images with live text, so a journal's vector requirement is met by opening it in
   Illustrator or Inkscape. Every word on the figure is generated from the data and the settings. */

import type { CapturedView, ViewPreset } from '../brain/engine'
import { binLabel, NO_DATA, type Bin } from '../model/colormap'
import { pngWithDpi } from '../model/mapData'

const W = 2400
const M = 80
const GAP = 36
// two landscape columns (lateral over medial) and a portrait column for the ventral view
const TILE_W = 690
const TILE_H = 470
const VENTRAL_W = W - 2 * M - 2 * TILE_W - 2 * GAP
const VENTRAL_H = 2 * TILE_H + GAP
const TOP = M + 130

/** `scale` is the camera distance relative to the app's default view, tuned so each view fills its tile */
export const FIGURE_TILES: { view: ViewPreset; label: string; x: number; y: number; w: number; h: number; scale: number }[] = [
  { view: 'left', label: 'Left, lateral', x: M, y: TOP, w: TILE_W, h: TILE_H, scale: 0.62 },
  { view: 'right', label: 'Right, lateral', x: M + TILE_W + GAP, y: TOP, w: TILE_W, h: TILE_H, scale: 0.62 },
  { view: 'insideL', label: 'Left, medial', x: M, y: TOP + TILE_H + GAP, w: TILE_W, h: TILE_H, scale: 0.62 },
  { view: 'insideR', label: 'Right, medial', x: M + TILE_W + GAP, y: TOP + TILE_H + GAP, w: TILE_W, h: TILE_H, scale: 0.62 },
  { view: 'bottom', label: 'Ventral', x: M + 2 * (TILE_W + GAP), y: TOP, w: VENTRAL_W, h: VENTRAL_H, scale: 1.02 },
]

const FONT = 'IBM Plex Sans, Helvetica Neue, Arial, sans-serif'
const INK = '#1b1e22'
const INK2 = '#5a6068'
const INK3 = '#868c94'

export interface FigureLegend {
  kind: 'coverage' | 'selection'
  bins?: Bin[]
  measure?: string
  areas?: { n: number; color: string; name: string; detail: string }[]
  electrodes?: number | null
}

export interface FigureSpec {
  title: string
  subtitle: string
  legend: FigureLegend
  source: string
  synthetic: boolean
}

/* ---- one layout, drawn twice ------------------------------------------------------------ */

type Op =
  | { t: 'text'; x: number; y: number; s: string; size: number; weight: number; fill: string; anchor?: 'start' | 'middle' }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string }
  | { t: 'circle'; x: number; y: number; r: number; fill: string; stroke?: string; sw?: number }
  | { t: 'image'; x: number; y: number; w: number; h: number; src: HTMLCanvasElement }

function measureText(s: string, size: number, weight: number): number {
  const ctx = measureText.ctx ?? (measureText.ctx = document.createElement('canvas').getContext('2d')!)
  ctx.font = `${weight} ${size}px ${FONT}`
  return ctx.measureText(s).width
}
measureText.ctx = null as CanvasRenderingContext2D | null

function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w
    if (measureText(t, size, 400) > width && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

function pinOps(x: number, y: number, n: number, color: string, r = 20): Op[] {
  return [
    { t: 'circle', x, y, r, fill: color, stroke: '#ffffff', sw: 4 },
    { t: 'text', x, y: y + r * 0.38, s: String(n), size: Math.round(r * 1.05), weight: 600, fill: '#ffffff', anchor: 'middle' },
  ]
}

function layout(views: CapturedView[], spec: FigureSpec): { ops: Op[]; height: number } {
  const ops: Op[] = []
  ops.push({ t: 'text', x: M, y: M + 44, s: spec.title, size: 44, weight: 600, fill: INK })
  ops.push({ t: 'text', x: M, y: M + 92, s: spec.subtitle, size: 27, weight: 400, fill: INK2 })

  for (const tile of FIGURE_TILES) {
    const v = views.find((x) => x.view === tile.view)
    if (v) {
      ops.push({ t: 'image', x: tile.x, y: tile.y, w: tile.w, h: tile.h, src: v.image })
      const sx = tile.w / v.image.width
      const sy = tile.h / v.image.height
      for (const p of v.pins) ops.push(...pinOps(tile.x + p.x * sx, tile.y + p.y * sy, p.n, p.color))
      if (tile.view === 'bottom') {
        for (const s of v.sides) ops.push({ t: 'text', x: tile.x + s.x * sx, y: tile.y + tile.h - 8, s: s.hemi === 'lh' ? 'Left' : 'Right', size: 24, weight: 500, fill: INK3, anchor: 'middle' })
      }
    }
    ops.push({ t: 'text', x: tile.x, y: tile.y + 28, s: tile.label, size: 24, weight: 500, fill: INK3 })
  }

  let y = TOP + VENTRAL_H + 76
  const lg = spec.legend
  if (lg.kind === 'coverage' && lg.bins) {
    ops.push({ t: 'text', x: M, y, s: lg.measure ?? '', size: 30, weight: 500, fill: INK })
    y += 26
    let x = M
    const items = [{ color: NO_DATA, label: '0' }, ...lg.bins.map((b) => ({ color: b.color, label: binLabel(b) }))]
    for (const it of items) {
      ops.push({ t: 'rect', x, y, w: 72, h: 34, fill: it.color, stroke: '#d5d3cf' })
      ops.push({ t: 'text', x, y: y + 70, s: it.label, size: 26, weight: 400, fill: INK2 })
      x += Math.max(72, measureText(it.label, 26, 400)) + 34
    }
    y += 104
  } else if (lg.kind === 'selection' && lg.areas) {
    const colW = (W - 2 * M - GAP) / 2
    lg.areas.forEach((a, i) => {
      const cx = M + (i % 2) * (colW + GAP)
      const cy = y + Math.floor(i / 2) * 54
      ops.push(...pinOps(cx + 18, cy, a.n, a.color, 18))
      ops.push({ t: 'text', x: cx + 50, y: cy + 10, s: a.name, size: 28, weight: 500, fill: INK })
      // keep each entry inside its column: shorten the detail, never let it run into the next one
      const room = colW - 50 - measureText(a.name, 28, 500) - 16
      let detail = a.detail
      while (detail && measureText(detail, 26, 400) > room) detail = detail.length > 2 ? `${detail.slice(0, -2).trimEnd()}…` : ''
      ops.push({ t: 'text', x: cx + 50 + measureText(a.name, 28, 500) + 16, y: cy + 10, s: detail, size: 26, weight: 400, fill: INK3 })
    })
    y += Math.ceil(lg.areas.length / 2) * 54 + 16
  }
  if (lg.electrodes) {
    ops.push({ t: 'circle', x: M + 12, y: y - 2, r: 10, fill: '#4b4f57' })
    ops.push({ t: 'text', x: M + 36, y: y + 8, s: `Stimulated surface contact at its registered fsaverage vertex (n = ${lg.electrodes.toLocaleString('en-US')}); depth contacts are not shown`, size: 26, weight: 400, fill: INK2 })
    y += 54
  }

  y += 12
  if (spec.synthetic) {
    ops.push({ t: 'text', x: M, y, s: 'SYNTHETIC DEMONSTRATION DATA: describes no real person', size: 24, weight: 600, fill: '#a9562e' })
    y += 36
  }
  for (const line of wrap(spec.source, W - 2 * M, 22)) {
    ops.push({ t: 'text', x: M, y, s: line, size: 22, weight: 400, fill: INK3 })
    y += 30
  }
  return { ops, height: y + M - 30 }
}

/* ---- PNG ---------------------------------------------------------------------------------- */

export async function figurePng(views: CapturedView[], spec: FigureSpec): Promise<Blob> {
  await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 32px "IBM Plex Sans"`))).catch(() => undefined)
  const { ops, height } = layout(views, spec)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, height)
  for (const o of ops) {
    if (o.t === 'image') ctx.drawImage(o.src, o.x, o.y, o.w, o.h)
    else if (o.t === 'rect') {
      ctx.fillStyle = o.fill
      ctx.fillRect(o.x, o.y, o.w, o.h)
      if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2) }
    } else if (o.t === 'circle') {
      ctx.beginPath()
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
      ctx.fillStyle = o.fill
      ctx.fill()
      if (o.stroke) { ctx.lineWidth = o.sw ?? 2; ctx.strokeStyle = o.stroke; ctx.stroke() }
    } else {
      ctx.fillStyle = o.fill
      ctx.font = `${o.weight} ${o.size}px ${FONT}`
      ctx.textAlign = o.anchor === 'middle' ? 'center' : 'left'
      ctx.fillText(o.s, o.x, o.y)
    }
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('the figure could not be encoded'))), 'image/png'))
  return new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), 300).buffer as ArrayBuffer], { type: 'image/png' })
}

/* ---- SVG ---------------------------------------------------------------------------------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function figureSvg(views: CapturedView[], spec: FigureSpec): string {
  const { ops, height } = layout(views, spec)
  const body = ops.map((o) => {
    if (o.t === 'image') {
      const data = o.src.toDataURL('image/png')
      // xlink:href: Illustrator and older readers need it, and every browser still reads it
      return `<image x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" xlink:href="${data}"/>`
    }
    if (o.t === 'rect') return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="2"` : ''}/>`
    if (o.t === 'circle') return `<circle cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${o.r}" fill="${o.fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 2}"` : ''}/>`
    return `<text x="${o.x.toFixed(1)}" y="${o.y.toFixed(1)}" font-size="${o.size}" font-weight="${o.weight}" fill="${o.fill}"${o.anchor === 'middle' ? ' text-anchor="middle"' : ''}>${esc(o.s)}</text>`
  })
  // 2400 px at 300 dpi = 203.2 mm wide; physical size set so placing it at 100% gives 300 dpi
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${(W / 300 * 25.4).toFixed(1)}mm" height="${(height / 300 * 25.4).toFixed(1)}mm" viewBox="0 0 ${W} ${height}" font-family="${FONT}">
<rect width="${W}" height="${height}" fill="#ffffff"/>
${body.join('\n')}
</svg>
`
}
