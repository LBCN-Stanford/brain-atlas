/* The coverage colour scale: a choropleth, so it follows cartography's rules (Brewer 2003).
   Sequential, colour-blind safe, light at the low end so "more" reads as "darker" on a white page,
   and BINNED rather than continuous, so a reader can match an area to its legend step by eye.
   The first bin always ends at 4: the MNI Open iEEG Atlas and F-TRACT report an area only from
   five patients, so the scale shows at a glance which areas reach that. */

// ColorBrewer YlGnBu (9-class), without its near-white first step, which vanishes on a pale brain
const PALETTE = ['#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494']
const STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]

/** shown for an area with no stimulation: the plain brain colour */
export const NO_DATA = '#e9e6e1'

export interface Bin {
  lo: number
  hi: number
  color: string
  /** the top bin, shown as "lo+" because it spans more than one step */
  open?: boolean
}

/** Integer bins covering 1..max: [1-4], then round steps (5-9, 10-19, ...), at most 7 bins; the
    top bin is open ("50+") and spans no more than two steps. */
export function binsFor(max: number): Bin[] {
  if (max <= 0) return []
  if (max <= 4) return [{ lo: 1, hi: max, color: PALETTE[PALETTE.length - 1] }]
  const MAXBINS = PALETTE.length
  for (const step of STEPS) {
    const ranges: [number, number][] = [[1, 4]]
    let lo = 5
    while (lo <= max && ranges.length < MAXBINS) {
      const hi = ranges.length === MAXBINS - 1 ? max : Math.min(max, (Math.floor(lo / step) + 1) * step - 1)
      ranges.push([lo, hi])
      lo = hi + 1
    }
    const [tlo, thi] = ranges[ranges.length - 1]
    if (lo <= max || thi - tlo + 1 > 2 * step) continue
    return ranges.map(([a, b], i) => ({
      lo: a, hi: b, open: i === ranges.length - 1 && b - a + 1 > step,
      color: PALETTE[Math.round((i * (PALETTE.length - 1)) / (ranges.length - 1))],
    }))
  }
  return [{ lo: 1, hi: max, color: PALETTE[PALETTE.length - 1] }]
}

export function colorFor(value: number, bins: readonly Bin[]): string | null {
  if (value <= 0 || !bins.length) return null
  return (bins.find((b) => value >= b.lo && value <= b.hi) ?? bins[bins.length - 1]).color
}

export const binLabel = (b: Bin) => (b.open ? `${b.lo}+` : b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`)

/** a hex colour moved toward white by t (0 = unchanged, 1 = white) */
export function mixWhite(hex: string, t: number): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (x: number) => Math.round(x + (255 - x) * t).toString(16).padStart(2, '0')
  return `#${ch((v >> 16) & 255)}${ch((v >> 8) & 255)}${ch(v & 255)}`
}

/** a hex colour moved toward black by t (0 = unchanged, 1 = black) */
export function mixBlack(hex: string, t: number): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (x: number) => Math.round(x * (1 - t)).toString(16).padStart(2, '0')
  return `#${ch((v >> 16) & 255)}${ch((v >> 8) & 255)}${ch(v & 255)}`
}
