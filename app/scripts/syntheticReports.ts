/* Invented first-person report text for the SYNTHETIC build.

   The demonstration build needs reports that read like bedside answers, or nobody can judge the
   atlas's main feature (reading what people said) from it. Every phrase here was written for this
   file; none is taken or adapted from a real transcript. Each phrase is chosen by the synthetic
   event's own coded effect, so a demo selection reads coherently, and by a hash of the event id, so
   the text is deterministic and draws nothing from the generator's random stream (adding it does
   not change any other synthetic table).

   Every phrase is five words or fewer, so none can share a six-word run with a real report.

   Used by scripts/generate.ts when the synthetic tables are generated, and by
   scripts/synthetic_report_text.ts to rewrite the text of an existing synthetic reports.json. */

export interface SyntheticLabel {
  event_id: string
  effect_presence: string
  primary_effect_family: string
  effect_subtype: string | null
  body_location: string | null
  laterality: string | null
}

// Every phrase is FIVE WORDS OR FEWER (counted as scripts/check_synthetic_report_overlap.py counts
// words). That check found seven six-word phrases of an earlier, longer bank that also occur in one
// real report each; a phrase this short cannot share a six-word run with anything, so the public
// demo passes that check by construction, on any machine. assertShort() below enforces it.
const BY_SUBTYPE: Record<string, string[]> = {
  phosphene: ['A flash of light.', 'Little white sparkles.', 'A bright spot, up left.'],
  color: ['A patch of blue.', 'Greenish for a second.', 'Some orange, floating.'],
  brightness: ['It got brighter.', 'That side went dim.'],
  motion: ['Something slid past.', 'The wall rippled.'],
  scene_like: ['Like a kitchen. A picture.', 'A street, briefly.'],
  object_distortion: ['The cup looks stretched.', 'Things look far away.'],
  face_distortion: ['Your face looks different.', 'Your face went strange.'],
  spatial_distortion: ['The room tilted.', 'The walls are leaning.'],
  memory_recall: ['A memory from childhood.', 'An old song, almost.'],
  familiarity: ['Deja vu. Strong.', 'This feels so familiar.'],
  time_perception: ['Time slowed down.', 'That felt long.'],
  twitch: ['My thumb jumped.', 'A twitch, my cheek.'],
  movement: ['My hand moved itself.', 'My arm lifted.'],
  urge_to_move: ['I want to move.', 'An urge to grab.'],
  motor_inhibition: ['My fingers froze.', 'My hand stopped.'],
  speech_motor: ['My mouth is pulling.', 'My tongue feels odd.'],
  articulation_slurring: ['Words came out slurred.', 'My speech is mushy.'],
  speech_arrest: ['(stops counting)', 'I could not talk.'],
  naming_disruption: ['I can not name it.', 'Its name is gone.'],
  word_finding: ['The word is gone.', 'Tip of my tongue.'],
  comprehension_disruption: ['I did not follow that.', 'Your words were jumbled.'],
  reading_disruption: ['The letters stopped working.', 'I can not read it.'],
  sound: ['A buzzing.', 'High ringing.'],
  tone: ['A low hum.', 'A steady beep.'],
  voice_like: ['Like distant voices.', 'Someone said my name.'],
  auditory_distortion: ['You sound muffled.', 'Louder on the right.'],
  tingling: ['Tingling, my hand.', 'My lip tingles.'],
  numbness: ['My fingers went numb.', 'Numb cheek.'],
  warmth: ['Warm, my arm.', 'Warmth up my neck.'],
  coldness: ['My hand feels cold.', 'Cold on my face.'],
  pressure: ['Pressure on my leg.', 'A squeeze, my hand.'],
  pain_discomfort: ['A sharp pinch.', 'That was uncomfortable.'],
  movement_sensation: ['Like my hand moved.', 'My arm feels lifted.'],
  body_position: ['Like I am sitting up.', 'My leg feels bent.'],
  smell: ['Something burning.', 'Smells like rubber.'],
  taste: ['A metal taste.', 'Sour.'],
  flavor_like: ['Kind of minty.', 'Like coins.'],
  nausea: ['A bit queasy.', 'Sick to my stomach.'],
  heart_chest: ['My heart is racing.', 'Fluttering in my chest.'],
  breathing: ['Hard to breathe in.', 'Breathing feels off.'],
  visceral_pressure: ['A rising feeling.', 'Butterflies.'],
  thermal_visceral: ['Heat in my chest.', 'A warm wave.'],
  bodily_arousal: ['Goosebumps.', 'I feel flushed.'],
  fear_anxiety: ['I feel scared.', 'A sense of dread.'],
  calmness: ['Very calm.', 'A wave of calm.'],
  positive_valence: ['That felt good.', 'I want to laugh.'],
  negative_valence: ['Suddenly sad.', 'I feel upset.'],
  drive_motivation: ['Like I must go.', 'Determined, somehow.'],
  will_perseverance: ['Ready for a challenge.', 'I have to keep going.'],
  detachment: ['Far from myself.', 'Like a dream.'],
  agency: ['Not me moving it.', 'Someone else in control.'],
  body_ownership: ['Not my hand.', 'My arm feels foreign.'],
  perspective: ['Seeing myself from above.', 'Behind myself, somehow.'],
  balance: ['Dizzy.', 'Like I might fall.'],
  floating: ['I am floating.', 'The bed is lifting.'],
  acceleration: ['Moving forward, fast.', 'Spinning.'],
  attention_disruption: ['I lost track.', 'Could not focus.'],
  executive_disruption: ['Lost the next number.', 'I forgot the task.'],
  thought_disruption: ['My mind went blank.', 'A stray thought.'],
  unclassified: ['Something. Hard to say.', 'A weird feeling.'],
}

const BY_FAMILY: Record<string, string[]> = {
  visual: ['I saw a shape.'],
  memory: ['An old memory.'],
  somatosensory: ['Something in my hand.'],
  motor: ['Something moved.'],
  language: ['Hard to talk.'],
  affective: ['A strong feeling.'],
  auditory: ['I heard something.'],
  interoceptive: ['A feeling inside.'],
  self: ['Not like myself.'],
  olfactory_gustatory: ['A smell, or taste.'],
  vestibular: ['A bit dizzy.'],
  other: ['Something, I can not say.'],
}

const NOTHING = ['Nothing.', 'No, nothing.', 'I feel nothing.', 'Nope.', 'Nothing that time.', 'No change.', 'Did not notice anything.', 'Nothing different.']
const UNSURE = ['Maybe? Not sure.', 'Something, I think.', 'Possibly. Hard to say.', 'Not sure that was it.']
const NOT_ASSESSABLE = ['(patient asleep)', '(not asked)', '(no response; drowsy)']
const EXCLUDED = ['(trial repeated)', '(after-discharge; stopped)']

/** the overlap check's own word rule: lowercase runs of letters and apostrophes */
const wordCount = (t: string) => (t.toLowerCase().match(/[a-z']+/g) ?? []).length
const MAX_WORDS = 5
function assertShort(): void {
  const all = [...Object.values(BY_SUBTYPE).flat(), ...Object.values(BY_FAMILY).flat(), ...NOTHING, ...UNSURE, ...NOT_ASSESSABLE, ...EXCLUDED]
  const long = all.filter((t) => wordCount(t) > MAX_WORDS)
  if (long.length) throw new Error(`synthetic phrases over ${MAX_WORDS} words: ${long.join(' | ')}`)
}
assertShort()

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
const choose = (xs: readonly string[], key: string) => xs[hash(key) % xs.length]

/** The invented report for one synthetic event. */
export function syntheticReport(l: SyntheticLabel): string {
  const key = l.event_id
  switch (l.effect_presence) {
    case 'positive': {
      const bank = (l.effect_subtype && BY_SUBTYPE[l.effect_subtype]) || BY_FAMILY[l.primary_effect_family] || BY_FAMILY.other
      return choose(bank, key)
    }
    case 'null': return choose(NOTHING, key)
    case 'uncertain': return choose(UNSURE, key)
    case 'not_assessable': return choose(NOT_ASSESSABLE, key)
    default: return choose(EXCLUDED, key)
  }
}
