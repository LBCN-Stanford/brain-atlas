/* Invented first-person report text for the SYNTHETIC build.

   The demonstration build needs reports that read like bedside answers, or nobody can judge the
   atlas's main feature (reading what people said) from it. Every phrase here was written for this
   file; none is taken or adapted from a real transcript. Each phrase is chosen by the synthetic
   event's own coded effect, so a demo selection reads coherently, and by a hash of the event id, so
   the text is deterministic and draws nothing from the generator's random stream (adding it does
   not change any other synthetic table).

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

const BY_SUBTYPE: Record<string, string[]> = {
  phosphene: ['I see a little flash of light, up and to the left.', 'There’s a bright spot, like a small star.', 'Sparkles. Little white dots flickering.'],
  color: ['I saw a patch of blue for a second.', 'Everything went a bit greenish, then back.', 'A colour, sort of orange, floating there.'],
  brightness: ['It got brighter, like someone turned up the lights.', 'The room dimmed a little on that side.'],
  motion: ['Something moved across, like a shadow sliding by.', 'The lines on the wall seemed to ripple.'],
  scene_like: ['I saw a kitchen, just for a moment. Like a picture.', 'It was like looking at a street from a window.'],
  object_distortion: ['The cup looked stretched, taller than it is.', 'Your clipboard looked smaller, far away.'],
  face_distortion: ['Your face changed. Your nose looked different, kind of droopy.', 'Your face went strange, like it was melting a bit.'],
  spatial_distortion: ['The room felt tilted, like the walls were leaning.', 'Things looked farther away than they should be.'],
  memory_recall: ['I suddenly thought of my grandmother’s house.', 'It reminded me of a song from high school. I could almost hear it.'],
  familiarity: ['That felt familiar, like I’d been here before, exactly like this.', 'A déjà vu feeling. Strong one.'],
  time_perception: ['Time felt slow for a second.', 'It felt like a long time passed, but it didn’t.'],
  twitch: ['My thumb just jumped.', 'Something twitched in my cheek.'],
  movement: ['My hand moved by itself. I didn’t do that.', 'My arm wanted to lift up.'],
  urge_to_move: ['I felt like I needed to move my leg.', 'An urge to grab something with my right hand.'],
  motor_inhibition: ['I couldn’t move my fingers while that was on.', 'My hand stopped, like it froze.'],
  speech_motor: ['My mouth felt like it was pulling to one side.', 'My tongue felt funny, like it was moving on its own.'],
  articulation_slurring: ['My words are coming out slurred.', 'I was trying to talk but it came out mushy.'],
  speech_arrest: ['(stops counting) … I couldn’t get the words out.', 'I wanted to keep reading but nothing came.'],
  naming_disruption: ['I know what that is, I just can’t say it. The thing you write with.', 'It’s a, um … I can’t get the name.'],
  word_finding: ['The words were on the tip of my tongue.', 'I lost the word I was going to say.'],
  comprehension_disruption: ['I didn’t understand what you just said.', 'Your words sounded like nonsense for a second.'],
  reading_disruption: ['The letters stopped making sense.', 'I could see the words but couldn’t read them.'],
  sound: ['I hear a buzzing.', 'There’s a ringing, kind of high.'],
  tone: ['A low hum, like a fridge.', 'A beep, a steady tone.'],
  voice_like: ['It sounded like someone saying my name, far away.', 'Like people talking in another room.'],
  auditory_distortion: ['Your voice sounded muffled, like underwater.', 'Sounds got louder on the right.'],
  tingling: ['Tingling in my hand. Like pins and needles.', 'My lip is tingling.'],
  numbness: ['My fingers went numb.', 'My cheek feels numb, like at the dentist.'],
  warmth: ['A warm feeling in my arm.', 'Warm, spreading up my neck.'],
  coldness: ['My hand feels cold all of a sudden.', 'A cold feeling on my face.'],
  pressure: ['Pressure on my leg, like someone pressing it.', 'A squeezing in my hand.'],
  pain_discomfort: ['That was uncomfortable, a sharp feeling in my arm.', 'A little painful, like a pinch.'],
  movement_sensation: ['It felt like my hand was moving, but it wasn’t.', 'Like my arm was floating up.'],
  body_position: ['I felt like I was sitting up more than I am.', 'My leg felt like it was bent, but it’s straight.'],
  smell: ['I smell something burning.', 'Like rubber, a weird smell.'],
  taste: ['A metal taste in my mouth.', 'Something sour.'],
  flavor_like: ['Kind of like mint.', 'A taste like coins.'],
  nausea: ['I feel a bit sick to my stomach.', 'Queasy, like on a boat.'],
  heart_chest: ['My heart feels like it’s beating faster.', 'A fluttering in my chest.'],
  breathing: ['I felt like I couldn’t take a full breath.', 'My breathing felt different.'],
  visceral_pressure: ['A rising feeling in my stomach.', 'Something in my belly, like butterflies.'],
  thermal_visceral: ['Heat in my chest.', 'A warm wave in my stomach.'],
  bodily_arousal: ['My skin got goosebumps.', 'I feel flushed.'],
  fear_anxiety: ['I feel scared, I don’t know why.', 'A sense of dread. Like something bad is about to happen.'],
  calmness: ['I feel really calm.', 'Relaxed, like a wave of calm.'],
  positive_valence: ['That felt good, kind of happy.', 'I wanted to laugh.'],
  negative_valence: ['I feel sad all of a sudden.', 'Upset, like I want to cry.'],
  drive_motivation: ['I felt like I had to get going, like I had something to do.', 'Determined. Like I could push through anything.'],
  will_perseverance: ['Like I was getting ready for a challenge.', 'A feeling that I have to keep going.'],
  detachment: ['I felt far away from myself.', 'Everything felt unreal, like a dream.'],
  agency: ['Like it wasn’t me moving my hand.', 'Like someone else was in control for a second.'],
  body_ownership: ['My hand didn’t feel like mine.', 'My arm felt like it belonged to someone else.'],
  perspective: ['Like I was looking at myself from above.', 'As if I was standing behind myself.'],
  balance: ['I felt dizzy.', 'Like I was going to fall over, even lying down.'],
  floating: ['I feel like I’m floating.', 'Like the bed was lifting up.'],
  acceleration: ['Like I was moving forward fast.', 'A sense of spinning.'],
  attention_disruption: ['I lost track of what we were doing.', 'I couldn’t focus on what you said.'],
  executive_disruption: ['I couldn’t figure out the next number.', 'I forgot what I was supposed to do.'],
  thought_disruption: ['My thoughts went blank for a second.', 'A thought just popped in that wasn’t mine.'],
  unclassified: ['Something happened, hard to describe.', 'A weird feeling. I can’t say what.'],
}

const BY_FAMILY: Record<string, string[]> = {
  visual: ['I saw something. Hard to describe, like a shape.'],
  memory: ['It made me think of something from a long time ago.'],
  somatosensory: ['I felt something in my hand.'],
  motor: ['Something moved.'],
  language: ['It was hard to talk for a second.'],
  affective: ['A strong feeling, an emotion.'],
  auditory: ['I heard something.'],
  interoceptive: ['A feeling inside, in my stomach.'],
  self: ['I felt strange, not like myself.'],
  olfactory_gustatory: ['A smell, or a taste.'],
  vestibular: ['Like moving, or dizzy.'],
  other: ['I felt something but I can’t describe it.'],
}

const NOTHING = ['Nothing.', 'No, nothing.', 'I don’t feel anything.', 'Nope.', 'Nothing that time.', 'No change.', 'I didn’t notice anything.', 'Nothing different.']
const UNSURE = ['Maybe? I’m not sure.', 'I think something, but I don’t know.', 'Possibly a little something. Hard to say.', 'I’m not sure if that was it or just me.']
const NOT_ASSESSABLE = ['(patient asleep)', '(patient talking to family; not asked)', '(no response; patient drowsy)']
const EXCLUDED = ['(stimulation repeated; see the next trial)', '(after-discharge noted; trial stopped)']

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
