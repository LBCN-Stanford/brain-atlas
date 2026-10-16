/* ============================================================================
   Phenomenology ontology — hierarchical, multi-label controlled vocabulary for
   structured effect labels. Single source of truth for both the synthetic-data
   generator and the browser. Mirrors docs/explanation/PROJECT_CONTEXT.md §10.
   ========================================================================== */

export type EffectFamilyId =
  | 'somatosensory'
  | 'visual'
  | 'language'
  | 'interoceptive'
  | 'affective'
  | 'memory'
  | 'self'
  | 'motor'
  | 'auditory'
  | 'olfactory_gustatory'
  | 'vestibular'
  | 'sensory_unspecified'
  | 'epileptic'
  | 'null'
  | 'other'

export interface EffectNode {
  id: string
  label: string
  /** Short gloss shown in the ontology browser. */
  desc?: string
  children?: EffectNode[]
}

export interface EffectFamily extends EffectNode {
  id: EffectFamilyId
  /** Whether this family carries a somatotopic body-location axis. */
  bodyAxis?: boolean
}

/** Body-location axis (used by somatosensory / motor / interoceptive). */
export const BODY_LOCATIONS = [
  'hand',
  'arm',
  'face',
  'mouth',
  'chest',
  'trunk',
  'leg',
  'foot',
  'whole_body',
  'other',
] as const
export type BodyLocation = (typeof BODY_LOCATIONS)[number]

export const LATERALITIES = ['left', 'right', 'bilateral', 'midline', 'na'] as const
export type Laterality = (typeof LATERALITIES)[number]

export const VALENCES = ['positive', 'negative', 'neutral', 'mixed', 'na'] as const
export type Valence = (typeof VALENCES)[number]

/* ----------------------------------------------------------------------------
   Two ORTHOGONAL phenomenology axes (kept off the family tree so families stay
   modality-pure — the design pattern used by ILAE-2017 seizure semiology and HED).

   • mode  — does stimulation ADD an experience or SUBTRACT a function?
     Selimbeyoglu & Parvizi 2010 separate "positive" elicited responses from
     "negative" cessation effects (e.g. speech arrest). We name it `mode` to avoid
     overloading the word "positive" (already used by effect_presence + valence).

   • level — WHERE on the cortical processing hierarchy the percept sits
     (Mesulam 1998 sensory-fugal model; Margulies et al. 2016 principal gradient,
     unimodal → transmodal). This is the user's "primary sensory vs higher-order"
     axis: primary = elementary topographic percepts from idiotypic cortex
     (phosphene, tingle, tone, twitch); higher-order = integrated/disruptive
     experiences from heteromodal & paralimbic cortex (self, memory, language).
     The anatomical correlate already in the data is `region.gradient`.
   -------------------------------------------------------------------------- */

export const EFFECT_MODES = ['elicited', 'disruptive', 'modulatory', 'na'] as const
export type EffectMode = (typeof EFFECT_MODES)[number]

export const HIERARCHY_LEVELS = ['primary', 'association', 'higher_order', 'na'] as const
export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number]

export const MODE_LABEL: Record<EffectMode, string> = {
  elicited: 'Elicited', disruptive: 'Disruptive', modulatory: 'Modulatory', na: '-',
}
export const MODE_DESC: Record<EffectMode, string> = {
  elicited: 'Stimulation produces a new percept, movement, or experience (additive / "positive" response).',
  disruptive: 'Stimulation interrupts an ongoing function, e.g. speech arrest, naming loss (subtractive / "negative" response).',
  modulatory: 'Stimulation shifts affective or arousal state without a discrete percept.',
  na: 'Not applicable (null / unclassified).',
}
export const LEVEL_LABEL: Record<HierarchyLevel, string> = {
  primary: 'Primary', association: 'Association', higher_order: 'Higher-order', na: '-',
}
export const LEVEL_DESC: Record<HierarchyLevel, string> = {
  primary: 'Elementary, topographic percepts from primary / idiotypic cortex (phosphene, paresthesia, tone, twitch). Reproducible at low charge; predictable from retinotopy / somatotopy / tonotopy.',
  association: 'Complex, category-specific percepts from unimodal association cortex (object / face / motion distortion, voices, visceral sensation).',
  higher_order: 'Integrated, context-dependent experiences or disruptions from heteromodal & paralimbic cortex (self / embodiment, memory, language, affect).',
  na: 'Not applicable (null / unclassified).',
}
// primary→higher-order ramp mirrors the unimodal→transmodal gradient palette.
export const MODE_COLOR: Record<EffectMode, string> = {
  elicited: '#1f9d6b', disruptive: '#c2456e', modulatory: '#d99a16', na: '#94a3b8',
}
export const LEVEL_COLOR: Record<HierarchyLevel, string> = {
  primary: '#2c7fb8', association: '#7a5fb0', higher_order: '#c43a78', na: '#94a3b8',
}

/** Family-level axis defaults (the typical mode/level for that modality). */
const FAMILY_AXIS: Record<EffectFamilyId, { mode: EffectMode; level: HierarchyLevel }> = {
  somatosensory: { mode: 'elicited', level: 'primary' },
  visual: { mode: 'elicited', level: 'association' },
  language: { mode: 'disruptive', level: 'higher_order' },
  interoceptive: { mode: 'elicited', level: 'association' },
  affective: { mode: 'modulatory', level: 'higher_order' },
  memory: { mode: 'elicited', level: 'higher_order' },
  self: { mode: 'elicited', level: 'higher_order' },
  motor: { mode: 'elicited', level: 'primary' },
  auditory: { mode: 'elicited', level: 'primary' },
  olfactory_gustatory: { mode: 'elicited', level: 'primary' },
  vestibular: { mode: 'elicited', level: 'primary' },
  sensory_unspecified: { mode: 'elicited', level: 'na' },
  epileptic: { mode: 'na', level: 'na' },
  null: { mode: 'na', level: 'na' },
  other: { mode: 'na', level: 'na' },
}

/** Leaf-level overrides where a subtype departs from its family default. */
const SUBTYPE_AXIS: Record<string, Partial<{ mode: EffectMode; level: HierarchyLevel }>> = {
  // somatosensory: tactile leaves stay primary; thermal/proprioceptive/pain → association
  warmth: { level: 'association' }, coldness: { level: 'association' },
  body_position: { level: 'association' }, movement_sensation: { level: 'association' },
  pain_discomfort: { level: 'association' },
  // visual: simple → primary, complex → association, scene/space → higher-order
  phosphene: { level: 'primary' }, brightness: { level: 'primary' }, color: { level: 'primary' },
  object_distortion: { level: 'association' }, face_distortion: { level: 'association' }, motion: { level: 'association' },
  spatial_distortion: { level: 'higher_order' }, scene_like: { level: 'higher_order' },
  // auditory: simple percepts primary; voices/distortion → association
  sound: { level: 'primary' }, tone: { level: 'primary' },
  voice_like: { level: 'association' }, auditory_distortion: { level: 'association' },
  // motor: M1 twitch/movement primary; SMA urge higher-order; inhibition is disruptive
  twitch: { level: 'primary' }, movement: { level: 'primary' }, speech_motor: { level: 'association' },
  urge_to_move: { level: 'higher_order' }, motor_inhibition: { mode: 'disruptive', level: 'association' },
  // memory: experiential recall elicited; cognitive disruptions are disruptive
  attention_disruption: { mode: 'disruptive' }, thought_disruption: { mode: 'disruptive' },
  executive_disruption: { mode: 'disruptive' }, time_perception: { mode: 'disruptive' },
  // interoceptive
  bodily_arousal: { mode: 'modulatory' },
  // vestibular: PIVC rotation/acceleration primary; balance/floating → association
  rotation: { level: 'primary' }, acceleration: { level: 'primary' },
  floating: { level: 'association' }, balance: { level: 'association' },
  // olfactory/gustatory: smell/taste primary; flavor integrated
  smell: { level: 'primary' }, taste: { level: 'primary' }, flavor_like: { level: 'association' },
  // language: articulation/slurring is a motor-speech disruption
  articulation_slurring: { mode: 'disruptive', level: 'association' },
  // real-data source tokens (3.0-real): coarse modality words from the lab sheets;
  // refine level where the family default (often 'primary') is too coarse.
  pain: { level: 'association' }, temperature: { level: 'association' },
}

/** Resolve the (mode, level) axes for an effect from its family + subtype. */
export function effectAxes(
  familyId: EffectFamilyId,
  subtypeId?: string | null,
): { mode: EffectMode; level: HierarchyLevel } {
  const base = FAMILY_AXIS[familyId] ?? { mode: 'na' as EffectMode, level: 'na' as HierarchyLevel }
  let o = subtypeId ? SUBTYPE_AXIS[subtypeId] : undefined
  // pain/temperature are somatosensory submodalities; don't let those tokens override the axis of a
  // non-somatosensory family (e.g. an interoceptive 'temperature') — fall back to the family default.
  if (o && (subtypeId === 'pain' || subtypeId === 'temperature') && familyId !== 'somatosensory') o = undefined
  return { mode: o?.mode ?? base.mode, level: o?.level ?? base.level }
}

export const ONTOLOGY: EffectFamily[] = [
  {
    id: 'somatosensory',
    label: 'Somatosensory',
    bodyAxis: true,
    desc: 'Bodily sensation on the skin or in the body wall: touch, temperature, position, or pain.',
    children: [
      {
        id: 'tactile',
        label: 'Tactile',
        children: [
          { id: 'tingling', label: 'Tingling / paresthesia' },
          { id: 'pressure', label: 'Pressure' },
          { id: 'numbness', label: 'Numbness' },
        ],
      },
      {
        id: 'thermal',
        label: 'Thermal',
        children: [
          { id: 'warmth', label: 'Warmth' },
          { id: 'coldness', label: 'Coldness' },
        ],
      },
      {
        id: 'proprioceptive',
        label: 'Proprioceptive',
        children: [
          { id: 'body_position', label: 'Body position' },
          { id: 'movement_sensation', label: 'Movement sensation' },
        ],
      },
      { id: 'pain_discomfort', label: 'Pain / discomfort' },
    ],
  },
  {
    id: 'visual',
    label: 'Visual',
    desc: 'Elementary or complex visual experiences elicited without external visual input.',
    children: [
      {
        id: 'simple',
        label: 'Simple',
        children: [
          { id: 'phosphene', label: 'Phosphene' },
          { id: 'brightness', label: 'Brightness change' },
          { id: 'color', label: 'Color' },
        ],
      },
      {
        id: 'complex',
        label: 'Complex',
        children: [
          { id: 'object_distortion', label: 'Object distortion' },
          { id: 'face_distortion', label: 'Face distortion' },
          { id: 'motion', label: 'Illusory motion' },
          { id: 'spatial_distortion', label: 'Spatial distortion' },
          { id: 'scene_like', label: 'Scene-like experience' },
        ],
      },
    ],
  },
  {
    id: 'language',
    label: 'Language',
    desc: 'Disruption or alteration of speech production, naming, comprehension, or reading.',
    children: [
      { id: 'speech_arrest', label: 'Speech arrest' },
      { id: 'naming_disruption', label: 'Naming disruption' },
      { id: 'comprehension_disruption', label: 'Comprehension disruption' },
      { id: 'reading_disruption', label: 'Reading disruption' },
      { id: 'articulation_slurring', label: 'Articulation / slurring' },
      { id: 'word_finding', label: 'Word-finding difficulty' },
    ],
  },
  {
    id: 'interoceptive',
    label: 'Interoceptive / autonomic',
    bodyAxis: true,
    desc: 'Sensations referred to the viscera or internal bodily state, and autonomic arousal.',
    children: [
      { id: 'thermal_visceral', label: 'Warmth / coldness (visceral)' },
      { id: 'breathing', label: 'Breathing sensation' },
      { id: 'heart_chest', label: 'Heart / chest sensation' },
      { id: 'stomach', label: 'Stomach sensation' },
      { id: 'nausea', label: 'Nausea-like sensation' },
      { id: 'visceral_pressure', label: 'Visceral pressure' },
      { id: 'bodily_arousal', label: 'Bodily arousal' },
    ],
  },
  {
    id: 'affective',
    label: 'Affective / motivational',
    desc: 'Changes in emotional state, valence, fear, calm, drive, or perseverance.',
    children: [
      { id: 'positive_valence', label: 'Positive valence' },
      { id: 'negative_valence', label: 'Negative valence' },
      { id: 'fear_anxiety', label: 'Fear / anxiety-like' },
      { id: 'calmness', label: 'Calmness' },
      { id: 'drive_motivation', label: 'Drive / motivation' },
      { id: 'will_perseverance', label: 'Will / effort / perseverance-like' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory / cognitive',
    desc: 'Memory recall, familiarity, attention, thought, time perception, or task disruption.',
    children: [
      { id: 'memory_recall', label: 'Memory recall' },
      { id: 'familiarity', label: 'Familiarity / déjà vu' },
      { id: 'attention_disruption', label: 'Attention disruption' },
      { id: 'thought_disruption', label: 'Thought disruption' },
      { id: 'time_perception', label: 'Time / perception disruption' },
      { id: 'executive_disruption', label: 'Executive / task disruption' },
    ],
  },
  {
    id: 'self',
    label: 'Self / embodiment',
    desc: 'Alterations in body ownership, agency, self-location, perspective, or detachment.',
    children: [
      { id: 'body_ownership', label: 'Body ownership' },
      { id: 'agency', label: 'Agency' },
      { id: 'self_location', label: 'Self-location' },
      { id: 'perspective', label: 'Perspective' },
      { id: 'detachment', label: 'Detachment-like experience' },
      { id: 'altered_body_world', label: 'Altered body / world relation' },
    ],
  },
  {
    id: 'motor',
    label: 'Motor',
    bodyAxis: true,
    desc: 'Elicited movement, twitches, urges to move, or motor inhibition.',
    children: [
      { id: 'twitch', label: 'Twitch' },
      { id: 'movement', label: 'Overt movement' },
      { id: 'speech_motor', label: 'Speech motor effect' },
      { id: 'urge_to_move', label: 'Urge to move' },
      { id: 'motor_inhibition', label: 'Motor inhibition' },
    ],
  },
  {
    id: 'auditory',
    label: 'Auditory',
    desc: 'Elicited sounds, tones, voice-like percepts, or auditory distortions.',
    children: [
      { id: 'sound', label: 'Sound' },
      { id: 'tone', label: 'Tone' },
      { id: 'voice_like', label: 'Voice-like' },
      { id: 'auditory_distortion', label: 'Auditory distortion' },
    ],
  },
  {
    id: 'olfactory_gustatory',
    label: 'Olfactory / gustatory',
    desc: 'Elicited smells, tastes, or flavor-like experiences.',
    children: [
      { id: 'smell', label: 'Smell' },
      { id: 'taste', label: 'Taste' },
      { id: 'flavor_like', label: 'Flavor-like' },
    ],
  },
  {
    id: 'vestibular',
    label: 'Vestibular',
    desc: 'Sensations of rotation, floating, acceleration, or imbalance.',
    children: [
      { id: 'rotation', label: 'Rotation' },
      { id: 'floating', label: 'Floating' },
      { id: 'acceleration', label: 'Acceleration' },
      { id: 'balance', label: 'Balance sensation' },
    ],
  },
  {
    id: 'sensory_unspecified',
    label: 'Sensory (unspecified modality)',
    desc: 'A sensory response recorded without a specified modality (source subcategory blank), kept distinct rather than defaulted to a specific modality.',
    children: [{ id: 'unspecified_sensation', label: 'Unspecified sensation' }],
  },
  {
    id: 'epileptic',
    label: 'Epileptic / afterdischarge',
    desc: 'Stimulation-induced afterdischarge or seizure, an epileptiform excitability response, distinct from a functional effect (also carried by seizure_related / afterdischarge QC flags).',
    children: [
      { id: 'afterdischarge', label: 'Afterdischarge' },
      { id: 'seizure', label: 'Seizure' },
    ],
  },
  {
    id: 'null',
    label: 'Null / uncertain',
    desc: 'Non-effect / unclear outcomes, first-class denominators.',
    children: [
      { id: 'clean_null', label: 'Clean null' },
      { id: 'uncertain_report', label: 'Uncertain report' },
      { id: 'not_assessable', label: 'Uncoded / pending' },
      { id: 'excluded', label: 'Excluded' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    desc: 'Reported effects that do not fit the defined families.',
    children: [{ id: 'unclassified', label: 'Unclassified' }],
  },
]

// --- derived lookups --------------------------------------------------------

export const FAMILY_IDS: EffectFamilyId[] = ONTOLOGY.map((f) => f.id)

export const FAMILY_LABEL: Record<EffectFamilyId, string> = Object.fromEntries(
  ONTOLOGY.map((f) => [f.id, f.label]),
) as Record<EffectFamilyId, string>

export const FAMILY_BY_ID: Record<string, EffectFamily> = Object.fromEntries(
  ONTOLOGY.map((f) => [f.id, f]),
)

/** Flatten every node (family → … → leaf) keeping a path of labels. */
export interface FlatNode {
  id: string
  label: string
  familyId: EffectFamilyId
  familyLabel: string
  depth: number
  path: string[]
  isLeaf: boolean
}

export function flattenOntology(): FlatNode[] {
  const out: FlatNode[] = []
  for (const fam of ONTOLOGY) {
    const walk = (node: EffectNode, depth: number, path: string[]) => {
      const isLeaf = !node.children || node.children.length === 0
      out.push({
        id: node.id,
        label: node.label,
        familyId: fam.id,
        familyLabel: fam.label,
        depth,
        path: [...path, node.label],
        isLeaf,
      })
      node.children?.forEach((c) => walk(c, depth + 1, [...path, node.label]))
    }
    walk(fam, 0, [])
  }
  return out
}

/** All leaf subtype ids under a family (used by the generator to pick subtypes). */
export function leafSubtypes(familyId: EffectFamilyId): { id: string; label: string }[] {
  const fam = FAMILY_BY_ID[familyId]
  if (!fam) return []
  const leaves: { id: string; label: string }[] = []
  const walk = (n: EffectNode) => {
    if (!n.children || n.children.length === 0) {
      if (n.id !== familyId) leaves.push({ id: n.id, label: n.label })
    } else n.children.forEach(walk)
  }
  fam.children?.forEach(walk)
  return leaves
}

const SUBTYPE_LABEL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const n of flattenOntology()) m[n.id] = n.label
  return m
})()

/** Coarse source-domain `effect_subtype` tokens that appear in the REAL
 *  de-identified data (3.0-real) but are NOT ontology leaf ids — the lab sheets
 *  record a single modality/percept word rather than a curated leaf. Mapped here
 *  so the UI shows a clean label instead of the raw lowercase token. (Synthetic
 *  data uses ontology leaf ids, which resolve via SUBTYPE_LABEL above.) */
export const SOURCE_SUBTYPE_LABEL: Record<string, string> = {
  touch: 'Touch',
  'bodily perception': 'Bodily perception',
  olfactory: 'Olfactory',
  gustatory: 'Gustatory',
  auditory: 'Auditory',
  vestibular: 'Vestibular',
  visual: 'Visual',
  vision: 'Vision',
  language: 'Language',
  pain: 'Pain',
  temperature: 'Temperature',
  seizure: 'Seizure',
  memory: 'Memory',
  math: 'Math',
  location: 'Location',
  chest: 'Chest',
  back: 'Back',
  up: 'Up',
  backwards: 'Backwards',
  other: 'Other',
}

/** Prettify any unmapped token (safety net for future source strings). */
function humanizeSubtype(id: string): string {
  const s = id.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id
}

export function subtypeLabel(id: string | null | undefined): string {
  if (!id) return '-'
  return SOURCE_SUBTYPE_LABEL[id] ?? SUBTYPE_LABEL[id] ?? humanizeSubtype(id)
}
