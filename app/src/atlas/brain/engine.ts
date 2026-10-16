/* The v2 brain: fsaverage cortex + FreeSurfer deep structures, drawn plainly on white.

   Geometry is exactly what build_brain_assets.py wrote: fsaverage's own 163,842 vertices and
   327,680 triangles per hemisphere, in MNI305 (= fsaverage space). Nothing here moves a vertex
   except the folded<->inflated morph, which interpolates between two published surfaces of the
   same vertices and is display-only. Picking resolves a click to the published label of the
   nearest mesh vertex, so what is highlighted is the parcel as the atlas defines it. Electrode
   dots are drawn AT the fsaverage vertex each surface contact was registered to, so they sit on
   this surface in every view; depth contacts are not drawn (their template position is an affine
   estimate -- see build_site_parcels.py).

   Visual rules (design brief C1/C9): matte pale cortex, sulci darkened from FreeSurfer's sulc,
   colour ONLY for areas the user picked, hover is an outline never a fill, no auto-rotation. */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'
import type { AtlasAssets, BrainAssets, DeepMesh, Hemi } from './assets'
import { cortexId, deepId } from '../model/parcels'


export type ViewPreset = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back' | 'insideL' | 'insideR'

export interface SelectedArea {
  id: string
  color: string
  n: number
}

export interface EngineCallbacks {
  onHover: (id: string | null, x: number, y: number) => void
  onClick: (id: string | null) => void
}

/** Per-area colours for the coverage map: cortical label index -> colour, deep key -> colour.
    An area absent from the map is drawn as plain brain (no stimulation there). */
export interface CoverageColors {
  cortex: Map<number, string>
  deep: Map<string, string>
}

/** One view of a figure: the rendered image and where each numbered area sits in it. */
export interface CapturedView {
  view: ViewPreset
  image: HTMLCanvasElement
  pins: { n: number; color: string; x: number; y: number }[]
  /** where each hemisphere's centre falls in the image (x, y in pixels), to label L and R */
  sides: { hemi: Hemi; x: number; y: number }[]
}

/** One stimulated surface contact, drawn at the fsaverage vertex it was registered to. */
/** A stimulated contact: a surface contact at its fsaverage vertex (it follows the surface when it
    is smoothed), or a depth contact at a fixed MNI305 point inside the brain (approximate: an
    affine estimate; hidden on the smoothed surface, which it does not belong to). */
export type Dot =
  | { hemi: Hemi; v: number; areaColor: string | null }
  | { hemi: Hemi; p: [number, number, number]; areaColor: string | null }

/** Subdivisions of the selected area, from a finer atlas: per-vertex labels and a colour each. */
export interface Subregions {
  labels: Record<Hemi, Uint16Array>
  colors: Map<number, string>
  keys: Map<number, string>
}

const GYRUS = new THREE.Color('#ECE9E4')
const SULCUS = new THREE.Color('#C6C0B8')
const MEDIAL = new THREE.Color('#D9D5CF')
const INK = new THREE.Color('#1B1E22')
const WHITE = new THREE.Color('#FFFFFF')
const DEEP_BASE = new THREE.Color('#DDD8D1')
const ELECTRODE = new THREE.Color('#4B4F57')
const TARGET = new THREE.Vector3(0, -18, 12)
const DISTANCE = 480
/** the stage aspect (width / height) below which the camera zooms out to keep the brain's width in view */
const WIDE = 1.35
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface HemiState {
  hemi: Hemi
  geom: THREE.BufferGeometry
  mesh: THREE.Mesh
  sub: THREE.Mesh
  subGeom: THREE.BufferGeometry
  pos: THREE.BufferAttribute
  nrm: THREE.BufferAttribute
  col: THREE.BufferAttribute
  pial: Float32Array
  /** null until loadInflated() resolves; "Smooth" waits for it */
  inflated: Float32Array | null
  pialN: Float32Array
  inflN: Float32Array | null
  base: Float32Array
  tris: Uint32Array
  adjStart: Uint32Array
  adj: Uint32Array
  labels: Uint16Array | null
  boundary: Uint8Array
}

/** Area-weighted vertex normals (what three's computeVertexNormals does), computed once per
    surface so the folded<->inflated morph can interpolate them instead of recomputing 655k faces
    every frame. */
function vertexNormals(p: Float32Array, tris: Uint32Array): Float32Array {
  const n = new Float32Array(p.length)
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return n
}

function adjacency(n: number, tris: Uint32Array) {
  const deg = new Uint32Array(n)
  for (let i = 0; i < tris.length; i++) deg[tris[i]] += 2
  const start = new Uint32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i]
  const fill = start.slice(0, n)
  const adj = new Uint32Array(start[n])
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2]
    adj[fill[a]++] = b; adj[fill[a]++] = c
    adj[fill[b]++] = a; adj[fill[b]++] = c
    adj[fill[c]++] = a; adj[fill[c]++] = b
  }
  return { start, adj }
}

export class BrainEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private hemis: Record<Hemi, HemiState>
  private deep = new Map<string, { mesh: THREE.Mesh; data: DeepMesh; material: THREE.MeshLambertMaterial; centroid: THREE.Vector3 }>()
  private cortexMaterial: THREE.MeshLambertMaterial
  private subMaterial: THREE.MeshLambertMaterial
  private dots: THREE.InstancedMesh | null = null
  private dotData: Dot[] = []
  private dotShown: Dot[] = []
  private showDots = false
  private atlas: AtlasAssets | null = null
  private selected = new Map<string, SelectedArea>()
  private selectedByIndex = new Map<number, THREE.Color>()
  private coverage: { cortex: Map<number, THREE.Color>; deep: Map<string, THREE.Color> } | null = null
  private hoverIndex = -1
  private hoverId: string | null = null
  private smooth = 0
  private drawnInflated = false
  private seeThrough = 0
  private hidden: Hemi | null = null
  /** the hemisphere the chosen view hides (a focus on a medial area may hide one too) */
  private viewHidden: Hemi | null = null
  private fade = false
  private sub: { s: Subregions; colors: Map<number, THREE.Color>; boundary: Record<Hemi, Uint8Array>; index: Map<string, number> } | null = null
  /** the selected subregion (its finer-atlas label index), and the one under the pointer */
  private subActive = -1
  private subHover = -1
  private pins = new Map<string, { el: HTMLDivElement; anchor: { hemi: Hemi; v: number; n: THREE.Vector3 } | { deep: string } }>()
  private needsRender = true
  private raf = 0
  private anim: ((now: number) => boolean) | null = null
  private camAnim: ((now: number) => boolean) | null = null
  private pickPending: { x: number; y: number } | null = null
  private down: { x: number; y: number } | null = null
  private ro: ResizeObserver
  private overlay: HTMLDivElement
  private cb: EngineCallbacks
  private container: HTMLElement

  constructor(container: HTMLElement, assets: BrainAssets, cb: EngineCallbacks) {
    this.container = container
    this.cb = cb
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor('#FFFFFF', 1)
    this.renderer.domElement.setAttribute('role', 'img')
    container.appendChild(this.renderer.domElement)
    this.overlay = document.createElement('div')
    this.overlay.className = 'atlas-pins'
    container.appendChild(this.overlay)

    this.camera = new THREE.PerspectiveCamera(26, 1, 10, 3000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.copy(TARGET).add(new THREE.Vector3(-DISTANCE, 0, 0))
    this.scene.add(this.camera)
    const hemiLight = new THREE.HemisphereLight('#FFFFFF', '#D9D6D0', 1.15)
    hemiLight.position.set(0, 0, 1)
    this.scene.add(hemiLight)
    const key = new THREE.DirectionalLight('#FFFFFF', 1.25)
    key.position.set(-0.6, 0.8, 1) // upper-left-front of the view: the light travels with the camera
    this.camera.add(key)
    const fill = new THREE.DirectionalLight('#FFFFFF', 0.4)
    fill.position.set(0.8, -0.4, 0.6)
    this.camera.add(fill)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(TARGET)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.7
    this.controls.minDistance = DISTANCE / 3
    this.controls.maxDistance = DISTANCE / 0.6
    this.controls.minPolarAngle = 0.02
    this.controls.maxPolarAngle = Math.PI - 0.02
    this.controls.addEventListener('change', () => (this.needsRender = true))

    this.cortexMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
    this.cortexMaterial.onBeforeCompile = (shader) => {
      // a faint darker rim so a pale brain keeps its silhouette on a white page
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.82, rim * 0.6);
         #include <dithering_fragment>`,
      )
    }
    this.subMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })

    this.hemis = {
      lh: this.buildHemi('lh', assets),
      rh: this.buildHemi('rh', assets),
    }
    for (const d of assets.deep) this.buildDeep(d)

    const resize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      this.renderer.setSize(w, h, false)
      this.renderer.domElement.style.width = `${w}px`
      this.renderer.domElement.style.height = `${h}px`
      this.camera.aspect = w / h
      // the brain is wider than tall: on a narrow (portrait) stage, zoom out so it fits the width
      this.camera.zoom = Math.min(1, (w / h) / WIDE)
      this.camera.updateProjectionMatrix()
      this.needsRender = true
    }
    this.ro = new ResizeObserver(resize)
    this.ro.observe(container)
    resize()

    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointerleave', this.onLeave)
    this.updateColors()
    this.loop()
    if (import.meta.env.DEV) (window as unknown as { __atlasEngine?: BrainEngine }).__atlasEngine = this
  }

  /** test hook: what a click at client (x, y) would select */
  debugPick(x: number, y: number) {
    return this.pick(x, y)
  }

  private buildHemi(h: Hemi, assets: BrainAssets): HemiState {
    const src = assets.hemis[h]
    const n = src.pial.length / 3
    const geom = new THREE.BufferGeometry()
    const pos = new THREE.BufferAttribute(new Float32Array(src.pial), 3)
    const col = new THREE.BufferAttribute(new Float32Array(n * 3), 3)
    const pialN = vertexNormals(src.pial, src.tris)
    const nrm = new THREE.BufferAttribute(new Float32Array(pialN), 3)
    geom.setAttribute('position', pos)
    geom.setAttribute('normal', nrm)
    geom.setAttribute('color', col)
    geom.setIndex(new THREE.BufferAttribute(src.tris, 1))
    geom.boundsTree = new MeshBVH(geom)
    const mesh = new THREE.Mesh(geom, this.cortexMaterial)
    mesh.raycast = acceleratedRaycast
    mesh.userData.hemi = h
    this.scene.add(mesh)
    const subGeom = new THREE.BufferGeometry()
    subGeom.setAttribute('position', pos)
    subGeom.setAttribute('normal', nrm)
    subGeom.setAttribute('color', col)
    subGeom.setIndex([])
    const sub = new THREE.Mesh(subGeom, this.subMaterial)
    sub.userData.hemi = h
    sub.visible = false
    this.scene.add(sub)
    const base = new Float32Array(n * 3)
    const c = new THREE.Color()
    for (let v = 0; v < n; v++) {
      // FreeSurfer sulc: positive in sulci, negative on gyral crowns
      const s = Math.min(1, Math.max(0, (src.sulc[v] + 0.45) / 1.35))
      c.copy(GYRUS).lerp(SULCUS, s * s * (3 - 2 * s))
      base[v * 3] = c.r; base[v * 3 + 1] = c.g; base[v * 3 + 2] = c.b
    }
    const { start, adj } = adjacency(n, src.tris)
    return { hemi: h, geom, mesh, sub, subGeom, pos, nrm, col, pial: src.pial, inflated: null, pialN, inflN: null, base, tris: src.tris, adjStart: start, adj, labels: null, boundary: new Uint8Array(n) }
  }

  private buildDeep(d: DeepMesh) {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(d.pos, 3))
    geom.setIndex(new THREE.BufferAttribute(d.idx, 1))
    geom.computeVertexNormals()
    geom.computeBoundingSphere()
    const material = new THREE.MeshLambertMaterial({ color: DEEP_BASE.clone() })
    const mesh = new THREE.Mesh(geom, material)
    mesh.userData.deep = d.key
    mesh.visible = false
    this.scene.add(mesh)
    const c = new THREE.Vector3()
    for (let i = 0; i < d.pos.length; i += 3) c.add(new THREE.Vector3(d.pos[i], d.pos[i + 1], d.pos[i + 2]))
    c.divideScalar(d.pos.length / 3)
    this.deep.set(d.key, { mesh, data: d, material, centroid: c })
  }

  /* ----- state setters ------------------------------------------------------------------- */

  /** null while an atlas loads: no labels, so nothing can be picked from the previous atlas */
  setAtlas(atlas: AtlasAssets | null) {
    this.atlas = atlas
    for (const h of ['lh', 'rh'] as Hemi[]) {
      const s = this.hemis[h]
      if (!atlas) {
        s.labels = null
        s.boundary.fill(0)
        continue
      }
      s.labels = atlas.labels[h]
      const n = s.labels.length
      for (let v = 0; v < n; v++) {
        let b = 0
        const l = s.labels[v]
        for (let k = s.adjStart[v]; k < s.adjStart[v + 1]; k++) if (s.labels[s.adj[k]] !== l) { b = 1; break }
        s.boundary[v] = b
      }
    }
    this.hoverIndex = -1
    this.refreshSelection()
  }

  setSelection(areas: SelectedArea[]) {
    this.selected = new Map(areas.map((a) => [a.id, a]))
    this.refreshSelection()
  }

  setCoverage(c: CoverageColors | null) {
    this.coverage = c && {
      cortex: new Map([...c.cortex].map(([k, v]) => [k, new THREE.Color(v)])),
      deep: new Map([...c.deep].map(([k, v]) => [k, new THREE.Color(v)])),
    }
    this.paintDeep()
    this.updateColors()
  }

  private refreshSelection() {
    this.selectedByIndex.clear()
    if (this.atlas) {
      for (const l of this.atlas.table.labels) {
        if (!l.key) continue
        const a = this.selected.get(cortexId(l.key))
        if (a) this.selectedByIndex.set(l.index, new THREE.Color(a.color))
      }
    }
    this.paintDeep()
    this.updateColors()
    this.updateSubmeshes()
    this.updateDots()
    this.rebuildPins()
    this.applyVisibility()
  }

  /** a deep structure takes its selection colour, else its coverage colour, else the plain base */
  private paintDeep(hoverId: string | null = this.hoverId) {
    for (const [key, d] of this.deep) {
      const a = this.selected.get(deepId(key))
      const cov = this.coverage?.deep.get(key)
      if (a && !this.coverage) d.material.color.set(a.color)
      else if (cov) d.material.color.copy(cov)
      else d.material.color.copy(hoverId === deepId(key) ? DEEP_BASE.clone().lerp(INK, 0.25) : DEEP_BASE)
    }
  }

  /** the inflated surfaces arrived: a "Smooth" asked for before then runs now */
  setInflated(inf: Record<Hemi, Float32Array>) {
    for (const h of ['lh', 'rh'] as Hemi[]) {
      const s = this.hemis[h]
      if (s.inflated) continue
      s.inflated = inf[h]
      s.inflN = vertexNormals(inf[h], s.tris)
    }
    if (this.pendingSmooth != null) {
      const t = this.pendingSmooth
      this.pendingSmooth = null
      this.setSmooth(t)
    }
  }

  private hasInflated() { return !!(this.hemis.lh.inflated && this.hemis.rh.inflated) }
  private pendingSmooth: number | null = null

  /** where "Smooth" is heading (the focus frames the surface it will settle on) */
  private smoothTarget = 0

  setSmooth(target: number) {
    this.smoothTarget = target
    if (!this.hasInflated()) {
      this.pendingSmooth = target > 0 ? target : null
      return
    }
    // the inflated surface is larger than the pial: step the camera back with it so the brain
    // keeps its place on the page
    const d0 = this.camera.position.distanceTo(this.controls.target)
    const d1 = d0 * (1 + 0.32 * (target - this.smooth)) / (1 + 0.32 * 0)
    if (Math.abs(target - this.smooth) > 0.01) this.dolly(d0, d1, 600)
    const from = this.smooth
    const t0 = performance.now()
    const dur = 600 * Math.abs(target - from)
    this.anim = (now) => {
      const k = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur)
      this.applySmooth(from + (target - from) * ease(k), k >= 1)
      return k < 1
    }
  }

  private applySmooth(t: number, settled: boolean) {
    this.smooth = t
    if (!this.hasInflated()) return
    for (const s of Object.values(this.hemis)) {
      const inflated = s.inflated!, inflN = s.inflN!
      const p = s.pos.array as Float32Array
      const nn = s.nrm.array as Float32Array
      for (let i = 0; i < p.length; i++) p[i] = s.pial[i] + (inflated[i] - s.pial[i]) * t
      for (let i = 0; i < nn.length; i += 3) {
        const x = s.pialN[i] + (inflN[i] - s.pialN[i]) * t
        const y = s.pialN[i + 1] + (inflN[i + 1] - s.pialN[i + 1]) * t
        const z = s.pialN[i + 2] + (inflN[i + 2] - s.pialN[i + 2]) * t
        const l = Math.sqrt(x * x + y * y + z * z) || 1
        nn[i] = x / l; nn[i + 1] = y / l; nn[i + 2] = z / l
      }
      s.pos.needsUpdate = true
      s.nrm.needsUpdate = true
      if (settled) {
        // picking is paused while the surface moves; the BVH is refitted once it has settled.
        // The see-through submesh shares these positions, so its bounding sphere (which three.js
        // uses to cull a pick before testing triangles) must follow too (code review, 10 Oct).
        s.geom.boundsTree?.refit()
        s.geom.computeBoundingSphere()
        s.subGeom.computeBoundingSphere()
      }
    }
    this.placeDots()
    // area borders are drawn only on the inflated surface: recolour when crossing over, not every frame
    const inflatedNow = t > 0.5
    if (inflatedNow !== this.drawnInflated) {
      this.drawnInflated = inflatedNow
      this.updateColors()
    }
    this.applyVisibility()
    this.needsRender = true
  }

  setSeeThrough(t: number) {
    this.seeThrough = t
    this.applyVisibility()
  }

  setDots(dots: Dot[], show: boolean) {
    this.dotData = dots
    this.showDots = show
    this.updateDots()
  }

  private applyVisibility() {
    const ghost = this.seeThrough > 0.01
    this.cortexMaterial.transparent = ghost
    this.cortexMaterial.opacity = 1 - 0.9 * this.seeThrough
    this.cortexMaterial.depthWrite = !ghost
    this.cortexMaterial.polygonOffset = ghost
    this.cortexMaterial.polygonOffsetFactor = 1
    this.cortexMaterial.polygonOffsetUnits = 1
    this.cortexMaterial.needsUpdate = true
    for (const s of Object.values(this.hemis)) {
      const visible = s.hemi !== this.hidden
      s.mesh.visible = visible
      s.mesh.renderOrder = 2
      s.sub.visible = visible && ghost && this.selectedByIndex.size > 0
      s.sub.renderOrder = 1
    }
    const showDeep = this.smooth < 0.02
    for (const d of this.deep.values()) {
      const side = d.data.hemisphere
      d.mesh.visible = showDeep && side !== this.hidden && (ghost || this.selected.has(deepId(d.data.key)))
    }
    if (this.dots) this.dots.visible = this.showDots
    this.needsRender = true
  }

  private updateColors() {
    const anySel = this.selected.size > 0
    const cov = this.coverage
    const c = new THREE.Color()
    for (const s of Object.values(this.hemis)) {
      const col = s.col.array as Float32Array
      const n = s.base.length / 3
      for (let v = 0; v < n; v++) {
        c.setRGB(s.base[v * 3], s.base[v * 3 + 1], s.base[v * 3 + 2])
        const idx = s.labels ? s.labels[v] : 0
        const sel = idx ? this.selectedByIndex.get(idx) : undefined
        if (idx === 0 && s.labels) c.lerp(MEDIAL, 0.6)
        if (cov) {
          // coverage: every area takes its colour, shaded by the folds; selected areas are outlined
          const cc = idx ? cov.cortex.get(idx) : undefined
          if (cc) c.copy(cc).multiplyScalar(0.78 + 0.22 * (s.base[v * 3] / GYRUS.r))
          if (idx && s.boundary[v]) c.lerp(INK, sel ? 0.75 : idx === this.hoverIndex ? 0.6 : 0.14)
        } else if (sel) {
          const sl = this.sub ? this.sub.s.labels[s.hemi][v] : -1
          const sc = this.sub ? this.sub.colors.get(sl) : undefined
          c.lerp(sc ?? sel, 0.85)
          // a selected subregion stands out; the rest of its area steps back, like areas do
          if (sc && this.subActive >= 0 && sl !== this.subActive) c.lerp(WHITE, 0.55)
          if (s.boundary[v]) c.lerp(INK, 0.3)
          else if (sc && this.sub!.boundary[s.hemi][v]) c.lerp(INK, sl === this.subHover || sl === this.subActive ? 0.7 : 0.28)
        } else {
          // focus: everything but the chosen area steps back
          if (anySel) c.lerp(WHITE, this.fade ? 0.62 : 0.12)
          if (idx && idx === this.hoverIndex && s.boundary[v]) c.lerp(INK, 0.62)
          else if (idx && s.boundary[v] && this.smooth > 0.5) c.lerp(INK, 0.1)
        }
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b
      }
      s.col.needsUpdate = true
    }
    this.needsRender = true
  }

  private updateSubmeshes() {
    for (const s of Object.values(this.hemis)) {
      if (!s.labels || this.selectedByIndex.size === 0) {
        s.subGeom.setIndex([])
        continue
      }
      const out: number[] = []
      for (let t = 0; t < s.tris.length; t += 3) {
        const a = s.tris[t], b = s.tris[t + 1], c = s.tris[t + 2]
        if (this.selectedByIndex.has(s.labels[a]) && this.selectedByIndex.has(s.labels[b]) && this.selectedByIndex.has(s.labels[c])) out.push(a, b, c)
      }
      s.subGeom.setIndex(out)
    }
  }

  private updateDots() {
    if (this.dots) {
      this.scene.remove(this.dots)
      this.dots.geometry.dispose()
      ;(this.dots.material as THREE.Material).dispose()
      this.dots = null
    }
    const pts = this.dotData.filter((d) => d.hemi !== this.hidden)
    this.dotShown = pts
    if (!this.showDots || pts.length === 0) {
      this.needsRender = true
      return
    }
    const geo = new THREE.SphereGeometry(1.1, 10, 8)
    const mat = new THREE.MeshLambertMaterial({ color: '#FFFFFF' })
    const im = new THREE.InstancedMesh(geo, mat, pts.length)
    const c = new THREE.Color()
    pts.forEach((d, i) => im.setColorAt(i, d.areaColor ? c.set(d.areaColor) : ELECTRODE))
    im.renderOrder = 0
    this.dots = im
    this.placeDots()
    this.scene.add(im)
    this.applyVisibility()
  }

  /** each dot sits on its vertex of the surface as currently drawn (folded, inflated, or between) */
  private placeDots() {
    if (!this.dots) return
    const m = new THREE.Matrix4()
    const off = new THREE.Matrix4().makeScale(0, 0, 0)
    this.dotShown.forEach((d, i) => {
      if ('p' in d) {
        // a depth point belongs to the folded brain only
        if (this.smooth > 0.5) { this.dots!.setMatrixAt(i, off); return }
        m.makeTranslation(d.p[0], d.p[1], d.p[2])
      } else {
        const p = this.hemis[d.hemi].pos.array as Float32Array
        m.makeTranslation(p[d.v * 3], p[d.v * 3 + 1], p[d.v * 3 + 2])
      }
      this.dots!.setMatrixAt(i, m)
    })
    this.dots.instanceMatrix.needsUpdate = true
    this.dots.computeBoundingSphere()
  }

  /* ----- number pins (identity never depends on colour alone) ----------------------------- */

  private rebuildPins() {
    for (const p of this.pins.values()) p.el.remove()
    this.pins.clear()
    for (const a of this.selected.values()) {
      const el = document.createElement('div')
      el.className = 'atlas-pin'
      el.textContent = String(a.n)
      el.style.background = a.color
      this.overlay.appendChild(el)
      if (a.id.startsWith('deep:')) {
        this.pins.set(a.id, { el, anchor: { deep: a.id.slice(5) } })
        continue
      }
      // anchor on the parcel vertex nearest the parcel's centroid, so the pin sits on the surface;
      // "facing the viewer" is judged from the area's MEAN normal, not that one vertex's, which in
      // a sulcus can point sideways and grey out a pin on an area in plain view
      let best: { hemi: Hemi; v: number; n: THREE.Vector3 } | null = null
      for (const s of Object.values(this.hemis)) {
        if (!s.labels || !this.atlas) continue
        const lab = this.atlas.table.labels.find((l) => l.key && cortexId(l.key) === a.id)
        if (!lab || lab.hemisphere !== s.hemi) continue
        const p = s.pial
        let cx = 0, cy = 0, cz = 0, k = 0
        for (let v = 0; v < s.labels.length; v++) if (s.labels[v] === lab.index) { cx += p[v * 3]; cy += p[v * 3 + 1]; cz += p[v * 3 + 2]; k++ }
        if (!k) continue
        cx /= k; cy /= k; cz /= k
        const na = s.geom.getAttribute('normal').array as Float32Array
        const mean = new THREE.Vector3()
        for (let v = 0; v < s.labels.length; v++) if (s.labels[v] === lab.index) mean.add(new THREE.Vector3(na[v * 3], na[v * 3 + 1], na[v * 3 + 2]))
        mean.normalize()
        let bd = Infinity
        for (let v = 0; v < s.labels.length; v++) {
          if (s.labels[v] !== lab.index) continue
          const d = (p[v * 3] - cx) ** 2 + (p[v * 3 + 1] - cy) ** 2 + (p[v * 3 + 2] - cz) ** 2
          if (d < bd) { bd = d; best = { hemi: s.hemi, v, n: mean } }
        }
      }
      if (best) this.pins.set(a.id, { el, anchor: best })
      else el.remove()
    }
    this.needsRender = true
  }

  private placePins() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const v = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    const toCam = new THREE.Vector3()
    for (const p of this.pins.values()) {
      let facing = true
      let shown = true
      if ('deep' in p.anchor) {
        const d = this.deep.get(p.anchor.deep)
        if (!d) continue
        v.copy(d.centroid)
        shown = d.mesh.visible
      } else {
        const s = this.hemis[p.anchor.hemi]
        const i = p.anchor.v
        const arr = s.pos.array as Float32Array
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
        nrm.copy(p.anchor.n)
        toCam.copy(this.camera.position).sub(v)
        facing = nrm.dot(toCam) > 0 || this.seeThrough > 0.5
        shown = s.mesh.visible
      }
      v.project(this.camera)
      const x = (v.x * 0.5 + 0.5) * w
      const y = (-v.y * 0.5 + 0.5) * h
      p.el.style.transform = `translate(${x - 9}px, ${y - 9}px)`
      p.el.style.opacity = !shown ? '0' : facing ? '1' : '0.3'
    }
  }

  /* ----- camera --------------------------------------------------------------------------- */

  setView(preset: ViewPreset) {
    const dirs: Record<ViewPreset, [number, number, number]> = {
      left: [-1, 0, 0], right: [1, 0, 0], top: [0, -0.04, 1], bottom: [0, 0.04, -1],
      front: [0, 1, 0], back: [0, -1, 0], insideL: [1, 0, 0], insideR: [-1, 0, 0],
    }
    this.hidden = preset === 'insideL' ? 'rh' : preset === 'insideR' ? 'lh' : null
    this.viewHidden = this.hidden
    this.focusId = null
    this.applyVisibility()
    this.updateDots()
    const to = new THREE.Vector3(...dirs[preset]).normalize()
    const fromTarget = this.controls.target.clone()
    const fromDir = this.camera.position.clone().sub(this.controls.target).normalize()
    const fromDist = this.camera.position.distanceTo(this.controls.target)
    const toDist = DISTANCE * (1 + 0.32 * this.smooth)
    const t0 = performance.now()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 1 : 700
    this.camAnim = (now) => {
      const k = Math.min(1, (now - t0) / dur)
      const e = ease(k)
      const dir = fromDir.clone().lerp(to, e)
      if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0.0001)
      dir.normalize()
      this.controls.target.copy(fromTarget).lerp(TARGET, e)
      this.camera.position.copy(this.controls.target).addScaledVector(dir, fromDist + (toDist - fromDist) * e)
      this.camera.lookAt(this.controls.target)
      this.controls.update()
      this.needsRender = true
      return k < 1
    }
  }

  private focusId: string | null = null

  /** Turn to an area and move in on it, so it fills the view; null goes back to the whole brain.
      A medial area is seen from inside: the other hemisphere is hidden while it is in focus. */
  focusOn(id: string | null) {
    if (id === this.focusId) return
    this.focusId = id
    let target = TARGET.clone()
    let dir = this.camera.position.clone().sub(this.controls.target).normalize()
    let dist = DISTANCE * (1 + 0.32 * this.smooth)
    this.hidden = this.viewHidden
    if (id?.startsWith('deep:')) {
      const d = this.deep.get(id.slice(5))
      if (d) { target = d.centroid.clone(); dist = DISTANCE * 0.62 }
    } else if (id && this.atlas) {
      const lab = this.atlas.table.labels.find((l) => l.key && cortexId(l.key) === id)
      const s = lab?.hemisphere ? this.hemis[lab.hemisphere as Hemi] : null
      if (lab && s?.labels) {
        const toInflated = this.smoothTarget > 0.5 && !!s.inflated && !!s.inflN
        const p = toInflated ? s.inflated! : s.pial
        const nn = toInflated ? s.inflN! : s.pialN
        const c = new THREE.Vector3(), nrm = new THREE.Vector3()
        let k = 0
        for (let v = 0; v < s.labels.length; v++) {
          if (s.labels[v] !== lab.index) continue
          c.x += p[v * 3]; c.y += p[v * 3 + 1]; c.z += p[v * 3 + 2]
          nrm.x += nn[v * 3]; nrm.y += nn[v * 3 + 1]; nrm.z += nn[v * 3 + 2]
          k++
        }
        if (k) {
          c.divideScalar(k)
          let r2 = 0
          for (let v = 0; v < s.labels.length; v++) {
            if (s.labels[v] !== lab.index) continue
            r2 = Math.max(r2, (p[v * 3] - c.x) ** 2 + (p[v * 3 + 1] - c.y) ** 2 + (p[v * 3 + 2] - c.z) ** 2)
          }
          target = c
          if (nrm.lengthSq() > 1e-6) dir = nrm.normalize()
          // a medial area faces the other hemisphere: hide that one so the camera can look
          const medial = s.hemi === 'lh' ? dir.x > 0.35 : dir.x < -0.35
          if (medial) this.hidden = s.hemi === 'lh' ? 'rh' : 'lh'
          // a little above the area's own normal, so a sulcal area is not seen edge-on
          dir.add(new THREE.Vector3(0, 0, 0.25)).normalize()
          dist = Math.min(DISTANCE * 0.85, Math.max(DISTANCE * 0.38, Math.sqrt(r2) * 4.2))
        }
      }
    }
    this.applyVisibility()
    this.updateDots()
    const fromTarget = this.controls.target.clone()
    const fromDir = this.camera.position.clone().sub(fromTarget).normalize()
    const fromDist = this.camera.position.distanceTo(fromTarget)
    const t0 = performance.now()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 1 : 750
    this.camAnim = (now) => {
      const k = Math.min(1, (now - t0) / dur)
      const e = ease(k)
      this.controls.target.copy(fromTarget).lerp(target, e)
      const d = fromDir.clone().lerp(dir, e)
      if (d.lengthSq() < 1e-6) d.set(0, -1, 0.0001)
      this.camera.position.copy(this.controls.target).addScaledVector(d.normalize(), fromDist + (dist - fromDist) * e)
      this.camera.lookAt(this.controls.target)
      this.controls.update()
      this.needsRender = true
      return k < 1
    }
  }

  /** fade everything but the selected areas (the focus view) */
  setFade(on: boolean) {
    if (on === this.fade) return
    this.fade = on
    this.updateColors()
  }

  /** colour the selected area by a finer atlas's subdivisions; null for one colour */
  setSubregions(sub: Subregions | null) {
    if (!sub) { this.sub = null; this.subHover = -1; this.updateColors(); return }
    const boundary = {} as Record<Hemi, Uint8Array>
    for (const h of ['lh', 'rh'] as Hemi[]) {
      const st = this.hemis[h]
      const lab = sub.labels[h]
      const b = new Uint8Array(lab.length)
      for (let v = 0; v < lab.length; v++) {
        if (!sub.colors.has(lab[v])) continue
        for (let k = st.adjStart[v]; k < st.adjStart[v + 1]; k++) if (lab[st.adj[k]] !== lab[v]) { b[v] = 1; break }
      }
      boundary[h] = b
    }
    this.sub = { s: sub, colors: new Map([...sub.colors].map(([k, v]) => [k, new THREE.Color(v)])), boundary, index: new Map([...sub.keys].map(([i, k]) => [k, i])) }
    this.updateColors()
  }

  /** the selected subregion, by its finer-atlas key; null for none */
  setSubActive(key: string | null) {
    const i = key && this.sub ? this.sub.index.get(key) ?? -1 : -1
    if (i === this.subActive) return
    this.subActive = i
    this.updateColors()
  }

  private dolly(from: number, to: number, dur: number) {
    const t0 = performance.now()
    this.camAnim = (now) => {
      const k = Math.min(1, (now - t0) / dur)
      const dir = this.camera.position.clone().sub(this.controls.target).normalize()
      this.camera.position.copy(this.controls.target).addScaledVector(dir, from + (to - from) * ease(k))
      this.controls.update()
      this.needsRender = true
      return k < 1
    }
  }

  rotateBy(yaw: number) {
    const off = this.camera.position.clone().sub(this.controls.target)
    off.applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw)
    this.camera.position.copy(this.controls.target).add(off)
    this.controls.update()
    this.needsRender = true
  }

  /* ----- picking -------------------------------------------------------------------------- */

  private onMove = (e: PointerEvent) => {
    this.pickPending = { x: e.clientX, y: e.clientY }
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY }
  }

  private onUp = (e: PointerEvent) => {
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) {
      this.cb.onClick(this.pick(e.clientX, e.clientY))
    }
    this.down = null
  }

  private onLeave = () => {
    this.pickPending = null
    this.setHover(null, 0, 0)
  }

  private pick(cx: number, cy: number): string | null {
    if (this.anim) return null // the surface is moving; its BVH is refitted when it settles
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const ghost = this.seeThrough >= 0.5
    const targets: THREE.Object3D[] = []
    for (const d of this.deep.values()) if (d.mesh.visible) targets.push(d.mesh)
    for (const s of Object.values(this.hemis)) {
      if (!s.mesh.visible) continue
      if (ghost) {
        if (s.sub.visible) targets.push(s.sub)
      } else targets.push(s.mesh)
    }
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    if (hit.object.userData.deep) return deepId(hit.object.userData.deep as string)
    const s = this.hemis[hit.object.userData.hemi as Hemi]
    if (!s.labels || !this.atlas || !hit.face) return null
    const p = s.pos.array as Float32Array
    let best = hit.face.a
    let bd = Infinity
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      const d = (p[v * 3] - hit.point.x) ** 2 + (p[v * 3 + 1] - hit.point.y) ** 2 + (p[v * 3 + 2] - hit.point.z) ** 2
      if (d < bd) { bd = d; best = v }
    }
    const idx = s.labels[best]
    if (this.sub && this.selectedByIndex.has(idx)) {
      const sk = this.sub.s.keys.get(this.sub.s.labels[s.hemi][best])
      if (sk && this.sub.colors.has(this.sub.s.labels[s.hemi][best])) return `sub:${sk}`
    }
    const key = idx ? this.atlas.table.labels[idx]?.key : null
    return key ? cortexId(key) : null
  }

  private setHover(id: string | null, x: number, y: number) {
    if (id !== this.hoverId) {
      this.hoverId = id
      const sh = id?.startsWith('sub:') && this.sub ? this.sub.index.get(id.slice(4)) ?? -1 : -1
      if (sh !== this.subHover) { this.subHover = sh; this.updateColors() }
      const idx = id && id.startsWith('ctx:') && this.atlas ? this.atlas.table.labels.find((l) => l.key && cortexId(l.key) === id)?.index ?? -1 : -1
      if (idx !== this.hoverIndex) {
        this.hoverIndex = idx
        this.updateColors()
      }
      this.paintDeep(id)
      this.needsRender = true
    }
    this.cb.onHover(id, x, y)
  }

  /* ----- loop ----------------------------------------------------------------------------- */

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    if (this.anim && !this.anim(now)) this.anim = null
    if (this.camAnim && !this.camAnim(now)) this.camAnim = null
    if (this.controls.update()) this.needsRender = true
    if (this.pickPending && !this.down) {
      const { x, y } = this.pickPending
      this.pickPending = null
      this.setHover(this.pick(x, y), x, y)
    }
    if (this.needsRender || this.anim || this.camAnim) {
      this.renderer.render(this.scene, this.camera)
      this.placePins()
      this.needsRender = false
    }
  }

  /** Render the given views off-screen at w x h pixels, exactly as currently coloured, and restore
      the on-screen view. Each view is rendered from a fixed camera so a figure is reproducible
      whatever the user last did with the mouse. */
  captureViews(views: { view: ViewPreset; w: number; h: number; scale?: number }[], opts: { inflated: boolean }): CapturedView[] {
    const dirs: Record<ViewPreset, [number, number, number]> = {
      left: [-1, 0, 0], right: [1, 0, 0], top: [0, -0.04, 1], bottom: [0, 0.04, -1],
      front: [0, 1, 0], back: [0, -1, 0], insideL: [1, 0, 0], insideR: [-1, 0, 0],
    }
    const saved = {
      size: this.renderer.getSize(new THREE.Vector2()),
      ratio: this.renderer.getPixelRatio(),
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
      aspect: this.camera.aspect,
      hidden: this.hidden,
      smooth: this.smooth,
      see: this.seeThrough,
      zoom: this.camera.zoom,
      fade: this.fade,
    }
    // a figure shows the selected areas against the plain brain, not faded
    if (this.fade) { this.fade = false; this.updateColors() }
    const out: CapturedView[] = []
    try {
      this.renderer.setPixelRatio(1)
      // a figure is framed the same whatever the screen it was made on
      this.camera.zoom = 1
      // a figure is opaque: faded cortex would no longer match the legend's colours
      this.seeThrough = 0
      if (opts.inflated !== this.smooth > 0.5) this.applySmooth(opts.inflated ? 1 : 0, false)
      for (const { view, w, h, scale } of views) {
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        // a lateral view of one side also hides the other, so a figure tile shows one hemisphere
        this.hidden = view === 'insideL' || view === 'left' ? 'rh' : view === 'insideR' || view === 'right' ? 'lh' : null
        this.applyVisibility()
        this.updateDots()
        const dist = DISTANCE * (scale ?? 0.8) * (1 + 0.32 * this.smooth)
        // a figure frames the whole brain, whatever the screen is focused on
        this.camera.position.copy(TARGET).addScaledVector(new THREE.Vector3(...dirs[view]).normalize(), dist)
        this.camera.lookAt(TARGET)
        this.camera.updateMatrixWorld()
        this.renderer.render(this.scene, this.camera)
        const image = document.createElement('canvas')
        image.width = w
        image.height = h
        image.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, w, h)
        const pins: CapturedView['pins'] = []
        const p = new THREE.Vector3()
        for (const [id, pin] of this.pins) {
          const a = this.selected.get(id)
          if (!a || 'deep' in pin.anchor || pin.anchor.hemi === this.hidden) continue
          const arr = this.hemis[pin.anchor.hemi].pos.array as Float32Array
          p.set(arr[pin.anchor.v * 3], arr[pin.anchor.v * 3 + 1], arr[pin.anchor.v * 3 + 2])
          if (pin.anchor.n.dot(this.camera.position.clone().sub(p)) <= 0) continue
          p.project(this.camera)
          pins.push({ n: a.n, color: a.color, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h })
        }
        const sides: CapturedView['sides'] = []
        for (const hs of Object.values(this.hemis)) {
          if (hs.hemi === this.hidden) continue
          hs.geom.computeBoundingBox()
          const c = hs.geom.boundingBox!.getCenter(new THREE.Vector3()).project(this.camera)
          sides.push({ hemi: hs.hemi, x: (c.x * 0.5 + 0.5) * w, y: (-c.y * 0.5 + 0.5) * h })
        }
        out.push({ view, image, pins, sides })
      }
    } finally {
      if (Math.abs(this.smooth - saved.smooth) > 1e-6) this.applySmooth(saved.smooth, true)
      this.renderer.setPixelRatio(saved.ratio)
      this.renderer.setSize(saved.size.x, saved.size.y, false)
      this.camera.aspect = saved.aspect
      this.camera.zoom = saved.zoom
      this.camera.updateProjectionMatrix()
      this.camera.position.copy(saved.pos)
      this.camera.quaternion.copy(saved.quat)
      this.hidden = saved.hidden
      this.seeThrough = saved.see
      if (saved.fade) { this.fade = true; this.updateColors() }
      this.applyVisibility()
      this.updateDots()
      this.renderer.render(this.scene, this.camera)
      this.needsRender = true
    }
    return out
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointerleave', this.onLeave)
    this.controls.dispose()
    for (const s of Object.values(this.hemis)) {
      s.geom.boundsTree = undefined
      s.geom.dispose()
      s.subGeom.dispose()
    }
    for (const d of this.deep.values()) d.mesh.geometry.dispose()
    this.renderer.dispose()
    el.remove()
    this.overlay.remove()
  }
}
