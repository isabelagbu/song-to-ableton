// Ableton's own instruments and when each one suits a layer of a song.
//
// `edition` is the lowest edition that includes the device. Sources:
//   ableton.com/en/products/live-lite/features (Lite)
//   ableton.com/en/live/compare-editions (Intro, Standard, Suite)

export const EDITIONS = ['lite', 'intro', 'standard', 'suite'];

export const EDITION_LABELS = {
  lite: 'Lite',
  intro: 'Intro or higher',
  standard: 'Standard or higher',
  suite: 'Suite',
};

const SHOW_ABOVE = 0.4;

const LAYERS = {
  drums: { name: 'Drums & percussion', describe: describeDrums },
  bass: { name: 'Bass', describe: describeBass },
  melodic: { name: 'Chords & melody', describe: describeMelodic },
  texture: { name: 'Air & texture', describe: describeTexture },
};

const isPluck = (f) => f.decay < 0.3 && f.sustain < 0.7;
const isPad = (f) => f.attack > 0.04 || (f.decay > 0.5 && f.sustain > 0.7);
const isBright = (f) => f.brightness > 700;
const isChordal = (f) => f.polyphony >= 3;
const isEvolving = (f) => f.motion > 0.7;

const INSTRUMENTS = [
  {
    name: 'Drum Rack',
    edition: 'lite',
    drums: () => ({
      score: 0.9,
      why: 'Works for almost any kit, because each pad holds its own sample or instrument.',
      start: 'Load a kit that’s close in style, then tune the kick to the song’s key.',
    }),
  },
  {
    name: 'Impulse',
    edition: 'lite',
    drums: () => ({
      score: 0.6,
      why: 'Quick to shape eight drum samples, each with its own tuning and decay.',
      start: 'Drop a kick, snare and hat onto the slots, then set each decay to match the track.',
    }),
  },
  {
    name: 'Simpler',
    edition: 'lite',
    drums: () => ({
      score: 0.5,
      why: 'Good for a single one-shot or a sliced drum loop.',
      start: 'Use Slice mode on a drum break and trigger the slices from a MIDI clip.',
    }),
    bass: (f) => ({
      score: f.richness > 0.5 ? 0.55 : 0.45,
      why: 'Plays a sampled bass note, which suits a sound that’s hard to synthesize.',
      start: 'Load a single bass note in Classic mode and turn off Warp so pitch tracking stays clean.',
    }),
    melodic: (f) => ({
      score: isPluck(f) ? 0.6 : 0.5,
      why: isPluck(f)
        ? 'Sampled plucks and keys can be played across the keyboard.'
        : 'Plays a recorded chord or note, which also suits sample-based sounds.',
      start: 'Load one sustained note or chord in Classic mode, then shape it with the filter and amp envelope.',
    }),
    texture: () => ({
      score: 0.65,
      why: 'Can loop a recording of noise, vinyl crackle or atmosphere underneath the track.',
      start: 'Load a noise or field recording, turn on Loop, and filter out the low end.',
    }),
  },
  {
    name: 'Drift',
    edition: 'lite',
    bass: (f) => ({
      score: f.richness > 0.5 ? 0.75 : 0.7,
      why: f.richness > 0.5
        ? 'Its two oscillators and filter give a warm, harmonically rich bass.'
        : 'A simple low oscillator with the filter closed gets close to a clean sub.',
      start: f.richness > 0.5
        ? 'Set Mono voice mode, use a saw, and bring the low-pass cutoff down until it sits in the mix.'
        : 'Set Mono voice mode, pick a pure oscillator shape, and close the filter until only the low end remains.',
    }),
    melodic: (f) => ({
      score: isChordal(f) && isPad(f) ? 0.8 : isPluck(f) ? 0.75 : 0.65,
      why: isPad(f)
        ? 'Slightly unstable analog-style oscillators suit warm pads.'
        : 'Short, simple envelopes make it a fast choice for plucks and leads.',
      start: isPluck(f)
        ? 'Shorten the amp decay, set sustain to zero, and send the envelope to the filter.'
        : 'Lengthen attack and release, then detune with the Drift control for movement.',
    }),
  },
  {
    name: 'Drum Sampler',
    edition: 'intro',
    drums: () => ({
      score: 0.65,
      why: 'A one-shot drum sampler with built-in tone-shaping effects.',
      start: 'Put one on each Drum Rack pad to shape every hit on its own.',
    }),
  },
  {
    name: 'Drum Synths',
    edition: 'standard',
    drums: (f) => ({
      score: f.kickDecay > 0.15 ? 0.75 : 0.6,
      why: f.kickDecay > 0.15
        ? 'DS Kick can make a long, boomy kick without samples.'
        : 'These synthesize drum sounds from scratch, which suits electronic kits.',
      start: 'Load DS Kick, DS Snare and DS HH on Drum Rack pads, then tune and shorten each one.',
    }),
  },
  {
    name: 'Analog',
    edition: 'standard',
    bass: (f) => ({
      score: f.richness > 0.5 ? 0.8 : 0.6,
      why: 'Modeled analog oscillators and filters suit thick, classic synth bass.',
      start: 'Stack two detuned saws in Mono mode and use Filter 1 as a low-pass.',
    }),
    melodic: (f) => ({
      score: isPad(f) ? 0.75 : 0.65,
      why: 'Classic subtractive synthesis suits warm pads, brass and leads.',
      start: 'Detune both oscillators slightly and shape the sound with the filter envelope.',
    }),
  },
  {
    name: 'Electric',
    edition: 'standard',
    melodic: (f) => ({
      score: isChordal(f) && !isBright(f) && !isPad(f) && f.noisiness < 0.4 ? 0.8 : isChordal(f) ? 0.45 : 0.3,
      why: 'Models electric pianos, which suits soft, rounded chords.',
      start: 'Start from an electric piano preset and adjust the mallet stiffness and pickup.',
    }),
  },
  {
    name: 'Tension',
    edition: 'standard',
    melodic: (f) => ({
      score: !isChordal(f) && f.decay > 0.2 && !isBright(f) ? 0.5 : 0.35,
      why: 'Models plucked, bowed and hammered strings for an organic tone.',
      start: 'Start with a plucked string preset and adjust the damper and body settings.',
    }),
  },
  {
    name: 'Collision',
    edition: 'standard',
    melodic: (f) => ({
      score: isPluck(f) && isBright(f) ? 0.65 : 0.3,
      why: 'Models struck objects, which suits bells, mallets and glassy plucks.',
      start: 'Start from a mallet preset and raise the resonator brightness.',
    }),
  },
  {
    name: 'Operator',
    edition: 'suite',
    bass: (f) => ({
      score: 0.75,
      why: f.richness > 0.5
        ? 'FM adds a growling or metallic edge to a bass.'
        : 'A single sine oscillator is an exact recipe for a clean sub.',
      start: f.richness > 0.5
        ? 'Modulate oscillator A with oscillator B, then automate B’s level for bite.'
        : 'Use only oscillator A with a sine wave and turn on Glide.',
    }),
    melodic: (f) => ({
      score: isPluck(f) && isBright(f) ? 0.75 : 0.55,
      why: 'FM synthesis suits bells, electric-piano tones and bright plucks.',
      start: 'Start with one modulator on a short envelope, then raise its level for more attack.',
    }),
  },
  {
    name: 'Wavetable',
    edition: 'suite',
    bass: (f) => ({
      score: f.richness > 0.5 ? 0.8 : 0.5,
      why: 'Sweeping through a wavetable suits modern, moving bass sounds.',
      start: 'Pick a harmonically rich table in Mono mode and route an LFO to the wavetable position.',
    }),
    melodic: (f) => ({
      score: isEvolving(f) ? 0.9 : isBright(f) ? 0.7 : 0.6,
      why: isEvolving(f)
        ? 'The tone changes over time here, and moving wavetable position does exactly that.'
        : 'Versatile for wide, polished modern synth sounds.',
      start: 'Add unison voices for width and send an envelope or LFO to the wavetable position.',
    }),
  },
  {
    name: 'Meld',
    edition: 'suite',
    melodic: (f) => ({
      score: isEvolving(f) ? 0.8 : 0.55,
      why: 'Two engines and deep modulation suit layered, evolving sounds.',
      start: 'Give each engine a different oscillator type and modulate them separately.',
    }),
    texture: () => ({
      score: 0.55,
      why: 'Its noise-based oscillators can produce soft, shifting textures.',
      start: 'Use a noise-based oscillator on one engine and modulate its filter slowly.',
    }),
  },
  {
    name: 'Sampler',
    edition: 'suite',
    melodic: (f) => ({
      score: isChordal(f) && !isEvolving(f) ? 0.6 : 0.45,
      why: 'Multisampled instruments suit realistic keys, strings and orchestral sounds.',
      start: 'Load a multisampled instrument and adjust velocity zones to match the performance.',
    }),
  },
  {
    name: 'Bass',
    edition: 'suite',
    bass: (f) => ({
      score: f.richness > 0.5 ? 0.75 : 0.65,
      why: 'A monophonic virtual-analog synth built specifically for bass.',
      start: 'Start with a simple preset and adjust the filter and sub level.',
    }),
  },
  {
    name: 'Poli',
    edition: 'suite',
    melodic: (f) => ({
      score: isChordal(f) ? 0.6 : 0.4,
      why: 'A virtual-analog polysynth that suits vintage-style chords.',
      start: 'Start with a pad or brass preset and adjust the filter envelope.',
    }),
  },
  {
    name: 'Granulator III',
    edition: 'suite',
    melodic: (f) => ({
      score: isEvolving(f) && f.noisiness > 0.3 ? 0.65 : 0.3,
      why: 'Granular synthesis suits smeared, ambient sounds built from samples.',
      start: 'Load a sustained sample and slowly move the grain position.',
    }),
    texture: () => ({
      score: 0.7,
      why: 'Turns any recording into a drifting cloud of sound.',
      start: 'Load an atmospheric sample and raise the grain spray.',
    }),
  },
];

function describeDrums(f) {
  const traits = [];
  if (f.kickDecay > 0.15) traits.push('Long, boomy kick');
  else if (f.kickRate > 0.3) traits.push('Short, punchy kick');
  if (f.hatRate > 2.2) traits.push('Busy hi-hats');
  return traits;
}

function describeBass(f) {
  return [
    f.richness > 0.5 ? 'Harmonically rich' : 'Clean and sub-heavy',
    f.sustain > 0.6 ? 'Long, sustained notes' : 'Short, rhythmic notes',
  ];
}

function describeMelodic(f) {
  const traits = [isChordal(f) ? 'Mostly chords' : 'Mostly single notes'];
  if (isPad(f)) traits.push('Soft, pad-like shape');
  else if (isPluck(f)) traits.push('Short, plucked shape');
  traits.push(isBright(f) ? 'Bright tone' : 'Warm tone');
  if (isEvolving(f)) traits.push('Tone changes over time');
  return traits;
}

function describeTexture(f) {
  return [f.sustain > 0.7 ? 'Constant high-frequency wash' : 'Occasional high-frequency sounds'];
}

export function matchInstruments(features, { vocals }) {
  return Object.entries(LAYERS)
    .filter(([id]) => features[id].present)
    .map(([id, layer]) => {
      const matches = INSTRUMENTS.filter((instrument) => instrument[id])
        .map((instrument) => ({
          name: instrument.name,
          edition: instrument.edition,
          ...instrument[id](features[id]),
        }))
        .filter((match) => match.score >= SHOW_ABOVE)
        .sort((a, b) => b.score - a.score);
      return {
        id,
        name: layer.name,
        strength: features[id].strength,
        traits: layer.describe(features[id]),
        note:
          id === 'melodic' && vocals !== 'unlikely'
            ? 'Vocals may be affecting this layer, so treat these matches with more caution.'
            : null,
        matches,
      };
    });
}
