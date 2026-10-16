/* Loads the fsaverage assets scripts/v2/build_brain_assets.py writes to public/atlas/brain/: the full
   fsaverage surfaces (163,842 vertices per hemisphere), exactly as FreeSurfer distributes them. */

import type { AtlasId, DeepStructure, ParcelTable } from '../model/parcels'

export type Hemi = 'lh' | 'rh'

export interface HemiMesh {
  pial: Float32Array
  /** fsaverage's own triangle list (identical for both hemispheres) */
  tris: Uint32Array
  sulc: Float32Array
}

export interface DeepMesh extends DeepStructure {
  pos: Float32Array
  idx: Uint32Array
}

export interface BrainAssets {
  hemis: Record<Hemi, HemiMesh>
  deep: DeepMesh[]
}

export interface AtlasAssets {
  table: ParcelTable
  labels: Record<Hemi, Uint16Array>
}

const base = () => `${import.meta.env.BASE_URL || './'}atlas/brain/`

async function raw(path: string): Promise<ArrayBuffer> {
  const r = await fetch(base() + path)
  if (!r.ok) throw new Error(`could not load ${path} (${r.status})`)
  return r.arrayBuffer()
}

/* A deployed build also carries a gzip copy of each file that compresses well (the triangle
   list, the label arrays, the deep-structure meshes: 2-20x smaller). Static hosts serve binary
   files uncompressed, so the page inflates the copy itself. The plain file stays beside it, and is
   fetched whenever the copy is missing or the browser cannot inflate it. */
const GZ = /^(tris\.u32|subcortical\.bin|parc\/.+\.u16)$/
async function buf(path: string): Promise<ArrayBuffer> {
  if (import.meta.env.PROD && GZ.test(path) && typeof DecompressionStream !== 'undefined') {
    try {
      const r = await fetch(base() + path + '.gz')
      if (r.ok && r.body) {
        // a server that labels the copy Content-Encoding: gzip has the browser inflate it already
        if (/gzip/i.test(r.headers.get('content-encoding') ?? '')) return await r.arrayBuffer()
        return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      }
    } catch { /* fall through to the plain file */ }
  }
  return raw(path)
}

let brainPromise: Promise<BrainAssets> | null = null

/** One load per page: callers (and StrictMode's double effects) share the same assets. */
export function loadBrain(): Promise<BrainAssets> {
  brainPromise ??= fetchBrain()
  return brainPromise
}

async function fetchBrain(): Promise<BrainAssets> {
  const trisBuf = buf('tris.u32')
  const hemi = async (h: Hemi): Promise<HemiMesh> => {
    const [pial, tris, sulc] = await Promise.all([buf(`${h}.pial.f32`), trisBuf, buf(`${h}.sulc.f32`)])
    return { pial: new Float32Array(pial), // a copy per hemisphere: three-mesh-bvh reorders the index it is built on, in place (code review 10 Oct)
      tris: new Uint32Array(tris).slice(), sulc: new Float32Array(sulc) }
  }
  const [lh, rh, subJson, subBin] = await Promise.all([
    hemi('lh'),
    hemi('rh'),
    fetch(base() + 'subcortical.json').then((r) => r.json() as Promise<{ structures: DeepStructure[] }>),
    buf('subcortical.bin'),
  ])
  const deep: DeepMesh[] = subJson.structures.map((s) => ({
    ...s,
    pos: new Float32Array(subBin, s.positions.byteOffset, s.positions.count * 3),
    idx: new Uint32Array(subBin, s.indices.byteOffset, s.indices.count),
  }))
  return { hemis: { lh, rh }, deep }
}

let inflatedPromise: Promise<Record<Hemi, Float32Array>> | null = null

/** FreeSurfer's inflated surfaces, for "Smooth" and the map figure. Not needed to draw the brain,
    so they load after it (4 MB the first view does not wait for). */
export function loadInflated(): Promise<Record<Hemi, Float32Array>> {
  inflatedPromise ??= Promise.all([buf('lh.inflated.f32'), buf('rh.inflated.f32')])
    .then(([lh, rh]) => ({ lh: new Float32Array(lh), rh: new Float32Array(rh) }))
  inflatedPromise.catch(() => { inflatedPromise = null })
  return inflatedPromise
}

const atlasCache = new Map<AtlasId, Promise<AtlasAssets>>()

export function loadAtlas(id: AtlasId): Promise<AtlasAssets> {
  let p = atlasCache.get(id)
  if (!p) {
    p = Promise.all([
      fetch(base() + `parc/${id}.json`).then((r) => r.json() as Promise<ParcelTable>),
      buf(`parc/${id}.lh.u16`),
      buf(`parc/${id}.rh.u16`),
    ]).then(([table, lh, rh]) => ({ table, labels: { lh: new Uint16Array(lh), rh: new Uint16Array(rh) } }))
    atlasCache.set(id, p)
  }
  return p
}
